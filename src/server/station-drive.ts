import { z } from 'zod';
import { body, fileType, HttpError, json, now, safeFilename } from './core';
import { requireStationMinistry, stationMinistryGuard } from './station-catalog';
import type { MinistryAuthority } from './ministry-roles';

const scope = 'https://www.googleapis.com/auth/drive.file';
const folderType = 'application/vnd.google-apps.folder';
const maxImportBytes = 12 * 1024 * 1024;
const callbackPath = '/api/google-drive/callback';
const fileId = z.string().regex(/^[A-Za-z0-9_-]{8,200}$/);
const proof = z.object({
  code: z.string().regex(/^[A-Za-z0-9_./~+-]{10,2048}$/),
  verifier: z.string().regex(/^[A-Za-z0-9_~-]{43,128}$/),
  fileId,
});
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
const edit = z.discriminatedUnion('action', [
  proof.extend({ action: z.literal('connect'), revision }).strict(),
  z.object({ action: z.literal('allow-members'), revision, allowed: z.boolean() }).strict(),
  z.object({ action: z.literal('disconnect'), revision }).strict(),
]);
const selection = proof.extend({ serviceId: z.string().uuid(), revision }).strict();
const metadata = z.object({
  id: fileId, name: z.string().min(1).max(255), mimeType: z.string(),
  parents: z.array(fileId).optional(), trashed: z.boolean().optional(),
  size: z.string().regex(/^\d{1,15}$/).optional(),
  version: z.string().regex(/^\d{1,20}$/).optional(),
  capabilities: z.object({ canDownload: z.boolean().optional() }).optional(),
});
type Folder = { folder_id: string | null; folder_name: string | null; allow_members: number; revision: number };

function configured(env: Env) {
  return env.GOOGLE_DRIVE_CLIENT_ID?.endsWith('.apps.googleusercontent.com') &&
    !!env.GOOGLE_DRIVE_CLIENT_SECRET && env.APP_ORIGIN.startsWith('https://');
}

function worshipMember(authority: MinistryAuthority) {
  return authority.ministryRole === 'worship_leader' || authority.ministryRole === 'worship_member';
}

function driveSettings(env: Env, authority: MinistryAuthority, deviceId: string) {
  const guard = stationMinistryGuard(authority, deviceId, 'sendFiles');
  return env.DB.prepare(`SELECT folder_id,folder_name,allow_members,revision FROM station_drive_folders WHERE device_id=? AND ${guard.sql}`)
    .bind(deviceId, ...guard.params).first<Folder>();
}

async function settingsResponse(env: Env, authority: MinistryAuthority, deviceId: string) {
  const folder = await driveSettings(env, authority, deviceId);
  const enabled = !!configured(env);
  const canManage = authority.user.role === 'admin';
  const canImport = enabled && !!folder?.folder_id && (canManage || (worshipMember(authority) && !!folder?.allow_members));
  return json({
    configured: enabled, canManage, canImport,
    ...(canManage || canImport ? {
      folderName: folder?.folder_name ?? null,
      allowMembers: !!folder?.allow_members,
      revision: folder?.revision ?? 0,
      clientId: enabled ? env.GOOGLE_DRIVE_CLIENT_ID : null,
      redirectURI: enabled ? env.APP_ORIGIN + callbackPath : null,
    } : {}),
  }, 200, { 'Cache-Control': 'no-store' });
}

export function googleDriveCallback(request: Request) {
  const query = new URL(request.url).searchParams;
  const state = query.get('state');
  if (!state || !/^[A-Za-z0-9_-]{20,80}$/.test(state)) throw new HttpError(400, 'Start again from Stați.');
  const destination = new URL('stati-ios://google-drive');
  destination.searchParams.set('state', state);
  const parsed = proof.pick({ code: true, fileId: true }).safeParse({ code: query.get('code'), fileId: query.get('picked_file_ids') });
  if (!query.has('error') && parsed.success && query.get('scope') === scope) {
    destination.searchParams.set('code', parsed.data.code);
    destination.searchParams.set('fileId', parsed.data.fileId);
  } else {
    destination.searchParams.set('error', query.get('error') === 'access_denied' ? 'access_denied' : 'selection_failed');
  }
  return new Response(null, { status: 303, headers: { Location: destination.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

async function googleRequest(url: string, options: RequestInit) {
  try {
    return await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new HttpError(502, 'Google Drive did not respond. Try choosing the file again.');
  }
}

async function accessToken(env: Env, fields: z.infer<typeof proof>) {
  const response = await googleRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      code: fields.code, code_verifier: fields.verifier, grant_type: 'authorization_code',
      client_id: env.GOOGLE_DRIVE_CLIENT_ID!, client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET!,
      redirect_uri: env.APP_ORIGIN + callbackPath,
    }),
  });
  if (!response.ok) throw new HttpError(409, 'Google did not confirm this selection. Open the Google Drive picker again.');
  const result = z.object({ access_token: z.string().min(1).max(4096), scope: z.literal(scope) })
    .safeParse(await response.json().catch(() => null));
  if (!result.success) throw new HttpError(403, 'Google did not grant access to the selected item.');
  return result.data.access_token;
}

async function fileMetadata(id: string, token: string) {
  const url = new URL('https://www.googleapis.com/drive/v3/files/' + id);
  url.search = new URLSearchParams({
    supportsAllDrives: 'true', fields: 'id,name,mimeType,parents,trashed,size,version,capabilities(canDownload)',
  }).toString();
  const response = await googleRequest(url.href, { headers: { Authorization: 'Bearer ' + token } });
  if (!response.ok) throw new HttpError(404, 'Google Drive could not open the selected item.');
  const parsed = metadata.safeParse(await response.json().catch(() => null));
  if (!parsed.success || parsed.data.id !== id || parsed.data.trashed) throw new HttpError(409, 'This Drive item is unavailable.');
  return parsed.data;
}

async function changeSettings(request: Request, env: Env, authority: MinistryAuthority, deviceId: string) {
  if (authority.user.role !== 'admin') throw new HttpError(403, 'An administrator must approve a Drive folder for this computer.');
  const data = await body(request, edit);
  const prior = await driveSettings(env, authority, deviceId);
  if ((prior?.revision ?? 0) !== data.revision) throw new HttpError(409, 'The Drive settings changed. Refresh them and try again.');
  let id = prior?.folder_id ?? null;
  let name = prior?.folder_name ?? null;
  let allowed = prior?.allow_members ?? 0;
  if (data.action === 'connect') {
    if (!configured(env)) throw new HttpError(503, 'Google Drive setup is pending.');
    const folder = await fileMetadata(data.fileId, await accessToken(env, data));
    if (folder.mimeType !== folderType) throw new HttpError(415, 'Choose a Google Drive folder.');
    if (!/^(statsi music|statsi|stați music|stați|stati music|stati)$/iu.test(folder.name.trim())) {
      throw new HttpError(400, 'Name the Drive folder “Statsi Music” or “Statsi”, then choose it again.');
    }
    id = folder.id;
    name = folder.name.trim();
    if (id !== prior?.folder_id) allowed = 0;
  } else if (data.action === 'allow-members') {
    if (!id) throw new HttpError(409, 'Approve a Drive folder first.');
    allowed = Number(data.allowed);
  } else {
    id = null;
    name = null;
    allowed = 0;
  }
  const guard = stationMinistryGuard(authority, deviceId, 'sendFiles');
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO station_drive_folders (device_id,folder_id,folder_name,allow_members,revision)
      SELECT ?,?,?,?,? WHERE ${guard.sql} AND COALESCE((SELECT revision FROM station_drive_folders WHERE device_id=?),0)=?
      ON CONFLICT(device_id) DO UPDATE SET folder_id=excluded.folder_id,folder_name=excluded.folder_name,
      allow_members=excluded.allow_members,revision=excluded.revision`)
      .bind(deviceId, id, name, allowed, data.revision + 1, ...guard.params, deviceId, data.revision),
    env.DB.prepare('INSERT INTO audit(id,actor_id,action,subject_id,created_at) SELECT ?,?,?,?,? WHERE changes()>0')
      .bind(crypto.randomUUID(), authority.user.id, 'drive-folder-' + data.action, deviceId, now()),
  ]);
  if (!result[0].meta.changes) throw new HttpError(409, 'This computer or its Drive settings changed. Refresh and try again.');
  return settingsResponse(env, authority, deviceId);
}

async function importFolder(env: Env, authority: MinistryAuthority, deviceId: string, serviceId: string, expectedRevision: number) {
  if (authority.user.role !== 'admin' && !worshipMember(authority)) {
    throw new HttpError(403, 'This Drive folder is available to authorized worship members.');
  }
  const guard = stationMinistryGuard(authority, deviceId, 'sendFiles');
  const folder = await env.DB.prepare(`SELECT folder_id FROM station_drive_folders WHERE device_id=? AND revision=?
    AND folder_id IS NOT NULL AND (allow_members=1 OR ?='admin') AND ${guard.sql}
    AND EXISTS(SELECT 1 FROM station_services WHERE device_id=? AND id=? AND archived=0)`)
    .bind(deviceId, expectedRevision, authority.user.role, ...guard.params, deviceId, serviceId).first<{folder_id: string}>();
  if (!folder) throw new HttpError(403, 'The Drive folder, service or your access changed. Refresh Song Requests.');
  return folder.folder_id;
}

async function importSelection(request: Request, env: Env, authority: MinistryAuthority, deviceId: string) {
  if (!configured(env)) throw new HttpError(503, 'Google Drive setup is pending.');
  const data = await body(request, selection);
  const approvedFolder = await importFolder(env, authority, deviceId, data.serviceId, data.revision);
  const token = await accessToken(env, data);
  const file = await fileMetadata(data.fileId, token);
  if (!file.parents?.includes(approvedFolder)) {
    throw new HttpError(403, 'Choose a song directly inside the Drive folder approved for this computer.');
  }
  const filename = safeFilename(file.name);
  if (!/\.(pdf|pptx|docx|txt)$/i.test(filename) || file.mimeType.startsWith('application/vnd.google-apps.') || file.capabilities?.canDownload !== true) {
    throw new HttpError(415, 'Choose a downloadable PDF, PowerPoint, Word or text file.');
  }
  const size = Number(file.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxImportBytes) {
    throw new HttpError(413, 'Choose a non-empty Drive file up to 12 MB.');
  }
  const response = await googleRequest('https://www.googleapis.com/drive/v3/files/' + file.id + '?supportsAllDrives=true&alt=media', { headers: { Authorization: 'Bearer ' + token } });
  if (!response.ok || !response.body) throw new HttpError(404, 'Google Drive could not download the selected file.');
  const bytes = new Uint8Array(size);
  let length = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.length > size) {
      await reader.cancel();
      throw new HttpError(409, 'The file changed while downloading. Choose it again.');
    }
    bytes.set(value, length);
    length += value.length;
  }
  if (length !== size) throw new HttpError(409, 'The file changed while downloading. Choose it again.');
  fileType(filename, bytes.subarray(0, 1024));
  const latest = await fileMetadata(data.fileId, token);
  if (!latest.parents?.includes(approvedFolder) || latest.version !== file.version || latest.size !== file.size || latest.name !== file.name || latest.capabilities?.canDownload !== true) {
    throw new HttpError(409, 'The Drive file changed. Choose it again.');
  }
  await importFolder(env, authority, deviceId, data.serviceId, data.revision);
  return new Response(bytes, { headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(size),
    'X-Stati-Filename': encodeURIComponent(filename),
    'Cache-Control': 'no-store',
  } });
}

export async function stationDrive(request: Request, env: Env, deviceId: string, selectionRoute: boolean) {
  const authority = await requireStationMinistry(request, env, deviceId, 'sendFiles');
  if (selectionRoute && request.method === 'POST') return importSelection(request, env, authority, deviceId);
  if (!selectionRoute && request.method === 'GET') return settingsResponse(env, authority, deviceId);
  if (!selectionRoute && request.method === 'POST') return changeSettings(request, env, authority, deviceId);
  throw new HttpError(405, 'This Google Drive action is unavailable.');
}
