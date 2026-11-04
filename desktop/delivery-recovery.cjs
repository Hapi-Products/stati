const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { downloadDiskReserve, lowDiskSpace, isDiskSpaceError } = require('./disk-reserve.cjs');

const MAX_BYTES = 50 * 1024 * 1024;
const FAILURE = 'The saved-download checkpoint could not be verified. Existing files were retained; restore the file or contact an administrator before retrying.';
const queues = new Map();
const LINK_UNSUPPORTED = new Set(['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EPERM']);

function recoveryRequired(cause) {
  const error = new Error(FAILURE, { cause });
  error.code = 'STATI_RECOVERY_REQUIRED'; error.retryable = false;
  return error;
}

async function active(options) {
  if (options.signal?.aborted) throw options.signal.reason || Object.assign(new Error('File delivery was stopped.'), { code: 'ABORT_ERR' });
  if (options.checkActive && await options.checkActive() === false) throw Object.assign(new Error('File delivery was stopped.'), { code: 'ABORT_ERR' });
  if (options.signal?.aborted) throw options.signal.reason || Object.assign(new Error('File delivery was stopped.'), { code: 'ABORT_ERR' });
}

function serialized(key, work) {
  const task = (queues.get(key) || Promise.resolve()).catch(() => {}).then(work);
  queues.set(key, task);
  return task.finally(() => { if (queues.get(key) === task) queues.delete(key); });
}

function validFilename(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 &&
    value !== '.' && value !== '..' && !/[<>:"/\\|?*\x00-\x1f\x7f]/.test(value) &&
    !/[. ]$/.test(value) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value);
}

function identity(stat) { return { dev: String(stat.dev), ino: String(stat.ino) }; }
function matches(stat, expected) {
  return stat.isFile() && !stat.isSymbolicLink() && String(stat.dev) === expected.dev && String(stat.ino) === expected.ino;
}

async function directory(filename, create = false) {
  if (create) await fs.mkdir(filename, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const stat = await fs.lstat(filename);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw recoveryRequired();
}

async function paths({ downloadsDirectory, id }, create) {
  if (typeof id !== 'string' || !/^[\w-]{20,60}$/.test(id) || typeof downloadsDirectory !== 'string' ||
      !path.isAbsolute(downloadsDirectory) || downloadsDirectory.includes('\0')) throw new Error('Invalid download checkpoint location.');
  const downloads = path.resolve(downloadsDirectory);
  await directory(downloads);
  // Resolve ancestors once. Every path recorded below is only a basename inside this directory.
  const root = await fs.realpath(downloads);
  const checkpoints = path.join(root, '.stati-deliveries');
  const folder = path.join(checkpoints, id);
  try { await directory(checkpoints, create); await directory(folder, create); }
  catch (error) { if (!create && error.code === 'ENOENT') return { root, missing: true }; throw error; }
  return { root, folder, checkpoints, record: path.join(folder, 'checkpoint.json'), payload: path.join(folder, 'payload.part'), destinationRecord: path.join(folder, 'destination.json') };
}

async function syncDirectory(filename) {
  let handle;
  try { handle = await fs.open(filename, 'r'); await handle.sync(); }
  catch (error) {
    // Windows does not expose directory fsync through Node on every local volume.
    if (process.platform !== 'win32' || !['EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
  } finally { if (handle) await handle.close(); }
}

async function openRegular(filename, access = constants.O_RDONLY) {
  const before = await fs.lstat(filename, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) throw recoveryRequired();
  const handle = await fs.open(filename, access | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat({ bigint: true });
    if (!matches(stat, identity(before))) throw recoveryRequired();
    return { handle, stat };
  } catch (error) { await handle.close(); throw error; }
}

async function verifyFile(filename, record) {
  const { handle, stat } = await openRegular(filename);
  try {
    if (!matches(stat, record) || stat.size !== BigInt(record.bytes)) throw recoveryRequired();
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, record.bytes - offset + 1), offset);
      if (!bytesRead) break;
      offset += bytesRead;
      if (offset > record.bytes) throw recoveryRequired();
      hash.update(buffer.subarray(0, bytesRead));
    }
    const current = await fs.lstat(filename, { bigint: true });
    if (offset !== record.bytes || hash.digest('hex') !== record.sha256 || !matches(current, record) || current.size !== BigInt(record.bytes)) throw recoveryRequired();
  } finally { await handle.close(); }
}

function validRecord(record, id) {
  const keys = ['version', 'id', 'filename', 'bytes', 'sha256', 'verified', 'dev', 'ino'];
  return record && typeof record === 'object' && !Array.isArray(record) &&
    Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key)) &&
    record.version === 1 && record.id === id && validFilename(record.filename) &&
    Number.isSafeInteger(record.bytes) && record.bytes > 0 && record.bytes <= MAX_BYTES &&
    typeof record.sha256 === 'string' && /^[a-f\d]{64}$/.test(record.sha256) && typeof record.verified === 'boolean' &&
    typeof record.dev === 'string' && /^\d+$/.test(record.dev) && typeof record.ino === 'string' && /^[1-9]\d*$/.test(record.ino);
}

async function readRecord(locations, id) {
  let opened;
  try {
    opened = await openRegular(locations.record);
    if (opened.stat.size > 16384n) throw recoveryRequired();
    const record = JSON.parse(await opened.handle.readFile('utf8'));
    const current = await fs.lstat(locations.record, { bigint: true });
    if (!matches(current, identity(opened.stat)) || !validRecord(record, id)) throw recoveryRequired();
    return { record, recordIdentity: identity(opened.stat) };
  } catch (cause) { throw recoveryRequired(cause); }
  finally { if (opened) await opened.handle.close(); }
}

async function exclusiveRecord(filename, record) {
  let handle;
  try {
    handle = await fs.open(filename, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(record));
    await handle.sync();
  } finally { if (handle) await handle.close(); }
}

async function linkOrCopy(source, destination, options = {}) {
  try { await fs.link(source, destination); return false; }
  catch (error) { if (!LINK_UNSUPPORTED.has(error.code)) throw error; }
  const original = await openRegular(source);
  const ownReservation = !options.reservation;
  let reservation = options.reservation, output, outputIdentity;
  try {
    reservation ||= await (options.diskReserve || downloadDiskReserve).acquire(path.dirname(destination), Number(original.stat.size));
    output = await fs.open(destination, 'wx', 0o600);
    outputIdentity = identity(await output.stat({ bigint: true }));
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < Number(original.stat.size)) {
      const { bytesRead } = await original.handle.read(buffer, 0, Math.min(buffer.length, Number(original.stat.size) - position), position);
      if (!bytesRead) throw recoveryRequired();
      await reservation.write(bytesRead, async () => {
        let offset = 0;
        while (offset < bytesRead) {
          const result = await output.write(buffer, offset, bytesRead - offset);
          if (!Number.isSafeInteger(result.bytesWritten) || result.bytesWritten <= 0 || result.bytesWritten > bytesRead - offset) throw Error('File could not be copied completely.');
          offset += result.bytesWritten;
        }
      });
      position += bytesRead;
    }
    await output.sync();
    await reservation.check();
    return true;
  } catch (cause) {
    const error = cause?.code === 'ENOSPC' ? lowDiskSpace(cause) : cause;
    if (isDiskSpaceError(error) && outputIdentity) {
      await output?.close().catch(() => {}); output = undefined;
      // Only our own exclusive partial copy can be removed. Existing and
      // substituted files retain the recovery workflow's preservation rules.
      try { const current = await fs.lstat(destination, { bigint: true }); if (matches(current, outputIdentity)) await fs.unlink(destination); }
      catch (cleanupError) { if (cleanupError.code !== 'ENOENT') error.cleanupError = cleanupError; }
    }
    throw error;
  } finally {
    await output?.close();
    await original.handle.close();
    if (ownReservation) await reservation?.release();
  }
}

async function destinationIdentity(locations, record) {
  const destination = path.join(locations.root, record.filename);
  const stat = await fs.lstat(destination, { bigint: true });
  if (matches(stat, record)) return record;
  let opened;
  try {
    opened = await openRegular(locations.destinationRecord);
    if (opened.stat.size > 1024n) throw recoveryRequired();
    const saved = JSON.parse(await opened.handle.readFile('utf8'));
    const current = await fs.lstat(locations.destinationRecord, { bigint: true });
    if (!matches(current, identity(opened.stat)) || !saved || Object.keys(saved).length !== 4 || saved.version !== 1 || saved.id !== record.id ||
        typeof saved.dev !== 'string' || !/^\d+$/.test(saved.dev) || typeof saved.ino !== 'string' || !/^[1-9]\d*$/.test(saved.ino)) throw recoveryRequired();
    return { ...record, dev: saved.dev, ino: saved.ino };
  } catch (cause) { throw recoveryRequired(cause); }
  finally { if (opened) await opened.handle.close(); }
}

async function verifyDestination(locations, record) {
  await verifyFile(path.join(locations.root, record.filename), await destinationIdentity(locations, record));
}

async function publish(locations, record, options) {
  const destination = path.join(locations.root, record.filename);
  await active(options);
  try { await verifyDestination(locations, record); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await verifyFile(locations.payload, record);
    await active(options);
    let copied = false;
    try { copied = await linkOrCopy(locations.payload, destination, options); }
    catch (cause) {
      if (cause.code !== 'EEXIST') throw cause;
    }
    if (copied) {
      const stat = await fs.lstat(destination, { bigint: true });
      const savedIdentity = identity(stat);
      await verifyFile(destination, { ...record, ...savedIdentity });
      await exclusiveRecord(locations.destinationRecord, { version: 1, id: record.id, ...savedIdentity });
      await syncDirectory(locations.folder);
    }
    await verifyDestination(locations, record);
    await syncDirectory(locations.root);
  }
  await active(options);
  return { path: destination, integrity: record.verified ? 'sha256' : 'legacy' };
}

/** Recover before fetching. A corrupt checkpoint is an error, never permission to overwrite it. */
function recoverDelivery(options) {
  return serialized(path.resolve(options.downloadsDirectory), async () => {
    const locations = await paths(options, false);
    if (locations.missing) return null;
    const { record } = await readRecord(locations, options.id);
    return publish(locations, record, options);
  });
}

async function chooseFilename(root, base) {
  const ext = path.extname(base), stem = base.slice(0, base.length - ext.length);
  for (let suffix = 0; suffix < 10000; suffix++) {
    const filename = suffix ? `${stem} (${suffix})${ext}` : base;
    try { await fs.lstat(path.join(root, filename)); }
    catch (error) { if (error.code === 'ENOENT') return filename; throw error; }
  }
  throw new Error('Could not choose a safe download filename.');
}

/** The caller may remove its temporaryPath afterward: a checkpoint-owned hard link retains the bytes. */
function prepareDelivery(options) {
  return serialized(path.resolve(options.downloadsDirectory), async () => {
    const { id, temporaryPath, filename, checked } = options;
    if (!validFilename(filename) || !checked || !Number.isSafeInteger(checked.bytes) || checked.bytes <= 0 || checked.bytes > MAX_BYTES ||
        !/^[a-f\d]{64}$/.test(checked.sha256 || '') || typeof checked.verified !== 'boolean') throw new Error('Invalid verified download.');
    const previous = await paths(options, false);
    if (!previous.missing) {
      const { record } = await readRecord(previous, id);
      if (record.bytes !== checked.bytes || record.sha256 !== checked.sha256 || record.verified !== checked.verified) throw recoveryRequired();
      return publish(previous, record, options);
    }
    const root = previous.root;
    const resolvedTemporary = typeof temporaryPath === 'string' ? path.resolve(temporaryPath) : '';
    const prefix = '.stati-' + id + '-';
    const basename = path.basename(resolvedTemporary);
    if (path.dirname(resolvedTemporary) !== root || !basename.startsWith(prefix) ||
        !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\.part$/i.test(basename.slice(prefix.length))) throw new Error('Invalid verified temporary download path.');
    const source = await fs.lstat(resolvedTemporary, { bigint: true });
    let record = { version: 1, id, filename: await chooseFilename(root, filename), bytes: checked.bytes, sha256: checked.sha256, verified: checked.verified, ...identity(source) };
    if (!validRecord(record, id)) throw recoveryRequired();
    await verifyFile(resolvedTemporary, record);
    await active(options);
    // Reserve the worst-case two extra copies before creating a checkpoint.
    // Filesystems without hard links may need both a payload and final copy.
    // A low-space refusal therefore leaves no incomplete checkpoint to block a retry.
    const reservation = await (options.diskReserve || downloadDiskReserve).acquire(root, checked.bytes * 2);
    let locations;
    try {
      locations = await paths(options, true);
      // Exclusive fixed paths keep incomplete or damaged checkpoints intact instead of silently replacing them.
      await linkOrCopy(resolvedTemporary, locations.payload, { ...options, reservation });
      record = { ...record, ...identity(await fs.lstat(locations.payload, { bigint: true })) };
      await verifyFile(locations.payload, record);
      await syncDirectory(locations.folder);
      await exclusiveRecord(locations.record, record);
      await syncDirectory(locations.folder);
      await syncDirectory(locations.checkpoints);
      await reservation.check();
      return await publish(locations, record, { ...options, reservation });
    } catch (error) {
      if (isDiskSpaceError(error) && locations) {
        // A refused/cleaned partial copy has not committed a checkpoint. Remove
        // only empty directories, so the same queued transfer can be retried.
        for (const folder of [locations.folder, locations.checkpoints]) {
          try { await fs.rmdir(folder); }
          catch (cleanupError) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(cleanupError.code)) error.cleanupError = cleanupError; }
        }
      }
      throw error;
    } finally { await reservation.release(); }
  });
}

/** Verify again immediately before ACK. Keep the checkpoint until the server confirms delivery. */
function verifyDelivery(options) {
  return serialized(path.resolve(options.downloadsDirectory), async () => {
    await active(options);
    const locations = await paths(options, false);
    if (locations.missing) return null; // Earlier app versions saved path-only receipts.
    try {
      const { record } = await readRecord(locations, options.id);
      if (options.path !== path.join(locations.root, record.filename)) throw recoveryRequired();
      await verifyDestination(locations, record);
    } catch (cause) { throw recoveryRequired(cause); }
    await active(options);
    return { verified: true };
  });
}

/** Call only after the server acknowledges delivery. A cleanup failure must not discard the receipt. */
function completeDelivery(options) {
  return serialized(path.resolve(options.downloadsDirectory), async () => {
    const locations = await paths(options, false);
    if (locations.missing) return;
    const { record, recordIdentity } = await readRecord(locations, options.id);
    const destination = path.join(locations.root, record.filename);
    if (options.path !== destination) throw recoveryRequired();
    await verifyDestination(locations, record);
    try {
      const payload = await fs.lstat(locations.payload, { bigint: true });
      if (!matches(payload, record)) throw recoveryRequired();
      await fs.unlink(locations.payload);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const current = await fs.lstat(locations.record, { bigint: true });
    if (!matches(current, recordIdentity)) throw recoveryRequired();
    try {
      const destinationRecord = await fs.lstat(locations.destinationRecord);
      if (!destinationRecord.isFile() || destinationRecord.isSymbolicLink()) throw recoveryRequired();
      await fs.unlink(locations.destinationRecord);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.unlink(locations.record);
    // Never recursively remove a checkpoint folder or follow paths supplied by its contents.
    await fs.rmdir(locations.folder).catch(error => { if (error.code !== 'ENOTEMPTY') throw error; });
    await syncDirectory(locations.checkpoints);
  });
}

module.exports = { prepareDelivery, recoverDelivery, verifyDelivery, completeDelivery };
