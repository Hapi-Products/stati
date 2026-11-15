import { createExecutionContext, env } from 'cloudflare:test';
import worker from '../src/server/index';
import { afterEach, expect, it, vi } from 'vitest';
import { hash, now, token } from '../src/server/core';
import { googleDriveCallback, stationDrive } from '../src/server/station-drive';

const scope = 'https://www.googleapis.com/auth/drive.file';
const folderId = 'example_approved_folder';
const songId = 'example_selected_song';
const proof = { code: 'example-authorization-code', verifier: 'a'.repeat(43) };
const bindings = { ...env, APP_ORIGIN: 'https://stati.example.test',
  GOOGLE_DRIVE_CLIENT_ID: 'example.apps.googleusercontent.com', GOOGLE_DRIVE_CLIENT_SECRET: 'synthetic' };
const song = 'A synthetic song';
const file = {
  id: songId, name: 'Synthetic song.txt', mimeType: 'text/plain', parents: [folderId],
  size: String(song.length), version: '2', capabilities: { canDownload: true },
};
afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const admin = crypto.randomUUID(), member = crypto.randomUUID(), deviceId = crypto.randomUUID(), serviceId = crypto.randomUUID();
  const sessions = { admin: token(), member: token() }, time = now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users(id,first_name,last_initial,role,status,created_at) VALUES(?,'Admin','T','admin','active',?),(?,'Member','T','member','active',?)")
      .bind(admin, time, member, time),
    env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?),(?,?,?)')
      .bind(await hash(sessions.admin), admin, time + 3600, await hash(sessions.member), member, time + 3600),
    env.DB.prepare('INSERT INTO devices(id,token_hash,name,owner_id,created_at,pair_expires,last_seen) VALUES(?,?,?,?,?,?,?)')
      .bind(deviceId, await hash(token()), 'Drive test station', admin, time, time + 600, time),
    env.DB.prepare("INSERT INTO station_memberships(device_id,user_id,status,updated_at) VALUES(?,?,'approved',?)").bind(deviceId, member, time),
    env.DB.prepare("INSERT INTO user_ministry_roles(user_id,role,assigned_by,updated_at) VALUES(?,'worship_member',?,?)").bind(member, admin, time),
    env.DB.prepare('INSERT INTO station_services(device_id,id,title,date,time,archived,revision,content_json,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,0,1,?,?,?,?,?)')
      .bind(deviceId, serviceId, 'Test service', '2026-11-14', '10:00', '{}', admin, admin, time, time),
  ]);
  function run(person: keyof typeof sessions, data?: object, select = false, settings: Env = bindings) {
    const pathname = '/api/computers/' + deviceId + '/google-drive' + (select ? '/select' : '');
    const request = new Request(bindings.APP_ORIGIN + pathname, {
      method: data ? 'POST' : 'GET', headers: { Cookie: 'stati_session=' + sessions[person] },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return stationDrive(request, settings, deviceId, select);
  }
  const connect = (revision = 0) => run('admin', { action: 'connect', revision, fileId: folderId, ...proof });
  const allow = (allowed: boolean, revision: number) => run('admin', { action: 'allow-members', revision, allowed });
  const select = (revision: number) => run('member', { serviceId, revision, fileId: songId, ...proof }, true);
  return { deviceId, member, run, connect, allow, select };
}

function google(options: { parent?: string; duringDownload?: () => Promise<unknown> } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'oauth2.googleapis.com') {
      expect(init?.body).toBeInstanceOf(URLSearchParams);
      expect((init?.body as URLSearchParams).get('code_verifier')).toBe(proof.verifier);
      return Response.json({ access_token: 'synthetic-access', scope });
    }
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-access');
    if (url.pathname.endsWith(folderId)) {
      return Response.json({ id: folderId, name: 'Statsi Music', mimeType: 'application/vnd.google-apps.folder' });
    }
    if (url.searchParams.get('alt') === 'media') {
      await options.duringDownload?.();
      return new Response(song);
    }
    return Response.json(options.parent ? { ...file, parents: [options.parent] } : file);
  });
}

it('returns to the fixed native app with one selected item and strict OAuth scope', () => {
  const params = new URLSearchParams({ state: '_A-'.repeat(14) + 'B', code: proof.code, picked_file_ids: songId, scope });
  const request = () => new Request(bindings.APP_ORIGIN + '/api/google-drive/callback?' + params);
  const response = googleDriveCallback(request());
  const url = new URL(response.headers.get('location')!);
  expect(url.origin).toBe('null');
  expect(url.host).toBe('google-drive');
  expect(url.searchParams.get('fileId')).toBe(songId);
  expect(response.headers.get('cache-control')).toBe('no-store');
  params.set('picked_file_ids', songId + ',another_song');
  expect(googleDriveCallback(request()).headers.get('location')).toContain('error=selection_failed');
});

it('lets only an admin approve a folder and explicitly enable submissions for approved members', async () => {
  const f = await fixture();
  const mock = google();
  await expect(f.run('member', { action: 'connect', revision: 0, fileId: folderId, ...proof })).rejects.toMatchObject({ status: 403 });
  expect(mock).not.toHaveBeenCalled();
  expect(await (await f.connect()).json()).toMatchObject({ folderName: 'Statsi Music', allowMembers: false, revision: 1, canImport: true });
  expect(await (await f.run('member')).json()).toMatchObject({ canImport: false });
  await expect(f.select(1)).rejects.toMatchObject({ status: 403 });
  await f.allow(true, 1);
  const result = await f.select(2);
  expect(result.headers.get('x-stati-filename')).toBe('Synthetic%20song.txt');
  expect(new TextDecoder().decode(await result.arrayBuffer())).toBe(song);
  await expect(f.allow(false, 1)).rejects.toMatchObject({ status: 409 });
});

it('rejects selects outside the approved folder and checks for revocation during download', async () => {
  const f = await fixture();
  google({ parent: 'example_other_folder' });
  await f.connect();
  await f.allow(true, 1);
  await expect(f.select(2)).rejects.toMatchObject({ status: 403 });
  vi.restoreAllMocks();
  google({ duringDownload: () => f.allow(false, 2) });
  await expect(f.select(2)).rejects.toMatchObject({ status: 403 });
  expect(await (await f.run('member')).json()).toMatchObject({ canImport: false });
  await f.run('admin', { action: 'disconnect', revision: 3 });
  expect(await (await f.run('admin')).json()).toMatchObject({ folderName: null, revision: 4, canImport: false });
});

it('lets the Google callback return to the app without a Stați browser cookie', async () => {
  const params = new URLSearchParams({ state: 'z'.repeat(43), error: 'access_denied' });
  const result = await worker.fetch(new Request(bindings.APP_ORIGIN + '/api/google-drive/callback?' + params), bindings, createExecutionContext());
  expect(result.status).toBe(303);
  expect(result.headers.get('location')).toBe('stati-ios://google-drive?state=' + 'z'.repeat(43) + '&error=access_denied');
});
