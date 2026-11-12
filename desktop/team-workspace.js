'use strict';

function createTeamWorkspace(api) {
 const title = document.getElementById('team-title');
 const status = document.getElementById('team-status');
 const list = document.getElementById('team-rows');
 const detail = document.getElementById('team-detail');
 const more = document.getElementById('team-more');
 const refresh = document.getElementById('team-refresh');
 const statuses = {new: 'New', 'in-progress': 'In progress', complete: 'Complete'};
 let page, pageRevision = 0, detailRevision = 0;
 let rows = [], offset = 0, cursor = '', selected = '';
 const node = (tag, text) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
 };
 function resetDetail() {
  detailRevision++;
  selected = '';
  detail.replaceChildren();
  detail.hidden = true;
 }
 function renderRows() {
  list.replaceChildren(...rows.map(row => {
   const item = node('li');
   const button = node('button');
   const subtitle = page === 'tasks'
    ? [statuses[row.status], row.urgent ? 'Urgent' : '', row.authorName].filter(Boolean).join(' · ')
    : row.memberCount === 1 ? '1 member' : `${row.memberCount ?? 0} members`;
   button.append(node('strong', page === 'tasks' ? row.title : row.name), node('small', subtitle));
   button.type = 'button';
   button.setAttribute('aria-pressed', String(row.id === selected));
   button.addEventListener('click', () => void open(row.id));
   item.append(button);
   return item;
  }));
 }
 async function load(append = false) {
  if (!page) return;
  const revision = ++pageRevision;
  if (!append) {
   rows = [];
   cursor = '';
   offset = 0;
   resetDetail();
   renderRows();
  }
  more.hidden = true;
  refresh.disabled = true;
  status.textContent = 'Loading…';
  try {
   const response = await api.teamPage({page, offset, cursor});
   if (revision !== pageRevision) return;
   const next = page === 'tasks' ? response.items : response.groups;
   if (!Array.isArray(next)) throw Error('The team page could not be read.');
   rows = Array.from(new Map([...rows, ...next].map(row => [row.id, row])).values());
   offset += next.length;
   cursor = response.nextCursor || '';
   renderRows();
   status.textContent = rows.length ? '' : page === 'tasks' ? 'No tasks yet.' : 'No worship groups available.';
   more.hidden = page === 'tasks' ? !next.length || offset >= response.total : !cursor;
  } catch (error) {
   if (revision === pageRevision) {
    status.textContent = error.message;
    more.hidden = !append;
   }
  } finally {
   if (revision === pageRevision) refresh.disabled = false;
  }
 }
 async function open(id) {
  const revision = ++detailRevision;
  selected = id;
  for (const [index, button] of [...list.querySelectorAll('button')].entries()) {
   button.setAttribute('aria-pressed', String(rows[index]?.id === id));
  }
  const isTask = page === 'tasks';
  detail.hidden = false;
  detail.replaceChildren(node('p', 'Loading details…'));
  try {
   const response = await api.teamPage({page: isTask ? 'task' : 'group', id});
   if (revision !== detailRevision) return;
   const record = isTask ? response.task : response.group;
   if (!record) throw Error('This item is unavailable.');
   detail.replaceChildren(node('h2', isTask ? record.title : record.name));
   if (isTask) {
    detail.append(node('p', [statuses[record.status], record.authorName].filter(Boolean).join(' · ')), node('p', record.body || 'No description.'));
    if (response.notes?.length) {
     detail.append(node('h3', 'Notes'));
     for (const note of response.notes) {
      detail.append(node('p', [note.authorName, note.body].filter(Boolean).join(' · ')));
     }
    }
    return;
   }
   if (record.members?.length) {
    const members = node('ul');
    members.replaceChildren(...record.members.map(member => node('li', member.name)));
    detail.append(node('h3', 'Members'), members);
   }
   const files = node('ul');
   const loadMore = node('button', 'Load more files');
   loadMore.type = 'button';
   const fileStatus = node('p');
   fileStatus.setAttribute('role', 'status');
   let fileCursor = '';
   async function loadFiles() {
    loadMore.disabled = true;
    fileStatus.textContent = 'Loading shared files…';
    try {
     const result = await api.teamPage({page: 'files', id, cursor: fileCursor});
     if (revision !== detailRevision) return;
     for (const file of result.materials || []) files.append(node('li', file.title || file.filename));
     fileStatus.textContent = files.children.length ? '' : 'No shared files.';
     fileCursor = result.nextCursor || '';
     loadMore.hidden = !fileCursor;
    } catch (error) {
     if (revision === detailRevision) {
      fileStatus.textContent = error.message;
      loadMore.textContent = 'Retry loading files';
      loadMore.hidden = false;
     }
    } finally {
     loadMore.disabled = false;
    }
   }
   loadMore.addEventListener('click', () => void loadFiles());
   detail.append(node('h3', 'Shared files'), files, fileStatus, loadMore);
   await loadFiles();
  } catch (error) {
   if (revision === detailRevision) detail.replaceChildren(node('p', error.message));
  }
 }
 refresh.addEventListener('click', () => void load());
 more.addEventListener('click', () => void load(true));
 return {
  show(next) {
   if (next === page) return;
   pageRevision++;
   resetDetail();
   page = next;
   rows = [];
   list.replaceChildren();
   status.textContent = '';
   more.hidden = true;
   if (page) {
    title.textContent = page === 'tasks' ? 'Tasks' : 'Groups';
    void load();
   }
  }
 };
}
