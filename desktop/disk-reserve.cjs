const fs = require('node:fs/promises');

const DEFAULT_RESERVE_BYTES = 2 * 1024 * 1024 * 1024;
const METADATA_BYTES = 64 * 1024;

function lowDiskSpace(cause) {
  const error = new Error('Not enough free space to save this file while keeping the computer’s storage reserve. Free some space, then retry. No existing files were deleted.', { cause });
  error.code = 'STATI_LOW_DISK_SPACE';
  error.retryable = true;
  return error;
}
function unavailable(cause) {
  const error = new Error('Could not check free space on the destination drive. Check the drive, then retry. Nothing was deleted.', { cause });
  error.code = 'STATI_DISK_SPACE_UNAVAILABLE';
  error.retryable = true;
  return error;
}
function isDiskSpaceError(error) {
  return error?.code === 'STATI_LOW_DISK_SPACE' || error?.code === 'STATI_DISK_SPACE_UNAVAILABLE';
}
function integer(value) {
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw Error('Invalid filesystem space information.');
}
const rounded = (bytes, block) => (bytes + block - 1n) / block * block;

/** Reservations share a filesystem, including downloads in different folders.
 * Only this process's incoming writes are coordinated; another application can
 * consume space, so availability is checked again before and after every write.
 */
function createDiskReserve({ reserveBytes = DEFAULT_RESERVE_BYTES, metadataBytes = METADATA_BYTES, stat = fs.stat.bind(fs), statfs = fs.statfs.bind(fs) } = {}) {
  const reserve = integer(reserveBytes), metadata = integer(metadataBytes);
  const queues = new Map(), reservations = new Map();
  function serialized(key, work) {
    const pending = (queues.get(key) || Promise.resolve()).catch(() => {}).then(work);
    queues.set(key, pending);
    return pending.finally(() => { if (queues.get(key) === pending) queues.delete(key); });
  }
  async function space(directory) {
    try {
      const info = await statfs(directory, { bigint: true });
      const block = integer(info.bsize);
      if (!block) throw Error('Invalid filesystem block size.');
      return { block, available: integer(info.bavail) * block };
    } catch (cause) { throw unavailable(cause); }
  }
  function outstanding(key) {
    let bytes = 0n;
    for (const item of reservations.get(key) || []) bytes += item.remaining + metadata;
    return bytes;
  }
  async function acquire(directory, expectedBytes) {
    const expected = integer(expectedBytes);
    let key;
    try { key = String((await stat(directory, { bigint: true })).dev); }
    catch (cause) { throw unavailable(cause); }
    return serialized(key, async () => {
      const first = await space(directory), allocation = rounded(expected, first.block);
      if (first.available < reserve + outstanding(key) + allocation + metadata) throw lowDiskSpace();
      const item = { remaining: allocation, written: 0n }, items = reservations.get(key) || new Set();
      items.add(item); reservations.set(key, items);
      let released = false;
      function active() { if (released) throw Error('The disk reservation has ended.'); }
      async function check() {
        active();
        const current = await space(directory);
        if (current.block !== first.block) throw unavailable();
        if (current.available < reserve + outstanding(key)) throw lowDiskSpace();
      }
      return {
        check: () => serialized(key, check),
        write: (bytes, write) => serialized(key, async () => {
          active();
          const amount = integer(bytes);
          if (typeof write !== 'function' || amount > expected - item.written) throw Error('Write exceeds its disk reservation.');
          await check();
          let result;
          try { result = await write(); }
          catch (cause) { if (cause?.code === 'ENOSPC') throw lowDiskSpace(cause); throw cause; }
          item.written += amount;
          item.remaining = allocation - rounded(item.written, first.block);
          await check();
          return result;
        }),
        release: () => serialized(key, () => {
          if (released) return;
          released = true; items.delete(item);
          if (!items.size) reservations.delete(key);
        }),
      };
    });
  }
  return { acquire };
}

const downloadDiskReserve = createDiskReserve();
module.exports = { DEFAULT_RESERVE_BYTES, createDiskReserve, downloadDiskReserve, lowDiskSpace, isDiskSpaceError };
