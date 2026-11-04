const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createDiskReserve, DEFAULT_RESERVE_BYTES, lowDiskSpace } = require('../desktop/disk-reserve.cjs');
const { writeDownload } = require('../desktop/transfer-download.cjs');
const recovery = require('../desktop/delivery-recovery.cjs');

async function fixture(run) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'stati-disk-reserve-')));
  try { await run(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
function response(bytes, { cancel, pull } = {}) {
  const chunks = bytes.map(chunk => Buffer.from(chunk)); let next = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (next < chunks.length) { pull?.(next); controller.enqueue(chunks[next++]); }
      else controller.close();
    }, cancel,
  }, { highWaterMark: 0 }), { headers: { 'Content-Length': String(chunks.reduce((sum, chunk) => sum + chunk.length, 0)) } });
}
async function occupied(directory, seen = new Set()) {
  let bytes = 0;
  for (const name of await fs.readdir(directory)) {
    const file = path.join(directory, name), stat = await fs.lstat(file);
    if (stat.isDirectory()) bytes += await occupied(file, seen);
    else if (stat.isFile() && !seen.has(String(stat.ino))) { seen.add(String(stat.ino)); bytes += stat.size; }
  }
  return bytes;
}
function simulatedDisk(directory, capacity = 1000, reserveBytes = 100) {
  const state = { capacity, external: 0, calls: 0 };
  const reserve = createDiskReserve({ reserveBytes, metadataBytes: 0, statfs: async () => {
    state.calls++;
    return { bsize: 1n, bavail: BigInt(Math.max(0, state.capacity - state.external - await occupied(directory))) };
  } });
  return { state, reserve };
}
const lowSpace = { code: 'STATI_LOW_DISK_SPACE', retryable: true };

test('the default reserve protects two GiB', () => assert.equal(DEFAULT_RESERVE_BYTES, 2 * 1024 ** 3));

test('the production defaults also keep 64 KiB for metadata beyond the two-GiB reserve and advertised bytes', () => fixture(async directory => {
  let available = BigInt(DEFAULT_RESERVE_BYTES) + 65536n + 4096n - 1n;
  const reserve = createDiskReserve({ statfs: async () => ({ bsize: 1n, bavail: available }) });
  await assert.rejects(reserve.acquire(directory, 4096), lowSpace);
  available++;
  const reservation = await reserve.acquire(directory, 4096);
  await reservation.check(); await reservation.release();
  assert.deepEqual(await fs.readdir(directory), []);
}));

test('the automatic delivery policy keeps a low-space transfer queued for a later retry', async () => {
  const { createTransferRetry } = require('../desktop/transfer-retry.cjs');
  let attempts = 0, time = 0;
  const policy = createTransferRetry({ now: () => time, deliver: async () => { if (++attempts === 1) throw lowDiskSpace(); return { saved: true }; } });
  const queue = [{ id: 'space-limited-transfer', status: 'queued', sender_role: 'admin' }];
  assert.equal((await policy.observe(queue)).status, 'retry');
  time = 8000;
  assert.equal((await policy.observe(queue)).status, 'saved');
  assert.equal(attempts, 2);
});

test('refuses advertised incoming bytes before creating a file, cancels input, and preserves old files', () => fixture(async directory => {
  await fs.writeFile(path.join(directory, 'existing.txt'), 'Keep this song.');
  const { reserve } = simulatedDisk(directory, 120); let cancelled = false;
  await assert.rejects(writeDownload(response(['1234567890'], { cancel() { cancelled = true; } }), path.join(directory, 'incoming.part'), { diskReserve: reserve }), lowSpace);
  assert.equal(cancelled, true);
  assert.deepEqual(await fs.readdir(directory), ['existing.txt']);
  assert.equal(await fs.readFile(path.join(directory, 'existing.txt'), 'utf8'), 'Keep this song.');
}));

test('a file that exactly preserves the reserve streams successfully with real temporary files', () => fixture(async directory => {
  const { reserve, state } = simulatedDisk(directory, 106);
  const file = path.join(directory, 'incoming.part');
  const checked = await writeDownload(response(['abc', 'def']), file, { diskReserve: reserve });
  assert.equal(checked.bytes, 6); assert.equal(await fs.readFile(file, 'utf8'), 'abcdef');
  assert.equal(state.capacity - await occupied(directory), 100);
  assert.ok(state.calls >= 6, 'preflight plus checks around each write and flush');
}));

test('an external space change between chunks removes only this partial download and remains retryable', () => fixture(async directory => {
  const { reserve, state } = simulatedDisk(directory, 110), file = path.join(directory, 'incoming.part');
  await assert.rejects(writeDownload(response(['abc', 'def'], { pull(index) { if (index === 1) state.external = 5; } }), file, { diskReserve: reserve }), lowSpace);
  assert.deepEqual(await fs.readdir(directory), []);
  state.external = 0;
  assert.equal((await writeDownload(response(['abcdef']), file, { diskReserve: reserve })).bytes, 6);
}));

test('an allocation block is reserved even for a one-byte file', () => fixture(async directory => {
  const reserve = createDiskReserve({ reserveBytes: 4096, metadataBytes: 0, statfs: async () => ({ bsize: 4096n, bavail: 1n }) });
  await assert.rejects(reserve.acquire(directory, 1), lowSpace);
}));

test('concurrent downloads in different folders share their filesystem reservation', () => fixture(async directory => {
  const first = path.join(directory, 'one'), second = path.join(directory, 'two');
  await fs.mkdir(first); await fs.mkdir(second);
  const { reserve } = simulatedDisk(directory, 110);
  const one = await reserve.acquire(first, 8);
  await assert.rejects(reserve.acquire(second, 8), lowSpace);
  await one.release();
  const two = await reserve.acquire(second, 8); await two.release();
}));

test('backup and staged-file writes on different destination filesystems keep independent reserves and existing originals', () => fixture(async directory => {
  const backups = path.join(directory, 'backups'), staged = path.join(directory, 'staged');
  await fs.mkdir(backups); await fs.mkdir(staged);
  await fs.writeFile(path.join(backups, 'original'), 'original');
  await fs.writeFile(path.join(staged, 'original'), 'original');
  // Supplied filesystem identities model two different destination volumes;
  // actual writes and preserved originals still use real temporary files.
  const reserve = createDiskReserve({ reserveBytes: 100, metadataBytes: 0,
    stat: async folder => ({ dev: folder === backups ? 1n : 2n }),
    statfs: async folder => ({ bsize: 1n, bavail: BigInt(116 - await occupied(folder)) }),
  });
  const backup = await reserve.acquire(backups, 8), stage = await reserve.acquire(staged, 8);
  try {
    await Promise.all([
      backup.write(8, () => fs.writeFile(path.join(backups, 'recovery.bin'), 'original')),
      stage.write(8, () => fs.writeFile(path.join(staged, '.stati-sync.tmp'), 'new text')),
    ]);
    await Promise.all([backup.check(), stage.check()]);
  } finally { await Promise.all([backup.release(), stage.release()]); }
  for (const folder of [backups, staged]) {
    assert.equal(await fs.readFile(path.join(folder, 'original'), 'utf8'), 'original');
    assert.equal(116 - await occupied(folder), 100);
  }
}));

test('completed chunks consume reservations without counting the same bytes twice', () => fixture(async directory => {
  const { reserve, state } = simulatedDisk(directory, 116);
  const [one, two] = await Promise.all([reserve.acquire(directory, 8), reserve.acquire(directory, 8)]);
  await Promise.all([
    one.write(8, () => fs.writeFile(path.join(directory, 'one'), '12345678')),
    two.write(8, () => fs.writeFile(path.join(directory, 'two'), '12345678')),
  ]);
  await Promise.all([one.release(), two.release()]);
  assert.equal(state.capacity - await occupied(directory), 100);
}));

test('unavailable or malformed filesystem information refuses intake with a recoverable explanation', () => fixture(async directory => {
  for (const statfs of [async () => { throw Object.assign(Error('Drive disconnected'), { code: 'EIO' }); }, async () => ({ bsize: 0n, bavail: 10n })]) {
    const reserve = createDiskReserve({ reserveBytes: 100, metadataBytes: 0, statfs });
    await assert.rejects(writeDownload(response(['abc']), path.join(directory, 'incoming.part'), { diskReserve: reserve }), { code: 'STATI_DISK_SPACE_UNAVAILABLE', retryable: true });
    assert.deepEqual(await fs.readdir(directory), []);
  }
}));

test('an operating-system ENOSPC error stays recoverable and cleans its owned partial download', () => fixture(async directory => {
  const { reserve } = simulatedDisk(directory), file = path.join(directory, 'incoming.part'), originalOpen = fs.open;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === file && args[1] === 'wx') {
      const write = handle.write.bind(handle);
      handle.write = async () => { await write(Buffer.from('a')); throw Object.assign(Error('No room'), { code: 'ENOSPC' }); };
    }
    return handle;
  };
  try { await assert.rejects(writeDownload(response(['abc']), file, { diskReserve: reserve }), lowSpace); }
  finally { fs.open = originalOpen; }
  assert.deepEqual(await fs.readdir(directory), []);
}));

async function delivery(directory) {
  const id = crypto.randomUUID(), temporaryPath = path.join(directory, '.stati-' + id + '-' + crypto.randomUUID() + '.part'), bytes = Buffer.from('song lyrics');
  await fs.writeFile(temporaryPath, bytes);
  return { id, downloadsDirectory: directory, temporaryPath, filename: 'song.txt', checked: { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), verified: true } };
}

test('low-space refusal reserves copy fallback workspace before creating a checkpoint and permits retry', () => fixture(async directory => {
  const options = await delivery(directory), { reserve, state } = simulatedDisk(directory, 120);
  await assert.rejects(recovery.prepareDelivery({ ...options, diskReserve: reserve }), lowSpace);
  assert.deepEqual(await fs.readdir(directory), [path.basename(options.temporaryPath)]);
  state.capacity = 1000;
  assert.equal((await recovery.prepareDelivery({ ...options, diskReserve: reserve })).path, path.join(directory, 'song.txt'));
}));

test('low-space fallback-copy interruption cleans only its exclusive partial file and can retry the same transfer', () => fixture(async directory => {
  const options = await delivery(directory), { reserve } = simulatedDisk(directory, 10000), originalLink = fs.link, originalOpen = fs.open;
  let fail = true;
  fs.link = async () => { throw Object.assign(Error('Links unavailable'), { code: 'ENOTSUP' }); };
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).endsWith('/payload.part') && args[1] === 'wx' && fail) {
      const write = handle.write.bind(handle);
      handle.write = async () => { fail = false; await write(Buffer.from('a')); throw Object.assign(Error('Full drive'), { code: 'ENOSPC' }); };
    }
    return handle;
  };
  try {
    await assert.rejects(recovery.prepareDelivery({ ...options, diskReserve: reserve }), lowSpace);
    assert.deepEqual(await fs.readdir(directory), [path.basename(options.temporaryPath)]);
    const saved = await recovery.prepareDelivery({ ...options, diskReserve: reserve });
    assert.equal(await fs.readFile(saved.path, 'utf8'), 'song lyrics');
    assert.deepEqual(await recovery.recoverDelivery({ ...options, diskReserve: reserve }), saved);
  } finally { fs.link = originalLink; fs.open = originalOpen; }
}));
