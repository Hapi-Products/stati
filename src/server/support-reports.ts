import { z } from 'zod';
import { body, HttpError, json, now } from './core';

const inbox = 'markusciani/stati-support';
const api = 'https://api.github.com/repos/' + inbox;
const errorLine = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z · (Connection|Account|Songs|Services|Groups|Files) · (Network request failed|Unexpected server response|Request failed \(HTTP [1-5]\d{2}\))$/;
const reportSchema = z.strictObject({
  description: z.string().trim().max(8000),
  version: z.string().regex(/^\d{1,5}\.\d{1,5}\.\d{1,5} \(\d{1,10}\)$/),
  platform: z.enum(['iOS', 'iPadOS']),
  systemVersion: z.string().regex(/^\d{1,3}(\.\d{1,3}){1,2}$/),
  siriStatus: z.enum(['ready', 'olderSystem', 'unsupportedDevice', 'intelligenceOff', 'preparing', 'unavailable']),
  recentErrors: z.array(z.string().max(120).regex(errorLine)).max(200),
  errorCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).refine(report => report.errorCount >= report.recentErrors.length, 'Invalid error count.');

const inboxSchema = z.object({ full_name: z.string(), private: z.literal(true), has_issues: z.literal(true), archived: z.literal(false) });

function unavailable() {
  return new HttpError(503, 'Private reporting is temporarily unavailable. Please try again later.');
}

export async function sendSupportReport(request: Request, env: Env, userId: string, fetcher = fetch): Promise<Response> {
  if (request.headers.get('Origin') !== env.APP_ORIGIN) throw new HttpError(403, 'A same-origin request is required.');
  if (!env.STATI_SUPPORT_GITHUB_TOKEN) throw unavailable();
  const report = await body(request, reportSchema, 64 * 1024);

  const time = now();
  const reservation = await env.DB.prepare(`
    INSERT INTO rate_limits(key, count, expires_at) VALUES(?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN expires_at <= ? THEN 1 ELSE count + 1 END,
      expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    WHERE expires_at <= ? OR count < 3
  `).bind('support-report:' + userId, time + 600, time, time, time).run();
  if (!reservation.meta.changes) throw new HttpError(429, 'Too many reports. Please try again in a few minutes.');

  const headers = {
    Authorization: 'Bearer ' + env.STATI_SUPPORT_GITHUB_TOKEN,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Stati-Support',
  };
  let response: Response;
  try {
    const repository = await fetcher(api, { headers, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!repository.ok) {
      await repository.body?.cancel();
      throw unavailable();
    }
    const verified = inboxSchema.safeParse(await repository.json());
    if (!verified.success || verified.data.full_name.toLowerCase() !== inbox) throw unavailable();
  } catch {
    throw unavailable();
  }
  const lines = report.recentErrors.filter(line => {
    const stamp = Date.parse(line.slice(0, 20)) / 1000;
    return stamp > time - 86400 && stamp <= time + 300;
  });
  const formatBlock = (text: string) => text.split(/\r?\n/).map(line => '    ' + line).join('\n');
  const issueBody = [
    '### App information',
    'Stați ' + report.version + ' · ' + report.platform + ' ' + report.systemVersion,
    'Siri AI preview status — ' + report.siriStatus,
    '### What happened?',
    report.description ? formatBlock(report.description) : 'No description provided.',
    '### Recent errors',
    report.errorCount > lines.length ? lines.length + ' most recent entries included out of ' + report.errorCount + ' retained on device.' : '',
    lines.length ? formatBlock(lines.join('\n')) : 'No recent errors.',
  ].filter(Boolean).join('\n\n');

  try {
    response = await fetcher(api + '/issues', {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(7000),
      body: JSON.stringify({ title: 'Stați app report · ' + report.platform + ' · ' + report.version, body: issueBody }),
    });
  } catch {
    throw new HttpError(502, 'Stați could not confirm delivery. Please wait before sending another report.');
  }
  const created = response.status === 201;
  await response.body?.cancel();
  if (!created) throw unavailable();
  return json({ ok: true }, 201);
}
