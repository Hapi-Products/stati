const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { saveReceipt, renameSavedFile } = require('../desktop/station-files.cjs');

const contents = Buffer.from([0, 255, 1, 130, 70, 10, 0, 9]);
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stati-rename-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const receipts = path.join(dir, 'deliveries.json');
  const source = path.join(dir, 'original.PPTX');
  await fs.writeFile(source, contents);
  await saveReceipt(receipts, 'song', source);
  return { dir, source, receipts };
}
async function missing(filename) { await assert.rejects(fs.lstat(filename), { code: 'ENOENT' }); }
async function assertUnchanged({ source, receipts }, raw) {
  assert.deepEqual(await fs.readFile(source), contents);
  assert.equal(await fs.readFile(receipts, 'utf8'), raw);
}

test('rename preserves exact bytes and original extension and survives a process restart', async t => {
  const f = await fixture(t);
  const result = await renameSavedFile(f.receipts, 'song', '  Sunday song  ');
  assert.deepEqual(result, { path: path.join(f.dir, 'Sunday song.PPTX'), filename: 'Sunday song.PPTX' });
  await missing(f.source);
  assert.deepEqual(await fs.readFile(result.path), contents);
  assert.equal(JSON.parse(await fs.readFile(f.receipts, 'utf8')).song, result.path);
  await promisify(execFile)(process.execPath, ['-e',
    'require(process.argv[1]).renameSavedFile(process.argv[2],"song","Next Sunday").catch(error=>{console.error(error);process.exitCode=1})',
    path.resolve(__dirname, '../desktop/station-files.cjs'), f.receipts]);
  const finalPath = path.join(f.dir, 'Next Sunday.PPTX');
  assert.equal(JSON.parse(await fs.readFile(f.receipts, 'utf8')).song, finalPath);
  assert.deepEqual(await fs.readFile(finalPath), contents);
  await missing(result.path);
  assert.deepEqual((await fs.readdir(f.dir)).sort(), ['Next Sunday.PPTX', 'deliveries.json']);
});

test('unchanged names still recheck authorization after reading the saved file', async t => {
  const f = await fixture(t);
  const raw = await fs.readFile(f.receipts, 'utf8');
  let checks = 0;
  assert.deepEqual(await renameSavedFile(f.receipts, 'song', 'original', { beforeCommit: () => { checks++; } }),
    { path: f.source, filename: 'original.PPTX', unchanged: true });
  assert.equal(checks, 1);
  await assert.rejects(renameSavedFile(f.receipts, 'song', 'original', { beforeCommit: () => { throw new Error('Operator changed'); } }), /Operator changed/);
  await assertUnchanged(f, raw);
});

test('unsafe Windows names and path traversal leave receipts and file unchanged', async t => {
  const f = await fixture(t);
  const raw = await fs.readFile(f.receipts, 'utf8');
  const names = ['', '   ', 'a'.repeat(151), '../escape', '.hidden', 'end.', 'x/y', 'x\\y', 'x<y', 'x>y', 'x:y', 'x"y', 'x|y', 'x?y', 'x*y', 'x\ny', 'x\0y', 'x\x7fy', 'CON', 'con.txt', 'PrN.more', 'AUX', 'NUL', 'COM1', 'COM9.song', 'LPT1', 'lpt9.more'];
  for (const name of names) await assert.rejects(renameSavedFile(f.receipts, 'song', name), undefined, JSON.stringify(name));
  await assertUnchanged(f, raw);
  assert.deepEqual((await fs.readdir(f.dir)).sort(), ['deliveries.json', 'original.PPTX']);
});

test('existing destination files, directories and symlinks are never overwritten', async t => {
  const f = await fixture(t);
  const raw = await fs.readFile(f.receipts, 'utf8');
  const collision = path.join(f.dir, 'collision.PPTX');
  await fs.writeFile(collision, 'keep existing file');
  await assert.rejects(renameSavedFile(f.receipts, 'song', 'collision'), /already exists/);
  assert.equal(await fs.readFile(collision, 'utf8'), 'keep existing file');
  await fs.unlink(collision);
  await fs.mkdir(collision);
  await assert.rejects(renameSavedFile(f.receipts, 'song', 'collision'), /already exists/);
  await fs.rmdir(collision);
  await fs.symlink(f.source, collision);
  await assert.rejects(renameSavedFile(f.receipts, 'song', 'collision'), /already exists/);
  assert.equal((await fs.lstat(collision)).isSymbolicLink(), true);
  await assertUnchanged(f, raw);
});

test('nonregular or symlink sources are refused before any link or receipt mutation', async t => {
  const f = await fixture(t);
  const link = path.join(f.dir, 'shortcut.PPTX');
  const folder = path.join(f.dir, 'folder.PPTX');
  await fs.symlink(f.source, link);
  await fs.mkdir(folder);
  for (const source of [link, folder]) {
    await saveReceipt(f.receipts, 'song', source);
    const raw = await fs.readFile(f.receipts, 'utf8');
    await assert.rejects(renameSavedFile(f.receipts, 'song', 'Sunday'), /regular saved file/);
    assert.equal(await fs.readFile(f.receipts, 'utf8'), raw);
    await missing(path.join(f.dir, 'Sunday.PPTX'));
  }
  assert.deepEqual(await fs.readFile(f.source), contents);
});

test('denied authorization rolls back only the new link and removes prepared receipt temp', async t => {
  const f = await fixture(t);
  const raw = await fs.readFile(f.receipts, 'utf8');
  const destination = path.join(f.dir, 'Sunday.PPTX');
  let checked = false;
  await assert.rejects(renameSavedFile(f.receipts, 'song', 'Sunday', { beforeCommit: async () => {
    checked = true;
    assert.deepEqual(await fs.readFile(destination), contents);
    assert.ok((await fs.readdir(f.dir)).some(name => name.endsWith('.tmp')));
    throw new Error('Operator changed');
  } }), /Operator changed/);
  assert.equal(checked, true);
  await assertUnchanged(f, raw);
  await missing(destination);
  assert.deepEqual((await fs.readdir(f.dir)).sort(), ['deliveries.json', 'original.PPTX']);
});

test('rename and saveReceipt serialize against the same receipt file without lost entries', async t => {
  const f = await fixture(t);
  const release = {};
  release.wait = new Promise(resolve => { release.resolve = resolve; });
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const rename = renameSavedFile(f.receipts, 'song', 'Sunday', { beforeCommit: async () => { entered(); await release.wait; } });
  await started;
  const additions = Array.from({ length: 12 }, (_, i) => saveReceipt(f.receipts, 'other-' + i, path.join(f.dir, 'other-' + i + '.png')));
  release.resolve();
  const [result] = await Promise.all([rename, ...additions]);
  const records = JSON.parse(await fs.readFile(f.receipts, 'utf8'));
  assert.equal(Object.keys(records).length, 13);
  assert.equal(records.song, result.path);
  for (let i = 0; i < 12; i++) assert.equal(records['other-' + i], path.join(f.dir, 'other-' + i + '.png'));
  assert.deepEqual(await fs.readFile(result.path), contents);
});

test('corrupt or invalid receipts are preserved byte for byte by rename and saveReceipt', async t => {
  const f = await fixture(t);
  for (const raw of ['broken JSON', '[]', 'null', '{"song":42}', '{"song":"relative.PPTX"}', '{"song":{}}']) {
    await fs.writeFile(f.receipts, raw);
    await assert.rejects(renameSavedFile(f.receipts, 'song', 'Sunday'), /Invalid saved-file receipts/);
    await assert.rejects(saveReceipt(f.receipts, 'other', '/absolute/file.png'), /Invalid saved-file receipts/);
    await assertUnchanged(f, raw);
    await missing(path.join(f.dir, 'Sunday.PPTX'));
  }
});

test('failed receipt commit rolls back destination and leaves the original record and bytes', async t => {
  const f = await fixture(t);
  const raw = await fs.readFile(f.receipts, 'utf8');
  const rename = fs.rename;
  const stub = t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === f.receipts) throw Object.assign(new Error('simulated disk commit failure'), { code: 'EIO' });
    return rename(source, destination);
  });
  await assert.rejects(renameSavedFile(f.receipts, 'song', 'Sunday'), /simulated disk commit failure/);
  stub.mock.restore();
  await assertUnchanged(f, raw);
  await missing(path.join(f.dir, 'Sunday.PPTX'));
  assert.deepEqual((await fs.readdir(f.dir)).sort(), ['deliveries.json', 'original.PPTX']);
});

test('unsupported hard links fail clearly without unsafe rename fallback', async t => {
  const f = await fixture(t);
  const raw = await fs.readFile(f.receipts, 'utf8');
  const stub = t.mock.method(fs, 'link', async () => { throw Object.assign(new Error('unsupported filesystem'), { code: 'ENOTSUP' }); });
  await assert.rejects(renameSavedFile(f.receipts, 'song', 'Sunday'), /hard.link support/);
  stub.mock.restore();
  await assertUnchanged(f, raw);
  assert.deepEqual((await fs.readdir(f.dir)).sort(), ['deliveries.json', 'original.PPTX']);
});

test('source unlink failure keeps both copies and returns retainedOriginal after committed receipt', async t => {
  const f = await fixture(t);
  const unlink = fs.unlink;
  const stub = t.mock.method(fs, 'unlink', async name => {
    if (name === f.source) throw Object.assign(new Error('file in use'), { code: 'EACCES' });
    return unlink(name);
  });
  const result = await renameSavedFile(f.receipts, 'song', 'Sunday');
  stub.mock.restore();
  assert.equal(result.retainedOriginal, true);
  assert.equal(JSON.parse(await fs.readFile(f.receipts, 'utf8')).song, result.path);
  assert.deepEqual(await fs.readFile(f.source), contents);
  assert.deepEqual(await fs.readFile(result.path), contents);
});

test('an externally replaced source is retained after receipt commit', async t => {
  const f = await fixture(t);
  const result = await renameSavedFile(f.receipts, 'song', 'Sunday', { beforeCommit: async () => {
    await fs.unlink(f.source);
    await fs.writeFile(f.source, 'replacement from another app');
  } });
  assert.equal(result.retainedOriginal, true);
  assert.equal(await fs.readFile(f.source, 'utf8'), 'replacement from another app');
  assert.deepEqual(await fs.readFile(result.path), contents);
  assert.equal(JSON.parse(await fs.readFile(f.receipts, 'utf8')).song, result.path);
});

test('rollback never deletes a destination replaced by another app', async t => {
  const f = await fixture(t);
  const raw = await fs.readFile(f.receipts, 'utf8');
  const destination = path.join(f.dir, 'Sunday.PPTX');
  await assert.rejects(renameSavedFile(f.receipts, 'song', 'Sunday', { beforeCommit: async () => {
    await fs.unlink(destination);
    await fs.writeFile(destination, 'keep replacement destination');
    throw new Error('Operator changed');
  } }), /Operator changed/);
  await assertUnchanged(f, raw);
  assert.equal(await fs.readFile(destination, 'utf8'), 'keep replacement destination');
});

test('failed authorization keeps a known safe copy if another app removed the source', async t => {
  const f = await fixture(t);
  const raw = await fs.readFile(f.receipts, 'utf8');
  const destination = path.join(f.dir, 'Sunday.PPTX');
  await assert.rejects(renameSavedFile(f.receipts, 'song', 'Sunday', { beforeCommit: async () => {
    await fs.unlink(f.source);
    throw new Error('Operator changed');
  } }), /Operator changed.*safe copy was retained/);
  assert.equal(await fs.readFile(f.receipts, 'utf8'), raw);
  assert.deepEqual(await fs.readFile(destination), contents);
});
