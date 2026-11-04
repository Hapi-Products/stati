export class ApiError extends Error{constructor(message:string,public status:number){super(message);}}
export async function api<T=unknown>(path:string,init:RequestInit={}):Promise<T>{const response=await fetch('/api'+path,{...init,headers:{...(init.body&&typeof init.body==='string'?{'Content-Type':'application/json'}:{}),...init.headers}});const data=await response.json() as T & {error?:string};if(!response.ok)throw new ApiError(data.error||'Please try again.',response.status);return data as T;}
export const post=<T=unknown>(p:string,b:unknown={})=>api<T>(p,{method:'POST',body:JSON.stringify(b)});
export type MinistryRole='worship_leader'|'worship_member'|'pastor'|'choir_director'|'commenter';
export type MinistryCapabilities={readSongs:boolean;commentSongs:boolean;planServices:boolean;createSlides?:boolean;editLyrics:boolean;manageWorship:boolean;manageTeam:boolean;sendFiles:boolean};
type MinistryProfile={ministryRole?:MinistryRole|null;effectiveRole?:'admin'|'member'|MinistryRole;capabilities?:MinistryCapabilities;requiresUnlock?:boolean};
export type Me=MinistryProfile&{id:string;first_name:string;last_initial:string;role:'admin'|'member';status:'pending'|'active'|'removed';photoUrl:string|null};
export type Member=MinistryProfile&{id:string;first_name:string;last_initial:string;role:'admin'|'member';status:'pending'|'active';has_photo:number};
export type Computer={id:string;name:string;last_seen:number|null;owner_id:string;operator_id:string|null};
