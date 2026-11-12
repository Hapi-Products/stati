'use strict';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function teamEndpoint(input) {
 const { page, id, offset = 0, cursor = '' } = input ?? {};
 const validID = typeof id === 'string' && uuid.test(id);
 if (page === 'tasks' && Number.isSafeInteger(offset) && offset >= 0 && offset <= 1000000) return '/station/team/tasks?offset=' + offset;
 if (page === 'task' && validID) return '/station/team/tasks/' + id;
 if (page === 'group' && validID) return '/station/team/groups/' + id;
 if (typeof cursor === 'string' && (!cursor || /^\d{1,12}:[a-f0-9-]{36}$/i.test(cursor))) {
  const before = cursor ? '?before=' + encodeURIComponent(cursor) : '';
  if (page === 'groups') return '/station/team/groups' + before;
  if (page === 'files' && validID) {
   return '/station/team/files?groupId=' + id + (cursor ? '&before=' + encodeURIComponent(cursor) : '');
  }
 }
 throw Error('Choose a valid team page.');
}

module.exports = { teamEndpoint };
