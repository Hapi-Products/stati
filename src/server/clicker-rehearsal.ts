import { z } from 'zod';
import { body, hash, HttpError, json } from './core';
import { requireSongStation } from './station-catalog';

const command = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('arm'), receiver: z.string().uuid() }),
  z.strictObject({ action: z.literal('start'), run: z.string().uuid() }),
  z.strictObject({ action: z.literal('sample'), run: z.string().uuid(), sequence: z.number().int().min(1).max(5), page: z.number().int().min(0).max(7) }),
  z.strictObject({ action: z.literal('ack'), receiver: z.string().uuid(), run: z.string().uuid(), sequence: z.number().int().min(1).max(5) }),
]);
type Command = z.infer<typeof command>;
type Sample = { sequence: number; page: number; sentAt: number; acknowledgedAt?: number };
type Rehearsal = { receiver: string; expiresAt: number; run?: string; startedAt?: number; samples: Sample[] };

// One short-lived test per signed-in account and computer. This never touches a live reader.
export async function clickerRehearsal(request: Request, env: Env, computer: string) {
  const { user, ministryRole, capabilities } = await requireSongStation(request, env, computer);
  if (!capabilities.planServices && ministryRole !== 'pastor') throw new HttpError(403, 'This account cannot use the clicker.');
  const room = env.TASK_EVENTS.getByName('clicker-rehearsal:' + await hash(user.id + ':' + computer));
  const input = request.method === 'POST' ? await body(request, command, 512) : null;
  return room.rehearsal(input);
}

export async function rehearse(storage: DurableObjectStorage, input: Command | null): Promise<Response> {
  const time = Date.now();
  return storage.transaction(async transaction => {
    const stored = await transaction.get<Rehearsal>('test');
    const current = stored && stored.expiresAt > time ? stored : undefined;
    if (!input) {
      return json(current ? { armed: true, run: current.run, samples: current.samples } : { armed: false });
    }
    if (input.action === 'arm') {
      if (current && current.receiver !== input.receiver) return json({ error: 'Another iPad is ready for this test.' }, 409);
      if (current?.startedAt && time - current.startedAt < 12_000) return json({ ok: true });
      await transaction.put('test', { receiver: input.receiver, expiresAt: time + 30_000, samples: [] });
      return json({ ok: true });
    }
    if (!current) return json({ error: 'Open Clicker Test on the iPad first.' }, 409);
    if (input.action === 'start') {
      if (current.startedAt && time - current.startedAt < 12_000) return json({ error: 'A clicker test is already running.' }, 409);
      await transaction.put('test', { ...current, run: input.run, startedAt: time, expiresAt: time + 14_000, samples: [] });
      return json({ ok: true });
    }
    if (input.run !== current.run || !current.startedAt) return json({ error: 'The clicker test ended.' }, 409);
    if (input.action === 'sample') {
      if (time - current.startedAt >= 10_000 || input.sequence !== current.samples.length + 1) {
        return json({ error: 'This test sample is out of order or arrived too late.' }, 409);
      }
      current.samples.push({ sequence: input.sequence, page: input.page, sentAt: time });
    } else {
      if (input.receiver !== current.receiver) return json({ error: 'This iPad is not receiving the test.' }, 409);
      const sample = current.samples.find(sample => sample.sequence === input.sequence);
      if (!sample) return json({ error: 'The test page was not sent.' }, 409);
      sample.acknowledgedAt ??= time;
    }
    await transaction.put('test', current);
    return json({ ok: true });
  });
}
