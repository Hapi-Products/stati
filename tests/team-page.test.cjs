'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { teamEndpoint } = require('../desktop/team-page.cjs');

test('team navigation resolves only validated task, group and group file paths', () => {
 const id = 'ae0097e3-bd9f-410c-b7cd-37d25a104a71';
 assert.equal(teamEndpoint({page: 'tasks', offset: 150}), '/station/team/tasks?offset=150');
 assert.equal(teamEndpoint({page: 'task', id}), '/station/team/tasks/' + id);
 assert.equal(teamEndpoint({page: 'group', id}), '/station/team/groups/' + id);
 assert.equal(teamEndpoint({page: 'files', id, cursor: '12:' + id}),
  '/station/team/files?groupId=' + id + '&before=12%3A' + id);
 for (const input of [
  {page: '/members'},
  {page: 'tasks', offset: -1},
  {page: 'task', id: '../members'},
  {page: 'files', id, cursor: '12:' + id + '&groupId=other'}
 ]) {
  assert.throws(() => teamEndpoint(input), /valid team page/);
 }
});
