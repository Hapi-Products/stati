import {HttpError,type User} from './core';
import type {MinistryRole} from './ministry-roles';

/** Authorization data only: callers must separately authenticate the session or
 * operator, and retain its same-statement guard on protected mutations. */
export type StationTeamScope=Readonly<{
 deviceId:string;userId:string;ownerId:string;
 role:User['role'];ministryRole:MinistryRole|null;
}>;

// Use identical eligibility rules for a read and the final mutation fence.
// Aliases are fixed internal SQL, never request input.
const eligibility=`d.revoked_at IS NULL AND member.status='active'
 AND owner.status='active'
 AND NOT EXISTS(SELECT 1 FROM station_disconnections removed
  WHERE removed.device_id=d.id AND removed.user_id=member.id)
 AND (membership.status IS NULL OR membership.status='approved')
 AND (d.owner_id=member.id OR membership.status='approved')`;
const joins=`FROM devices d JOIN users owner ON owner.id=d.owner_id
 JOIN users member ON member.id=?
 LEFT JOIN station_memberships membership ON membership.device_id=d.id AND membership.user_id=member.id`;
const localRole="CASE WHEN d.owner_id=member.id THEN 'admin' ELSE membership.role END";

export async function readStationTeamScope(env:Pick<Env,'DB'>,deviceId:string,userId:string):Promise<StationTeamScope>{
 const scope=await env.DB.prepare(`SELECT d.id AS deviceId,member.id AS userId,
 d.owner_id AS ownerId,${localRole} AS role,membership.ministry_role AS ministryRole
 ${joins} WHERE d.id=? AND ${eligibility}`).bind(userId,deviceId).first<StationTeamScope>();
 if(!scope)throw new HttpError(403,'You need an invitation to this computer.');
 return Object.freeze(scope);
}

/** Prevent a stale scoped role from authorizing a write after demotion/removal.
 * Combine with the authenticated session/operator guard in the SAME statement. */
export function stationTeamScopeGuard(scope:StationTeamScope){
 return{sql:`EXISTS(SELECT 1 ${joins} WHERE d.id=? AND d.owner_id=?
 AND ${eligibility} AND ${localRole}=? AND membership.ministry_role IS ?)`,
 params:[scope.userId,scope.deviceId,scope.ownerId,scope.role,scope.ministryRole]};
}
