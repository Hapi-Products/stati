/** Invalidation hints only. Clients must re-read through their authenticated API. */
export type WorkspaceChange='tasks'|'catalog'|'services'|'groups'|'files'|'all';
export type WorkspaceMessage='tasks-changed'|'catalog-changed'|'services-changed'|'groups-changed'|'files-changed'|'account-changed';
export function workspaceChange(value:unknown):WorkspaceChange|null {
 if(!value||typeof value!=='object'||!('type'in value))return null;
 const type=value.type;
 if(type==='tasks-ready'||type==='account-changed')return 'all';
 if(type==='tasks-changed')return 'tasks';
 if(type==='catalog-changed')return 'catalog';
 if(type==='services-changed')return 'services';
 if(type==='groups-changed')return 'groups';
 if(type==='files-changed')return 'files';
 return null;
}
/** Catalog publication has its own commit-only callback; task mutations already notify. */
export function workspaceMutation(method:string,path:string):WorkspaceMessage|null {
 if(['GET','HEAD','OPTIONS'].includes(method))return null;
 if(/^\/api\/(?:me(?:\/photo)?|members\/[0-9a-f-]{36}|(?:station\/)?connections\/[0-9a-f-]{36}\/decision|devices\/[0-9a-f-]{36})$/i.test(path))return 'account-changed';
 if(/^\/api\/(?:computers\/[0-9a-f-]{36}|station)\/services(?:\/[0-9a-f-]{36}\/(?:versions|requests|readiness))?$/i.test(path))return 'services-changed';
 if(/^\/api\/worship-groups(?:\/[0-9a-f-]{36})?$/i.test(path))return 'groups-changed';
 if(/^\/api\/group-materials(?:\/[0-9a-f-]{36}(?:\/(?:group|song-links))?)?$/i.test(path)||method==='PUT'&&/^\/api\/file-edits\/group\/[0-9a-f-]{36}$/i.test(path))return 'files-changed';
 return null;
}
