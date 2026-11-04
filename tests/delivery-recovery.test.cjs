const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const recovery = require('../desktop/delivery-recovery.cjs');
const { saveReceipt } = require('../desktop/station-files.cjs');

const id = 'f203b8b1-18c4-490f-8fd8-7f49c2aabc12';
const bytes = Buffer.from('Împreună cântăm!\nTogether we prepare.');
const checked = { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), verified: true };

async function fixture(run) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'stati-delivery-recovery-'));
  const downloadsDirectory = await fs.realpath(temporary);
  const temporaryPath = path.join(downloadsDirectory, '.stati-' + id + '-' + crypto.randomUUID() + '.part');
  await fs.writeFile(temporaryPath, bytes, { mode: 0o600 });
  const options = { downloadsDirectory, id, temporaryPath, filename: 'Laudă.txt', checked };
  const folder = path.join(downloadsDirectory, '.stati-deliveries', id);
  try { await run({ options, folder, downloadsDirectory, temporaryPath, destination: path.join(downloadsDirectory, options.filename) }); }
  finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

async function absent(filename) { await assert.rejects(fs.lstat(filename), { code: 'ENOENT' }); }
async function stopBeforePublication(options, folder) {
  let checks = 0;
  await assert.rejects(recovery.prepareDelivery({ ...options, checkActive() {
    checks++;
    if (checks === 3) throw new Error('Receiver stopped before publication.');
  } }), /Receiver stopped/);
  assert.equal(checks, 3);
  assert.ok((await fs.lstat(path.join(folder, 'checkpoint.json'))).isFile());
}

test('receipt persistence failure recovers the verified destination after a fresh module load without another file', () => fixture(async ({ options, downloadsDirectory, folder }) => {
  const saved = await recovery.prepareDelivery(options);
  const before = await fs.stat(saved.path, { bigint: true });
  const receipts = path.join(downloadsDirectory, 'receipts.json');
  await fs.writeFile(receipts, 'damaged records');
  await assert.rejects(saveReceipt(receipts, id, saved.path));
  await fs.unlink(options.temporaryPath);
  delete require.cache[require.resolve('../desktop/delivery-recovery.cjs')];
  const restarted = require('../desktop/delivery-recovery.cjs');
  assert.deepEqual(await restarted.recoverDelivery(options), saved);
  assert.equal((await fs.stat(saved.path, { bigint: true })).ino, before.ino);
  assert.equal((await fs.readdir(downloadsDirectory)).filter(name => name.endsWith('.txt')).length, 1);
  await fs.rename(receipts, receipts + '.preserved');
  await saveReceipt(receipts, id, saved.path);
  await restarted.completeDelivery({ ...options, path: saved.path });
  await absent(folder);
  assert.deepEqual(await fs.readFile(saved.path), bytes);
  assert.equal(JSON.parse(await fs.readFile(receipts, 'utf8'))[id], saved.path);
  assert.equal(await fs.readFile(receipts + '.preserved', 'utf8'), 'damaged records');
}));

test('an ACK failure retains verification records and saved bytes until confirmation succeeds', () => fixture(async ({ options, downloadsDirectory, folder }) => {
  const saved = await recovery.prepareDelivery(options);
  const receiptPath = path.join(downloadsDirectory, 'deliveries.json');
  await saveReceipt(receiptPath, id, saved.path);
  assert.deepEqual(await recovery.verifyDelivery({ ...options, path: saved.path }), { verified: true });
  await assert.rejects(async () => { throw Error('Network interrupted before ACK.'); }, /Network interrupted/);
  assert.ok((await fs.lstat(path.join(folder, 'checkpoint.json'))).isFile());
  assert.deepEqual(await recovery.verifyDelivery({ ...options, path: saved.path }), { verified: true });
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'))[id];
  assert.equal(receipt, saved.path);
  assert.deepEqual(await fs.readFile(receipt), bytes);
  assert.equal((await fs.readdir(downloadsDirectory)).filter(name => name.endsWith('.txt')).length, 1);
  await recovery.completeDelivery({ ...options, path: saved.path });
  await absent(folder);
}));

test('a checkpoint committed before final publication recovers safely after the receiver stops', () => fixture(async ({ options, folder, destination, temporaryPath }) => {
  await stopBeforePublication(options, folder);
  await absent(destination);
  await fs.unlink(temporaryPath);
  const saved = await recovery.recoverDelivery(options);
  assert.equal(saved.path, destination);
  assert.deepEqual(await fs.readFile(destination), bytes);
  await recovery.completeDelivery({ ...options, path: destination });
  await absent(folder);
}));

test('recovering a checkpoint remains blocked while the receiver is inactive', () => fixture(async ({ options, folder, destination }) => {
  await stopBeforePublication(options, folder);
  await assert.rejects(recovery.recoverDelivery({ ...options, checkActive() { throw Error('No longer authorized.'); } }), /No longer authorized/);
  await absent(destination);
  const controller = new AbortController(); controller.abort(new Error('Stați is closing.'));
  await assert.rejects(recovery.recoverDelivery({ ...options, signal: controller.signal }), /Stați is closing/);
  await absent(destination);
  assert.ok((await fs.lstat(path.join(folder, 'payload.part'))).isFile());
}));

test('an already-aborted delivery leaves the verified temporary download and publishes nothing', () => fixture(async ({ options, destination, folder, temporaryPath }) => {
  const controller = new AbortController(); controller.abort(new Error('Delivery cancelled.'));
  await assert.rejects(recovery.prepareDelivery({ ...options, signal: controller.signal }), /Delivery cancelled/);
  await absent(folder); await absent(destination);
  assert.deepEqual(await fs.readFile(temporaryPath), bytes);
}));

test('existing filenames are preserved and only one stable suffixed destination is recovered', () => fixture(async ({ options, downloadsDirectory, destination }) => {
  await fs.writeFile(destination, 'Keep the original.');
  await fs.writeFile(path.join(downloadsDirectory, 'Laudă (1).txt'), 'Keep this too.');
  const saved = await recovery.prepareDelivery(options);
  assert.equal(saved.path, path.join(downloadsDirectory, 'Laudă (2).txt'));
  assert.deepEqual(await recovery.recoverDelivery(options), saved);
  assert.equal(await fs.readFile(destination, 'utf8'), 'Keep the original.');
  assert.equal(await fs.readFile(path.join(downloadsDirectory, 'Laudă (1).txt'), 'utf8'), 'Keep this too.');
  assert.equal((await fs.readdir(downloadsDirectory)).filter(name => name.endsWith('.txt')).length, 3);
}));

test('an unrelated file appearing at the checkpoint destination is preserved and blocks automatic retry', () => fixture(async ({ options, folder, destination }) => {
  await stopBeforePublication(options, folder);
  await fs.writeFile(destination, 'Someone saved another file.');
  await assert.rejects(recovery.recoverDelivery(options), { code: 'STATI_RECOVERY_REQUIRED', retryable: false });
  assert.equal(await fs.readFile(destination, 'utf8'), 'Someone saved another file.');
  await absent(path.join(options.downloadsDirectory, 'Laudă (1).txt'));
}));

test('same-size corruption in a saved file is preserved and never acknowledged as a valid recovery', () => fixture(async ({ options, destination }) => {
  await recovery.prepareDelivery(options);
  const corrupt = Buffer.from(bytes); corrupt[0] ^= 1;
  await fs.writeFile(destination, corrupt);
  await assert.rejects(recovery.recoverDelivery(options), { code: 'STATI_RECOVERY_REQUIRED' });
  await assert.rejects(recovery.verifyDelivery({ ...options, path: destination }), { code: 'STATI_RECOVERY_REQUIRED' });
  await assert.rejects(recovery.completeDelivery({ ...options, path: destination }), { code: 'STATI_RECOVERY_REQUIRED' });
  assert.deepEqual(await fs.readFile(destination), corrupt);
}));

test('pre-ACK verification preserves records and blocks missing or substituted saved files', () => fixture(async ({ options, destination, folder }) => {
  await recovery.prepareDelivery(options);
  await fs.rename(destination, destination + '.original');
  await assert.rejects(recovery.verifyDelivery({ ...options, path: destination }), { code: 'STATI_RECOVERY_REQUIRED', retryable: false });
  await fs.writeFile(destination, bytes);
  await assert.rejects(recovery.verifyDelivery({ ...options, path: destination }), { code: 'STATI_RECOVERY_REQUIRED' });
  await assert.rejects(recovery.verifyDelivery({ ...options, path: destination + '.original' }), { code: 'STATI_RECOVERY_REQUIRED' });
  assert.ok((await fs.lstat(path.join(folder, 'checkpoint.json'))).isFile());
  assert.deepEqual(await fs.readFile(destination + '.original'), bytes);
}));

test('pre-ACK verification distinguishes legacy missing records and checks active authorization', () => fixture(async ({ options, destination, folder }) => {
  assert.equal(await recovery.verifyDelivery({ ...options, path: destination }), null);
  await recovery.prepareDelivery(options);
  await assert.rejects(recovery.verifyDelivery({ ...options, path: destination, checkActive: () => false }), { code: 'ABORT_ERR' });
  const controller = new AbortController(); controller.abort(Error('Delivery stopped.'));
  await assert.rejects(recovery.verifyDelivery({ ...options, path: destination, signal: controller.signal }), /Delivery stopped/);
  await fs.unlink(path.join(folder, 'checkpoint.json'));
  await assert.rejects(recovery.verifyDelivery({ ...options, path: destination }), { code: 'STATI_RECOVERY_REQUIRED' });
}));

test('a substituted final file with identical contents is retained but cannot inherit the saved identity', () => fixture(async ({ options, destination }) => {
  await recovery.prepareDelivery(options);
  await fs.rename(destination, destination + '.original');
  await fs.writeFile(destination, bytes);
  await assert.rejects(recovery.recoverDelivery(options), { code: 'STATI_RECOVERY_REQUIRED' });
  assert.deepEqual(await fs.readFile(destination), bytes);
  assert.deepEqual(await fs.readFile(destination + '.original'), bytes);
}));

test('corrupt and traversal-bearing checkpoint records are never overwritten or followed', () => fixture(async ({ options, folder, destination }) => {
  await stopBeforePublication(options, folder);
  const recordPath = path.join(folder, 'checkpoint.json');
  const original = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  for (const record of ['broken JSON', JSON.stringify({ ...original, filename: '../outside.txt' }), JSON.stringify({ ...original, filename: 'C:\\outside.txt' }), JSON.stringify({ ...original, id: 'another-transfer-id-value' })]) {
    await fs.writeFile(recordPath, record);
    await assert.rejects(recovery.recoverDelivery(options), { code: 'STATI_RECOVERY_REQUIRED' });
    await assert.rejects(recovery.prepareDelivery(options), { code: 'STATI_RECOVERY_REQUIRED' });
    assert.equal(await fs.readFile(recordPath, 'utf8'), record);
    await absent(destination);
  }
}));

test('symlink final destinations and checkpoint records are rejected without changing their targets', () => fixture(async ({ options, folder, destination, downloadsDirectory }) => {
  await stopBeforePublication(options, folder);
  const target = path.join(downloadsDirectory, 'target');
  await fs.writeFile(target, bytes);
  await fs.symlink(target, destination);
  await assert.rejects(recovery.recoverDelivery(options), { code: 'STATI_RECOVERY_REQUIRED' });
  assert.deepEqual(await fs.readFile(target), bytes);
  await fs.unlink(destination);
  const recordPath = path.join(folder, 'checkpoint.json');
  await fs.rename(recordPath, recordPath + '.original');
  await fs.symlink(recordPath + '.original', recordPath);
  await assert.rejects(recovery.recoverDelivery(options), { code: 'STATI_RECOVERY_REQUIRED' });
  assert.ok((await fs.lstat(recordPath)).isSymbolicLink());
  await absent(destination);
}));

test('symlink checkpoint folders and temporary sources cannot be used for publication', () => fixture(async ({ options, downloadsDirectory, temporaryPath, folder, destination }) => {
  const unrelated = path.join(downloadsDirectory, 'unrelated'); await fs.mkdir(unrelated);
  await fs.symlink(unrelated, path.join(downloadsDirectory, '.stati-deliveries'));
  await assert.rejects(recovery.prepareDelivery(options), { code: 'STATI_RECOVERY_REQUIRED' });
  await fs.unlink(path.join(downloadsDirectory, '.stati-deliveries'));
  await fs.rename(temporaryPath, temporaryPath + '.original');
  await fs.symlink(temporaryPath + '.original', temporaryPath);
  await assert.rejects(recovery.prepareDelivery(options), { code: 'STATI_RECOVERY_REQUIRED' });
  assert.deepEqual(await fs.readFile(temporaryPath + '.original'), bytes);
  await absent(folder); await absent(destination);
}));

test('unsafe filenames, non-owned temporary paths, and changed verified bytes are rejected before publication', () => fixture(async ({ options, destination, temporaryPath }) => {
  for (const filename of ['../song.txt', '/song.txt', 'C:\\song.txt', 'CON.txt', 'name.', 'song\0.txt']) {
    await assert.rejects(recovery.prepareDelivery({ ...options, filename }), /Invalid verified download/);
  }
  await assert.rejects(recovery.prepareDelivery({ ...options, temporaryPath: path.join(options.downloadsDirectory, 'original.txt') }), /Invalid verified temporary/);
  await fs.writeFile(temporaryPath, Buffer.alloc(bytes.length, 1));
  await assert.rejects(recovery.prepareDelivery(options), { code: 'STATI_RECOVERY_REQUIRED' });
  await absent(destination);
}));

test('a torn checkpoint write is retained and never retried as a second saved copy', () => fixture(async ({ options, folder, destination }) => {
  const originalOpen = fs.open;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (args[0] === path.join(folder, 'checkpoint.json') && args[1] === 'wx') {
      handle.writeFile = async () => { await handle.write('{'); throw new Error('Disk write failed.'); };
    }
    return handle;
  };
  try { await assert.rejects(recovery.prepareDelivery(options), /Disk write failed/); }
  finally { fs.open = originalOpen; }
  await absent(destination);
  assert.equal(await fs.readFile(path.join(folder, 'checkpoint.json'), 'utf8'), '{');
  await assert.rejects(recovery.recoverDelivery(options), { code: 'STATI_RECOVERY_REQUIRED', retryable: false });
  assert.deepEqual(await fs.readFile(path.join(folder, 'payload.part')), bytes);
}));

test('unsupported hard links fall back to verified exclusive copies and recover their distinct file identity', () => fixture(async ({ options, folder, destination, temporaryPath }) => {
  const originalLink = fs.link;
  fs.link = async () => { throw Object.assign(Error('Links unsupported on this volume.'), { code: 'ENOTSUP' }); };
  try {
    const saved = await recovery.prepareDelivery(options);
    assert.equal(saved.path, destination);
    const [payload, final] = await Promise.all([fs.stat(path.join(folder, 'payload.part')), fs.stat(destination)]);
    assert.notEqual(payload.ino, final.ino);
    assert.ok((await fs.lstat(path.join(folder, 'destination.json'))).isFile());
    await fs.unlink(temporaryPath);
    assert.deepEqual(await recovery.recoverDelivery(options), saved);
    await recovery.completeDelivery({ ...options, path: saved.path });
    await absent(folder);
    assert.deepEqual(await fs.readFile(destination), bytes);
  } finally { fs.link = originalLink; }
}));

test('fallback copy interruption retains partial data and prevents duplicate or overwritten final files', () => fixture(async ({ options, folder, destination }) => {
  const originalLink = fs.link, originalOpen = fs.open;
  fs.link = async () => { throw Object.assign(Error('Links unsupported.'), { code: 'ENOTSUP' }); };
  fs.open = async (target, flags, ...args) => {
    const handle = await originalOpen(target, flags, ...args);
    if (target === destination && flags === 'wx') {
      const write = handle.write.bind(handle);
      handle.write = async () => { await write(Buffer.from('partial')); throw Error('Disk copy interrupted.'); };
    }
    return handle;
  };
  try { await assert.rejects(recovery.prepareDelivery(options), /Disk copy interrupted/); }
  finally { fs.link = originalLink; fs.open = originalOpen; }
  await assert.rejects(recovery.recoverDelivery(options), { code: 'STATI_RECOVERY_REQUIRED', retryable: false });
  assert.equal(await fs.readFile(destination, 'utf8'), 'partial');
  assert.deepEqual(await fs.readFile(path.join(folder, 'payload.part')), bytes);
  await absent(path.join(options.downloadsDirectory, 'Laudă (1).txt'));
}));

test('fallback copy refuses a destination created by another app immediately before publication', () => fixture(async ({ options, destination }) => {
  const originalLink = fs.link, originalOpen = fs.open;
  fs.link = async () => { throw Object.assign(Error('Links unsupported.'), { code: 'ENOTSUP' }); };
  fs.open = async (target, flags, ...args) => {
    if (target === destination && flags === 'wx') {
      const other = await originalOpen(target, 'wx', 0o600);
      await other.writeFile('Retain this new file.'); await other.close();
    }
    return originalOpen(target, flags, ...args);
  };
  try { await assert.rejects(recovery.prepareDelivery(options), { code: 'STATI_RECOVERY_REQUIRED' }); }
  finally { fs.link = originalLink; fs.open = originalOpen; }
  assert.equal(await fs.readFile(destination, 'utf8'), 'Retain this new file.');
}));

test('concurrent attempts for one transfer share one checkpoint and destination', () => fixture(async ({ options, downloadsDirectory }) => {
  const saved = await Promise.all([recovery.prepareDelivery(options), recovery.prepareDelivery(options), recovery.recoverDelivery(options)]);
  assert.deepEqual(saved[0], saved[1]); assert.deepEqual(saved[1], saved[2]);
  assert.equal((await fs.readdir(downloadsDirectory)).filter(name => name.endsWith('.txt')).length, 1);
}));

test('concurrent different transfers with the same filename receive distinct stable destinations', () => fixture(async ({ options, downloadsDirectory }) => {
  const otherId = '8b9ed220-79c8-4d94-a79b-6fd77e02ab71';
  const otherPath = path.join(downloadsDirectory, '.stati-' + otherId + '-' + crypto.randomUUID() + '.part');
  await fs.writeFile(otherPath, bytes, { mode: 0o600 });
  const other = { ...options, id: otherId, temporaryPath: otherPath };
  const [first, second] = await Promise.all([recovery.prepareDelivery(options), recovery.prepareDelivery(other)]);
  assert.notEqual(first.path, second.path);
  assert.deepEqual(await recovery.recoverDelivery(options), first);
  assert.deepEqual(await recovery.recoverDelivery(other), second);
  assert.equal((await fs.readdir(downloadsDirectory)).filter(name => name.endsWith('.txt')).length, 2);
}));

test('a false active callback is also a cancellation and never publishes a final file', () => fixture(async ({ options, destination }) => {
  await assert.rejects(recovery.prepareDelivery({ ...options, checkActive: () => false }), { code: 'ABORT_ERR' });
  await absent(destination);
}));

test('legacy transfers preserve their compatibility label while still verifying local checkpoint bytes', () => fixture(async ({ options }) => {
  const saved = await recovery.prepareDelivery({ ...options, checked: { ...checked, verified: false } });
  assert.equal(saved.integrity, 'legacy');
  assert.deepEqual(await recovery.recoverDelivery(options), saved);
}));

test('cleanup never deletes a substituted checkpoint payload or an unexpected file in its directory', () => fixture(async ({ options, folder, destination }) => {
  await recovery.prepareDelivery(options);
  const payload = path.join(folder, 'payload.part');
  await fs.rename(payload, payload + '.original');
  await fs.writeFile(payload, 'Keep the replacement.');
  await assert.rejects(recovery.completeDelivery({ ...options, path: destination }), { code: 'STATI_RECOVERY_REQUIRED' });
  assert.equal(await fs.readFile(payload, 'utf8'), 'Keep the replacement.');
  assert.deepEqual(await fs.readFile(destination), bytes);
  assert.deepEqual(await fs.readFile(payload + '.original'), bytes);
}));

test('fallback copies open a writable verified handle before flushing for Windows',()=>fixture(async({options})=>{
 const originalLink=fs.link,originalOpen=fs.open;let writableFlushes=0;
 fs.link=async()=>{throw Object.assign(Error('Links unsupported.'),{code:'ENOTSUP'});};
 fs.open=async(filename,flags,...args)=>{
  const handle=await originalOpen(filename,flags,...args),sync=handle.sync.bind(handle),stat=await handle.stat();
  if(stat.isFile()&&(filename===path.join(options.downloadsDirectory,options.filename)||filename.endsWith('/payload.part'))&&(typeof flags==='number'||flags==='wx'))handle.sync=async()=>{
   if(flags!=='wx'&&(flags&require('node:fs').constants.O_RDWR)===0)throw Object.assign(Error('FlushFileBuffers requires write access.'),{code:'EPERM'});
   writableFlushes++;return sync();
  };
  return handle;
 };
 try{const saved=await recovery.prepareDelivery(options);assert.ok(saved.path);assert.equal(writableFlushes,2);await recovery.completeDelivery({...options,path:saved.path});}
 finally{fs.link=originalLink;fs.open=originalOpen;}
}));
