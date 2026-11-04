const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const { downloadDiskReserve, lowDiskSpace, isDiskSpaceError } = require('./disk-reserve.cjs');

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const FAILURE_MESSAGE = 'File check failed. Nothing was saved; retry the transfer.';

/** Write only a verified temporary download. The caller owns delivery and receipts. */
async function writeDownload(response, temporaryPath, { maxBytes = DEFAULT_MAX_BYTES, diskReserve = downloadDiskReserve } = {}) {
  let handle;
  let reader;
  let created = false;
  let identity;
  let reservation;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw Error('Invalid download limit.');
    if (!response || response.ok !== true || !response.body || typeof response.body.getReader !== 'function') {
      throw Error('Download response is unavailable.');
    }

    const rawLength = response.headers.get('Content-Length');
    if (typeof rawLength !== 'string' || !/^\d+$/.test(rawLength)) throw Error('Missing or invalid file size.');
    const expectedBytes = Number(rawLength);
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > maxBytes) throw Error('Invalid file size or download limit exceeded.');

    const rawChecksum = response.headers.get('X-Checksum-SHA256');
    if (rawChecksum !== null && !/^[a-f\d]{64}$/i.test(rawChecksum)) throw Error('Invalid file checksum.');
    const expectedChecksum = rawChecksum === null ? null : rawChecksum.toLowerCase();

    reservation = await diskReserve.acquire(path.dirname(temporaryPath), expectedBytes);
    reader = response.body.getReader();
    handle = await fs.open(temporaryPath, 'wx', 0o600);
    created = true;
    identity = await handle.stat({ bigint: true });
    const hash = crypto.createHash('sha256');
    let bytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw Error('Invalid download chunk.');
      if (value.byteLength > expectedBytes - bytes) throw Error('File exceeded its expected size.');
      // FileHandle.write may write fewer bytes than requested; finish each chunk.
      await reservation.write(value.byteLength, async () => {
        let offset = 0;
        while (offset < value.byteLength) {
          const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
          if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > value.byteLength - offset) {
            throw Error('File could not be written completely.');
          }
          offset += bytesWritten;
        }
      });
      hash.update(value);
      bytes += value.byteLength;
    }

    if (bytes !== expectedBytes) throw Error('File ended before its expected size.');
    const sha256 = hash.digest('hex');
    if (expectedChecksum !== null && !crypto.timingSafeEqual(Buffer.from(sha256, 'hex'), Buffer.from(expectedChecksum, 'hex'))) {
      throw Error('File checksum did not match.');
    }
    await handle.sync();
    await reservation.check();
    await handle.close();
    handle = undefined;
    return { bytes, sha256, verified: expectedChecksum !== null, temporaryIdentity: { dev: String(identity.dev), ino: String(identity.ino) } };
  } catch (cause) {
    const failure = isDiskSpaceError(cause) ? cause : cause?.code === 'ENOSPC' ? lowDiskSpace(cause) : new Error(FAILURE_MESSAGE, { cause });
    // Cancellation also covers failures discovered before acquiring a reader.
    if (reader) await reader.cancel().catch(() => {});
    else if (response?.body && typeof response.body.cancel === 'function') await response.body.cancel().catch(() => {});
    if (handle) await handle.close().catch(() => {});
    if (created) {
      // Never remove an existing path after an exclusive-open failure, or a file
      // another process substituted for this call's temporary file.
      try {
        const current = await fs.lstat(temporaryPath, { bigint: true });
        if (!identity || (current.dev === identity.dev && current.ino === identity.ino)) await fs.unlink(temporaryPath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') failure.cleanupError = cleanupError;
      }
    }
    throw failure;
  } finally {
    if (reader) reader.releaseLock();
    await reservation?.release();
  }
}

module.exports = { writeDownload };
