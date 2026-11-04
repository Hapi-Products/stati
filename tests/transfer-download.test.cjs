const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { writeDownload } = require('../desktop/transfer-download.cjs');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture(fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stati-transfer-check-'));
  try { await fn(path.join(directory, 'download.part'), directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}
function response(chunks, headers = {}, options = {}) {
  const buffers = chunks.map(chunk => Buffer.from(chunk));
  let index = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (index < buffers.length) controller.enqueue(buffers[index++]);
      else controller.close();
    },
    cancel: options.cancel,
  }, { highWaterMark: 0 });
  return new Response(body, {
    status: options.status || 200,
    headers: { 'Content-Length': String(buffers.reduce((size, chunk) => size + chunk.length, 0)), ...headers },
  });
}

test('streams exact bytes and accepts an uppercase SHA-256 checksum', () => fixture(async file => {
  const bytes = Buffer.from('Lyrics: Laudă Domnului!\n\0');
  const result = await writeDownload(response([bytes.subarray(0, 3), bytes.subarray(3, 17), bytes.subarray(17)], {
    'X-Checksum-SHA256': digest(bytes).toUpperCase(),
  }), file);
  const identity=await fs.lstat(file,{bigint:true});
  assert.deepEqual(result, { bytes: bytes.length, sha256: digest(bytes), verified: true, temporaryIdentity:{dev:String(identity.dev),ino:String(identity.ino)} });
  assert.deepEqual(await fs.readFile(file), bytes);
  // A successful result leaves the temporary copy available to its caller.
  await fs.rename(file, file + '.closed');
}));

test('same-length corruption is rejected and its partial temporary file is removed', () => fixture(async (file, directory) => {
  const original = Buffer.from('correct lyrics');
  const corrupted = Buffer.from('corrupt lyrics');
  assert.equal(original.length, corrupted.length);
  await assert.rejects(writeDownload(response([corrupted], { 'X-Checksum-SHA256': digest(original) }), file), /File check failed/);
  assert.deepEqual(await fs.readdir(directory), []);
}));

test('legacy downloads without a checksum retain exact-byte compatibility without claiming verification', () => fixture(async file => {
  const bytes = Buffer.from('legacy transfer');
  const result=await writeDownload(response([bytes]),file),identity=await fs.lstat(file,{bigint:true});
  assert.deepEqual(result,{bytes:bytes.length,sha256:digest(bytes),verified:false,temporaryIdentity:{dev:String(identity.dev),ino:String(identity.ino)}});
  assert.deepEqual(await fs.readFile(file), bytes);
}));

test('rejects malformed checksum headers before creating a file and cancels the response', () => fixture(async (file, directory) => {
  for (const checksum of ['', 'sha256:' + 'a'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), 'a'.repeat(65)]) {
    let cancelled = false;
    await assert.rejects(writeDownload(response(['lyrics'], { 'X-Checksum-SHA256': checksum }, {
      cancel() { cancelled = true; },
    }), file), /File check failed/);
    assert.equal(cancelled, true);
    assert.deepEqual(await fs.readdir(directory), []);
  }
}));

test('rejects missing, malformed, unsafe, and oversized content lengths', () => fixture(async (file, directory) => {
  for (const length of [null, '', '0', '-1', '1.5', '1e1', '1, 1', '9007199254740992', '52428801']) {
    const downloaded = response(['x']);
    if (length === null) downloaded.headers.delete('Content-Length');
    else downloaded.headers.set('Content-Length', length);
    await assert.rejects(writeDownload(downloaded, file), /File check failed/);
    assert.deepEqual(await fs.readdir(directory), []);
  }
  await assert.rejects(writeDownload(response(['1234']), file, { maxBytes: 3 }), /File check failed/);
  assert.deepEqual(await fs.readdir(directory), []);
}));

test('rejects truncated and excess bytes and removes their temporary files', () => fixture(async (file, directory) => {
  for (const length of ['2', '9']) {
    await assert.rejects(writeDownload(response(['ab', 'cd'], { 'Content-Length': length }), file), /File check failed/);
    assert.deepEqual(await fs.readdir(directory), []);
  }
}));

test('an existing temporary path is preserved when exclusive creation fails', () => fixture(async file => {
  const existing = Buffer.from('previous download: preserve me');
  await fs.writeFile(file, existing);
  let cancelled = false;
  await assert.rejects(writeDownload(response(['new'], {}, { cancel() { cancelled = true; } }), file), /File check failed/);
  assert.equal(cancelled, true);
  assert.deepEqual(await fs.readFile(file), existing);
}));

test('body errors remove partially written downloads', () => fixture(async (file, directory) => {
  let reads = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (reads++ === 0) controller.enqueue(Buffer.from('partial'));
      else controller.error(new Error('Connection lost'));
    },
  }, { highWaterMark: 0 });
  await assert.rejects(writeDownload(new Response(body, { headers: { 'Content-Length': '20' } }), file), /File check failed/);
  assert.deepEqual(await fs.readdir(directory), []);
}));

test('failed HTTP responses and absent bodies never create a file', () => fixture(async (file, directory) => {
  let cancelled = false;
  await assert.rejects(writeDownload(response(['failed'], {}, { status: 500, cancel() { cancelled = true; } }), file), /File check failed/);
  assert.equal(cancelled, true);
  await assert.rejects(writeDownload(new Response(null, { headers: { 'Content-Length': '0' } }), file), /File check failed/);
  assert.deepEqual(await fs.readdir(directory), []);
}));

test('finishes partial file writes before reading the next chunk', () => fixture(async file => {
  const originalOpen = fs.open;
  let writes = 0;
  let openedHandle;
  let synced = false;
  let closed = false;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    openedHandle = handle;
    const originalWrite = handle.write.bind(handle);
    const originalSync = handle.sync.bind(handle);
    const originalClose = handle.close.bind(handle);
    handle.write = async (buffer, offset, length) => {
      writes++;
      return originalWrite(buffer, offset, Math.min(length, 2));
    };
    handle.sync = async () => { await originalSync(); synced = true; };
    handle.close = async () => { assert.equal(synced, true); await originalClose(); closed = true; };
    return handle;
  };
  try {
    const bytes = Buffer.from('partial writes stay complete');
    const result = await writeDownload(response([bytes.subarray(0, 7), bytes.subarray(7)], {
      'X-Checksum-SHA256': digest(bytes),
    }), file);
    assert.equal(result.verified, true);
    assert.ok(writes > 2);
    assert.equal(synced, true);
    assert.equal(closed, true);
    await assert.rejects(openedHandle.stat(), /closed|EBADF/);
    assert.deepEqual(await fs.readFile(file), bytes);
  } finally { fs.open = originalOpen; }
}));

test('zero-byte downloads are rejected even with an exact empty body and matching checksum', () => fixture(async (file, directory) => {
  const emptyHash = digest(Buffer.alloc(0));
  let cancelled = false;
  await assert.rejects(writeDownload(response([], { 'X-Checksum-SHA256': emptyHash }, {
    cancel() { cancelled = true; },
  }), file), /File check failed/);
  assert.equal(cancelled, true);
  assert.deepEqual(await fs.readdir(directory), []);
  await assert.rejects(writeDownload(response(['x'], { 'Content-Length': '0' }), file), /File check failed/);
  assert.deepEqual(await fs.readdir(directory), []);
}));
