import {expect,it,vi,afterEach} from 'vitest';
import {startWorkspaceEvents} from '../src/web/workspace-live';
import {workspaceMutation} from '../src/shared/workspace-events';
class Visibility extends EventTarget { visibilityState='visible'; set(value:string){this.visibilityState=value;this.dispatchEvent(new Event('visibilitychange'));} }
class Socket extends EventTarget { closed=false; close(){this.closed=true;} message(type:string){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type})}));} }
afterEach(()=>vi.useRealTimers());
it('coalesces live changes, ignores unknown payloads and refreshes every domain after reconnect',()=>{
 vi.useFakeTimers();const visibility=new Visibility(),sockets:Socket[]=[],seen:string[]=[];
 const stop=startWorkspaceEvents(type=>seen.push(type),{visibility,create:()=>{const socket=new Socket();sockets.push(socket);return socket;}});
 sockets[0].message('tasks-ready');sockets[0].message('tasks-changed');sockets[0].message('arbitrary');vi.advanceTimersByTime(150);expect(seen).toEqual(['all']);
 sockets[0].message('files-changed');sockets[0].message('files-changed');vi.advanceTimersByTime(150);expect(seen).toEqual(['all','files']);
 visibility.set('hidden');expect(sockets[0].closed).toBe(true);sockets[0].message('catalog-changed');vi.advanceTimersByTime(30000);expect(sockets).toHaveLength(1);
 visibility.set('visible');expect(sockets).toHaveLength(2);sockets[1].message('tasks-ready');vi.advanceTimersByTime(150);expect(seen.at(-1)).toBe('all');stop();sockets[1].message('tasks-changed');vi.advanceTimersByTime(30000);expect(seen).toHaveLength(3);
});
it('revocation triggers an authenticated refresh without reconnecting the rejected session',()=>{
 vi.useFakeTimers();const visibility=new Visibility(),seen:string[]=[],sockets:Socket[]=[];
 const stop=startWorkspaceEvents(type=>seen.push(type),{visibility,create:()=>{const socket=new Socket();sockets.push(socket);return socket;}});
 sockets[0].dispatchEvent(new CloseEvent('close',{code:1008}));vi.advanceTimersByTime(30000);expect(seen).toEqual(['all']);expect(sockets).toHaveLength(1);stop();
});
it('only mutation domains invalidate; reads, partial catalogs and unrelated requests do not',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 expect(workspaceMutation('GET','/api/worship-groups')).toBeNull();expect(workspaceMutation('POST','/api/station/catalog')).toBeNull();expect(workspaceMutation('POST','/api/auth/logout')).toBeNull();
 expect(workspaceMutation('PATCH','/api/worship-groups/'+id)).toBe('groups-changed');expect(workspaceMutation('PUT','/api/file-edits/group/'+id)).toBe('files-changed');expect(workspaceMutation('POST','/api/computers/'+id+'/services')).toBe('services-changed');
});
