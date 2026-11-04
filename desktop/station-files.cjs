const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const completedStatuses = new Set(['delivered', 'rejected', 'expired', 'unavailable']);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function emailDraft(filename, bytes) {
  const boundary = 'stati-' + crypto.randomUUID();
  const name = Buffer.from(path.basename(filename)).toString('base64');
  return Buffer.from([
    'X-Unsent: 1', 'MIME-Version: 1.0', 'Subject: =?UTF-8?B?' + name + '?=',
    'Content-Type: multipart/mixed; boundary="' + boundary + '"', '', '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8', '', 'Shared from Stați.', '--' + boundary,
    'Content-Type: application/octet-stream',
    'Content-Disposition: attachment; filename="' + path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_') + '"',
    'Content-Transfer-Encoding: base64', '', bytes.toString('base64').match(/.{1,76}/g).join('\r\n'),
    '--' + boundary + '--', '',
  ].join('\r\n'));
}

const queues = new Map();
function mutate(filename, operation) {
  const key = path.resolve(filename);
  const task = (queues.get(key) || Promise.resolve()).catch(() => {}).then(operation);
  queues.set(key, task);
  return task.finally(() => { if (queues.get(key) === task) queues.delete(key); });
}

async function mergeHistoryNow(filename, files, { beforeCommit } = {}) {
  let history = {};
  try { history = JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let changed = false;
  for (const file of files) {
    const next = { ...history[file.id], ...file };
    // A late queue snapshot must not revive a confirmed decision or an expired
    // local card. Availability also stays false after a terminal decision.
    if (file.status === 'queued' && completedStatuses.has(history[file.id]?.status)) {
      next.status = history[file.id].status;
      next.rejection_reason = history[file.id].rejection_reason;
      next.remoteAvailable = false;
    }
    if (JSON.stringify(next) !== JSON.stringify(history[file.id])) {
      history[file.id] = next;
      changed = true;
    }
  }
  if (changed) {
    const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
    try {
      if (beforeCommit) await beforeCommit();
      await fs.writeFile(temporary, JSON.stringify(history), { mode: 0o600 });
      if (beforeCommit) await beforeCommit();
      await fs.rename(temporary, filename);
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  if (beforeCommit) await beforeCommit();
  return Object.values(history).sort((a, b) => b.created_at - a.created_at);
}
function mergeHistory(filename, files, options) { return mutate(filename, () => mergeHistoryNow(filename, files, options)); }

function historyStatusBatch(files, visibleIds, cursor = 0, priorityIds = []) {
  const visible = new Set(visibleIds);
  const ids = [...new Set(files.filter(file => file.status === 'queued' && uuid(file.id) && !visible.has(file.id)).map(file => file.id))].sort();
  if (!ids.length) return { ids: [], cursor: 0 };
  const eligible = new Set(ids), priority = [...new Set(priorityIds)].filter(id => eligible.has(id)).slice(0, 100);
  const remaining = ids.filter(id => !priority.includes(id));
  const start = Number.isSafeInteger(cursor) && cursor >= 0 && remaining.length ? cursor % remaining.length : 0;
  const count = Math.min(100 - priority.length, remaining.length);
  const selected = Array.from({ length: count }, (_, index) => remaining[(start + index) % remaining.length]);
  return { ids: [...priority, ...selected], cursor: remaining.length ? (start + count) % remaining.length : 0 };
}

function historyStatusUpdates(requested, response) {
  const allowed = new Set(requested), seen = new Set();
  if (!requested.length || requested.length > 100 || allowed.size !== requested.length ||
      !response || !Array.isArray(response.statuses) || response.statuses.length !== allowed.size) throw new Error('Invalid delivery status response.');
  return response.statuses.map(row => {
    if (!row || !allowed.has(row.id) || seen.has(row.id) || !['queued', ...completedStatuses].includes(row.status) ||
        typeof row.remoteAvailable !== 'boolean' || row.remoteAvailable && row.status !== 'queued' ||
        ![null, 'member', 'admin'].includes(row.sender_role) || !row.remoteAvailable && row.sender_role !== null ||
        (row.expires_at !== undefined && (!Number.isSafeInteger(row.expires_at) || row.expires_at < 0)) ||
        row.rejection_reason !== null && (typeof row.rejection_reason !== 'string' || row.rejection_reason.length > 500)) {
      throw new Error('Invalid delivery status response.');
    }
    seen.add(row.id);
    return { id: row.id, status: row.status, remoteAvailable: row.remoteAvailable, sender_role: row.sender_role,
      ...(row.expires_at !== undefined ? { expires_at: row.expires_at } : {}), rejection_reason: row.status === 'rejected' ? row.rejection_reason : null };
  });
}

async function readReceipts(filename) {
  let receipts;
  try {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid saved-file receipts. Keep the existing records and restore a verified backup.');
    receipts = JSON.parse(await fs.readFile(filename, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return Object.create(null);
    if (error instanceof SyntaxError) throw new Error('Invalid saved-file receipts. Keep the existing records and restore a verified backup.', { cause: error });
    throw error;
  }
  if (!receipts || typeof receipts !== 'object' || Array.isArray(receipts) ||
      Object.entries(receipts).some(([id, location]) => !id || typeof location !== 'string' || !path.isAbsolute(location) || location.includes('\0'))) {
    throw new Error('Invalid saved-file receipts. Keep the existing records and restore a verified backup.');
  }
  return Object.assign(Object.create(null), receipts);
}

async function writeReceipts(filename, receipts, beforeCommit) {
  const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(receipts));
    await handle.sync();
    await handle.close();
    handle = null;
    if (beforeCommit) await beforeCommit();
    await fs.rename(temporary, filename);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function saveReceipt(filename, id, location, { beforeCommit } = {}) {
  return mutate(filename, async () => {
    const receipts = await readReceipts(filename);
    if (typeof id !== 'string' || !id || typeof location !== 'string' || !path.isAbsolute(location) || location.includes('\0')) {
      throw new Error('Invalid saved-file receipt.');
    }
    receipts[id] = location;
    await writeReceipts(filename, receipts, beforeCommit);
  });
}

function cleanRenameStem(value) {
  if (typeof value !== 'string') throw new Error('Enter a file name.');
  const stem = value.trim();
  if (!stem || [...stem].length > 150) throw new Error('Use a file name between 1 and 150 characters.');
  if (/[<>:"/\\|?*\x00-\x1f\x7f]/.test(stem) || stem.startsWith('.') || /[. ]$/.test(stem)) {
    throw new Error('Use a file name without path separators, control characters, or Windows reserved characters, and do not start or end it with a dot.');
  }
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem)) {
    throw new Error('That file name is reserved by Windows. Choose another name.');
  }
  return stem;
}

function sameFile(stat, expected) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.dev === expected.dev && stat.ino === expected.ino;
}

async function ensureRenameLinks(source, destination, expected) {
  const [sourceStat, destinationStat] = await Promise.all([fs.lstat(source), fs.lstat(destination)]);
  if (!sameFile(sourceStat, expected) || !sameFile(destinationStat, expected)) {
    throw new Error('The saved file changed on the computer. Refresh the file list and try again.');
  }
}

async function rollbackLink(source, destination, expected) {
  // Do not remove a replacement file or the last known copy if another app moved the source.
  let sourceStat, destinationStat;
  try { destinationStat = await fs.lstat(destination); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!sameFile(destinationStat, expected)) return;
  try { sourceStat = await fs.lstat(source); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('The original file moved while renaming. A safe copy was retained at ' + destination + '.');
    throw error;
  }
  if (!sameFile(sourceStat, expected)) {
    throw new Error('The original file changed while renaming. A safe copy was retained at ' + destination + '.');
  }
  await fs.unlink(destination);
}

function renameSavedFile(receiptsFilename, id, newStem, { beforeCommit } = {}) {
  return mutate(receiptsFilename, async () => {
    const stem = cleanRenameStem(newStem);
    if (typeof id !== 'string' || !id) throw new Error('Choose a saved file to rename.');
    if (beforeCommit !== undefined && typeof beforeCommit !== 'function') throw new Error('Invalid rename authorization check.');
    const receipts = await readReceipts(receiptsFilename);
    const source = receipts[id];
    if (!source) throw new Error('Save this file to the computer first.');
    let sourceStat;
    try { sourceStat = await fs.lstat(source); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error('The saved file is no longer in its recorded folder. Restore it or save it again before renaming.');
      throw error;
    }
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('Only a regular saved file can be renamed. Shortcuts, links, and folders are not supported.');
    const filename = stem + path.extname(source);
    const destination = path.join(path.dirname(source), filename);
    if (destination === source) {
      if (beforeCommit) await beforeCommit();
      return { path: source, filename: path.basename(source), unchanged: true };
    }
    try { await fs.link(source, destination); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('A file with that name already exists in this folder. Choose another name.');
      if (['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EPERM'].includes(error.code)) {
        throw new Error('This folder does not support safe file renaming through hard links. Move the file to a local disk with hard-link support and try again.', { cause: error });
      }
      if (error.code === 'ENAMETOOLONG') throw new Error('This file name is too long for its folder. Choose a shorter name.');
      throw error;
    }
    try {
      receipts[id] = destination;
      await writeReceipts(receiptsFilename, receipts, async () => {
        await ensureRenameLinks(source, destination, sourceStat);
        if (beforeCommit) await beforeCommit();
      });
    } catch (error) {
      try { await rollbackLink(source, destination, sourceStat); }
      catch (cleanupError) {
        throw new Error(error.message + ' ' + cleanupError.message, { cause: error });
      }
      throw error;
    }
    // The new name and its receipt now exist. Retain the old name if another app replaced it.
    let retainedOriginal = false;
    try {
      const [currentSource, currentDestination] = await Promise.all([fs.lstat(source), fs.lstat(destination)]);
      if (sameFile(currentSource, sourceStat) && sameFile(currentDestination, sourceStat)) await fs.unlink(source);
      else retainedOriginal = true;
    } catch (error) {
      if (error.code !== 'ENOENT') retainedOriginal = true;
      else {
        // A missing source is already renamed; a missing destination requires keeping any source.
        try { await fs.lstat(destination); } catch { retainedOriginal = true; }
      }
    }
    return { path: destination, filename, ...(retainedOriginal ? { retainedOriginal: true } : {}) };
  });
}

function clearHistory(filename, ids) {
  return mutate(filename, async () => {
    let history = {};
    try { history = JSON.parse(await fs.readFile(filename, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const id of ids) if (history[id]?.status !== 'queued') delete history[id];
    const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fs.writeFile(temporary, JSON.stringify(history), { mode: 0o600 });
      await fs.rename(temporary, filename);
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  });
}

module.exports = { readReceipts, emailDraft, mergeHistory, historyStatusBatch, historyStatusUpdates, saveReceipt, renameSavedFile, clearHistory };
