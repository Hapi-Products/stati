import { env, SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { sendSupportReport } from '../src/server/support-reports';

const origin = 'http://localhost:8787';
const recent = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z') + ' · Services · Request failed (HTTP 503)';
const expired = '2020-01-01T00:00:00Z · Songs · Network request failed';
const report = {
  description: 'Could not load a service.',
  version: '0.1.0 (50)',
  platform: 'iPadOS',
  systemVersion: '27.3',
  siriStatus: 'ready',
  get recentErrors() { return [recent(), expired]; },
  errorCount: 215,
};
const makeRequest = (content = report) => new Request(origin + '/api/support/reports', {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: 'stati_access=isolated-test-access' },
  body: JSON.stringify(content),
});
const ready = { ...env, STATI_SUPPORT_GITHUB_TOKEN: 'mock-only' };
const metadata = { full_name: 'markusciani/stati-support', private: true, has_issues: true, archived: false };

it('requires a signed-in account at the public route', async () => {
  const response = await SELF.fetch(makeRequest());
  expect(response.status).toBe(401);
});

it('fails closed without credentials or when GitHub reports a public or different inbox', async () => {
  let requests = 0;
  const responder = (inbox: object): typeof fetch => async () => {
    requests++;
    return Response.json(inbox);
  };
  await expect(sendSupportReport(makeRequest(), env, crypto.randomUUID(), responder(metadata)))
    .rejects.toMatchObject({ status: 503 });
  expect(requests).toBe(0);
  for (const inbox of [{ ...metadata, private: false }, { ...metadata, full_name: 'different/inbox' }]) {
    await expect(sendSupportReport(makeRequest(), ready, crypto.randomUUID(), responder(inbox)))
      .rejects.toMatchObject({ status: 503 });
  }
  expect(requests).toBe(2);
});

it('submits a private issue with recent errors, omits expired entries and respects the send limit', async () => {
  const submitted: string[] = [];
  const responder: typeof fetch = async (url, init) => {
    expect(String(url)).toMatch(/^https:\/\/api\.github\.com\/repos\/markusciani\/stati-support(\/issues)?$/);
    expect(init?.redirect).toBe('error');
    if (init?.method === 'POST') {
      submitted.push(JSON.parse(String(init.body)).body);
      return Response.json({ number: 1 }, { status: 201 });
    }
    return Response.json(metadata);
  };
  const member = crypto.randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await sendSupportReport(makeRequest(), ready, member, responder);
    expect(response.status).toBe(201);
  }
  await expect(sendSupportReport(makeRequest(), ready, member, responder)).rejects.toMatchObject({ status: 429 });
  expect(submitted).toHaveLength(3);
  expect(submitted[0]).toContain(recent());
  expect(submitted[0]).toContain('215 retained on device');
  expect(submitted[0]).not.toContain(expired);
  expect(submitted[0]).not.toContain(member);
});

it('rejects unsanitized diagnostic entries before contacting GitHub', async () => {
  const responder: typeof fetch = async () => { throw new Error('Unexpected request'); };
  await expect(sendSupportReport(makeRequest({ ...report, recentErrors: ['arbitrary log contents'] }), ready, crypto.randomUUID(), responder))
    .rejects.toMatchObject({ status: 400 });
});
