import { env, SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { fixture } from './helpers/service-fixture';

it('rehearses arbitrary page turns privately without creating a live reader', async () => {
  const leader = await fixture('worship_leader');
  const anotherAccount = await fixture('worship_leader', true);
  const url = 'http://localhost:8787/api/computers/' + leader.deviceId + '/clicker-rehearsal';
  const request = (payload?: object, session = leader.session) => SELF.fetch(url, {
    method: payload ? 'POST' : 'GET',
    headers: { Origin: 'http://localhost:8787', Cookie: 'stati_session=' + session },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const receiver = crypto.randomUUID();
  const run = crypto.randomUUID();
  expect((await request({ action: 'start', run })).status).toBe(409);
  expect((await request({ action: 'arm', receiver })).status).toBe(200);
  expect((await request({ action: 'start', run })).status).toBe(200);
  expect((await request({ action: 'sample', run, sequence: 2, page: 4 })).status).toBe(409);
  expect((await request({ action: 'sample', run, sequence: 1, page: 4 })).status).toBe(200);
  expect(await (await request(undefined, anotherAccount.session)).json()).toEqual({ armed: false });
  expect((await request({ action: 'ack', run, receiver: crypto.randomUUID(), sequence: 1 })).status).toBe(409);
  expect((await request({ action: 'ack', run, receiver, sequence: 1 })).status).toBe(200);
  const result = await (await request()).json();
  expect(result).toMatchObject({ run, samples: [{ sequence: 1, page: 4, acknowledgedAt: expect.any(Number) }] });
  expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM worship_live_reader WHERE device_id=?')
    .bind(leader.deviceId).first())?.count).toBe(0);
});
