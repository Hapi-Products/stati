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
  function run(person: keyof typeof sessions, data?: object, action = '', client = 'iphone') {
    const pathname = '/api/computers/' + deviceId + '/google-drive' + action;
    const request = new Request(bindings.APP_ORIGIN + pathname, {
      method: data ? 'POST' : 'GET', headers: { Cookie: 'stati_session=' + sessions[person], 'X-Stati-App': client },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return stationDrive(request, bindings, deviceId, action);
  }
  const connect = (revision = 0) => run('admin', { action: 'connect', revision, fileId: folderId, ...proof });
  const allow = (allowed: boolean, revision: number) => run('admin', { action: 'allow-members', revision, allowed });
  const select = (revision: number) => run('member', { serviceId, revision, fileId: songId, ...proof }, '/select', 'ipad');
  const limit = (accountLimit: number, revision: number) =>
    run('admin', { action: 'set-limit', userId: member, accountLimit, revision });
  const link = (revision: number, code = proof.code) =>
    run('member', { action: 'connect', revision, fileId: folderId, ...proof, code }, '/accounts', 'ipad');
  return { deviceId, member, run, connect, allow, select, limit, link };
}

function google(options: { parent?: string; account?: string; distinctCodes?: boolean; folderName?: string; duringDownload?: () => Promise<unknown> } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'oauth2.googleapis.com') {
      expect(init?.body).toBeInstanceOf(URLSearchParams);
      expect((init?.body as URLSearchParams).get('code_verifier')).toBe(proof.verifier);
      const suffix = options.distinctCodes ? (init?.body as URLSearchParams).get('code') : '';
      return Response.json({ access_token: 'synthetic-access' + suffix, scope });
    }
    const auth = new Headers(init?.headers).get('authorization');
    expect(auth).toMatch(/^Bearer synthetic-access/);
    if (url.pathname === '/drive/v3/about') {
      return Response.json({ user: { permissionId: options.account ?? auth, emailAddress: 'synthetic@example.test' } });
    }
    if (url.pathname.endsWith(folderId)) {
      return Response.json({ id: folderId, name: options.folderName ?? 'stati-music', mimeType: 'application/vnd.google-apps.folder' });
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
  expect(await (await f.connect()).json()).toMatchObject({ folderName: 'stati-music', allowMembers: false, revision: 1, canImport: true });
  const denied = await (await f.run('member')).json();
  expect(denied).toMatchObject({ canImport: false });
  expect(denied).not.toHaveProperty('approvedFolderId');
  await expect(f.select(1)).rejects.toMatchObject({ status: 403 });
  await f.allow(true, 1);
  expect(await (await f.run('member')).json()).toMatchObject({ canImport: true, approvedFolderId: folderId });
  const result = await f.select(2);
  expect(result.headers.get('x-stati-filename')).toBe('Synthetic%20song.txt');
  expect(new TextDecoder().decode(await result.arrayBuffer())).toBe(song);
  await expect(f.allow(false, 1)).rejects.toMatchObject({ status: 409 });
});

it('limits management to iPhone administrators and accepts the three folder names', async () => {
  const f = await fixture();
  google({ folderName: 'stati-folder' });
  expect(await (await f.run('admin', undefined, '', 'ipad')).json()).toMatchObject({ canManage: false });
  await expect(f.run('admin', { action: 'connect', revision: 0, fileId: folderId, ...proof }, '', 'ipad'))
    .rejects.toMatchObject({ status: 403 });
  expect(await (await f.connect()).json()).toMatchObject({ folderName: 'stati-folder' });
  vi.restoreAllMocks();
  google({ folderName: 'stati' });
  expect(await (await f.connect(1)).json()).toMatchObject({ folderName: 'stati' });
  vi.restoreAllMocks();
  google({ folderName: 'Statsi Music' });
  await expect(f.connect(2)).rejects.toMatchObject({ status: 400 });
});

it('counts distinct accounts and applies an updated member limit to existing clients', async () => {
  const f = await fixture();
  google();
  await f.connect();
  await expect(f.link(1)).rejects.toMatchObject({ status: 403 });
  await f.limit(1, 1);
  expect(await (await f.link(2)).json()).toMatchObject({ accountLimit: 1, accounts: [{ label: 'synthetic@example.test' }] });
  expect((await (await f.link(2)).json()).accounts).toHaveLength(1);
  vi.restoreAllMocks();
  google({ account: 'example-account-two' });
  await expect(f.select(2)).rejects.toMatchObject({ status: 409 });
  await f.limit(2, 2);
  expect((await (await f.link(3)).json()).accounts).toHaveLength(2);
  await f.limit(0, 3);
  expect(await (await f.run('member')).json()).toMatchObject({ accountLimit: 0, canImport: false, accounts: [] });
  await expect(f.select(4)).rejects.toMatchObject({ status: 403 });
});

it('reserves the last account slot atomically and only lets each person remove their own account', async () => {
  const f = await fixture();
  google({ distinctCodes: true });
  await f.connect();
  await f.limit(1, 1);
  const attempts = await Promise.allSettled([f.link(2), f.link(2, 'other-authorization-code')]);
  expect(attempts.map(attempt => attempt.status).sort()).toEqual(['fulfilled', 'rejected']);
  const member = await (await f.run('member')).json();
  expect(member.accounts).toHaveLength(1);
  const accountId = member.accounts[0].id;
  const admin = await (await f.run('admin')).json();
  expect(admin.members).toContainEqual(expect.objectContaining({ id: f.member, accountLimit: 1, linkedAccounts: 1 }));
  expect(JSON.stringify(admin)).not.toContain('synthetic@example.test');
  const remove = { action: 'remove', id: accountId, revision: 2 };
  await expect(f.run('admin', remove, '/accounts')).rejects.toMatchObject({ status: 409 });
  expect(await (await f.run('member', remove, '/accounts', 'ipad')).json()).toMatchObject({ accounts: [], revision: 3 });
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
