'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { parseHTML } = require('linkedom');

test('the desktop team pages show details and clear them when leaving the workspace', async () => {
 const html = readFileSync(join(__dirname, '../desktop/index.html'), 'utf8');
 const source = readFileSync(join(__dirname, '../desktop/team-workspace.js'), 'utf8');
 const { document } = parseHTML(html);
 const get = id => document.getElementById(id);
 const settle = () => new Promise(resolve => setImmediate(resolve));
 let lateTask;
 const api = {
  teamPage({ page }) {
   switch (page) {
    case 'tasks': return { items: [{ id: 'task-1', title: 'Check microphone', status: 'new' }], total: 1 };
    case 'task': return new Promise(resolve => { lateTask = resolve; });
    case 'groups': return { groups: [{ id: 'group-1', name: 'Sunday team', memberCount: 1 }] };
    case 'group': return { group: { name: 'Sunday team', members: [{ name: 'Sample member' }] } };
    case 'files': return { materials: [{ title: 'Running order' }] };
    default: throw Error(page);
   }
  }
 };
 const workspace = runInNewContext(source + '\ncreateTeamWorkspace(api)', { document, api });
 workspace.show('tasks');
 await settle();
 assert.match(get('team-rows').textContent, /Check microphone/);
 get('team-rows').querySelector('button').click();
 workspace.show('groups');
 lateTask({ task: { title: 'Late task' } });
 await settle();
 assert.doesNotMatch(get('team-detail').textContent, /Late task/);
 get('team-rows').querySelector('button').click();
 await settle();
 assert.match(get('team-detail').textContent, /Sample member/);
 assert.match(get('team-detail').textContent, /Running order/);
 workspace.show(null);
 assert.equal(get('team-rows').children.length, 0);
 assert.equal(get('team-detail').children.length, 0);
});
