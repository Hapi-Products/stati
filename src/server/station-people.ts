import {HttpError,now,json,type Device} from './core';
import {requireMinistryCapability,ministryAuthorityGuard} from './ministry-roles';
export async function connectedStationPeople(request:Request,env:Env,device:Device){
 let authority;try{authority=await requireMinistryCapability(request,env,'manageTeam',device.id);}catch(error){if(error instanceof HttpError&&[401,403,428].includes(error.status))return[];throw error;}
 const time=now(),guard=ministryAuthorityGuard(authority,'manageTeam',time);
 const rows=await env.DB.prepare(`SELECT person.id,person.first_name,person.last_initial,person.photo_key IS NOT NULL AS has_photo,MAX(connection.last_seen) AS last_seen
 FROM computer_connections connection JOIN users person ON person.id=connection.user_id JOIN receivers receiver ON receiver.id=connection.receiver_id
 LEFT JOIN user_ministry_roles ministry ON ministry.user_id=person.id
 WHERE connection.device_id=? AND connection.status='approved' AND connection.last_seen>? AND receiver.device_id=connection.device_id AND receiver.closed_at IS NULL AND receiver.expires_at>?
 AND person.status='active' AND (ministry.role IS NULL OR ministry.role!='pastor')
 AND NOT EXISTS(SELECT 1 FROM station_disconnections removed WHERE removed.device_id=connection.device_id AND removed.user_id=person.id)
 AND (person.role='admin' OR NOT EXISTS(SELECT 1 FROM station_memberships member WHERE member.device_id=connection.device_id AND member.user_id=person.id AND member.status='denied'))
 AND ${guard.sql} GROUP BY person.id ORDER BY person.first_name,person.id`).bind(device.id,time-45,time,...guard.params).all();
 return rows.results;
}
