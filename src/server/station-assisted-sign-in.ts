import {generateAuthenticationOptions, type AuthenticationResponseJSON} from '@simplewebauthn/server';
import {cookie, hash, HttpError, json, now, type User} from './core';
import {verifyAdminPasskey} from './operator-auth';

export const stationBackupCode = /^[0-9a-f]{32}$/i;

export function stationMemberAccess(station: string, member: string) {
 return `${member}.role='member' AND EXISTS(
  SELECT 1 FROM station_memberships membership
  WHERE membership.device_id=${station}.id AND membership.user_id=${member}.id AND membership.status='approved'
 ) AND NOT EXISTS(
  SELECT 1 FROM station_disconnections removed
  WHERE removed.device_id=${station}.id AND removed.user_id=${member}.id
 )`;
}

export function assistedApprover(alias: string) {
 return `EXISTS(
  SELECT 1 FROM users approver JOIN passkeys passkey ON passkey.user_id=approver.id
  WHERE approver.id=${alias}.approved_by AND approver.role='admin' AND approver.status='active'
  AND passkey.id=${alias}.passkey_id
 )`;
}

export async function replaceStationBackupCodes(
 request: Request,
 env: Env,
 member: User,
 challenge: string,
 response: AuthenticationResponseJSON,
) {
 if (member.role !== 'member') throw new HttpError(403, 'Backup codes are for member profiles.');
 await verifyAdminPasskey(env, member.id, challenge, response);
 const rawSession = cookie(request, 'stati_session');
 if (!rawSession) throw new HttpError(401, 'Sign in again.');

 const codes = Array.from({length: 5}, () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''));
 const digests = await Promise.all(codes.map(hash));
 const guard = `EXISTS(
  SELECT 1 FROM users member JOIN sessions session ON session.user_id=member.id
  JOIN passkeys key ON key.user_id=member.id
  WHERE member.id=? AND member.role='member' AND member.status='active'
  AND session.token_hash=? AND session.expires_at>? AND key.id=?
 )`;
 const params = [member.id, await hash(rawSession), now(), response.id];
 const results = await env.DB.batch([
  env.DB.prepare('DELETE FROM station_backup_codes WHERE user_id=? AND '+guard).bind(member.id, ...params),
  env.DB.prepare(`INSERT INTO station_backup_codes(user_id,code_hash)
   SELECT ?, value FROM json_each(?) WHERE ${guard}`).bind(member.id, JSON.stringify(digests), ...params),
 ]);
 if (results[1].meta.changes !== codes.length) throw new HttpError(403, 'Your account access changed. Sign in again.');
 return json({codes: codes.map(code => code.match(/.{4}/g)!.join('-'))});
}

export async function limitAssistedSignIn(env: Env, deviceId: string) {
 const time = now();
 const row = await env.DB.prepare(`INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?)
  ON CONFLICT(key) DO UPDATE SET
  count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
  expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
  WHERE expires_at<=? OR count<8 RETURNING count`)
  .bind('station-assisted:'+deviceId, time+60, time, time, time).first();
 if (!row) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
}

const eligibleRequest = `station.revoked_at IS NULL AND owner.status='active' AND member.status='active'
 AND ${stationMemberAccess('station','member')}
 AND selected.proof_kind='passkey' AND selected.status='pending' AND selected.expires_at>?
 AND challenge.expires_at>? AND challenge.approved=0 AND assistance.approved_by IS NULL
 AND ((selected.ministry_role IS NULL AND NOT EXISTS(SELECT 1 FROM user_ministry_roles WHERE user_id=member.id))
  OR EXISTS(SELECT 1 FROM user_ministry_roles WHERE user_id=member.id AND role=selected.ministry_role))`;

const reviewQuery = `SELECT challenge.token_hash,challenge.challenge,station.name,member.id AS user_id,member.first_name,member.last_initial
 FROM station_assisted_unlocks assistance
 JOIN operator_unlocks challenge ON challenge.token_hash=assistance.unlock_hash
 JOIN operator_selections selected ON selected.unlock_hash=challenge.token_hash
  AND selected.device_id=challenge.device_id AND selected.user_id=challenge.user_id
 JOIN devices station ON station.id=challenge.device_id
 JOIN users owner ON owner.id=station.owner_id
 JOIN users member ON member.id=challenge.user_id
 WHERE challenge.token_hash=? AND ${eligibleRequest}`;

type Review = {token_hash: string; challenge: string; name: string; user_id: string; first_name: string; last_initial: string};
const expired = () => new HttpError(410, 'This sign-in request expired or changed. Start again on the computer.');

export async function reviewStationAssistance(env: Env, raw: string) {
 const time = now();
 const request = await env.DB.prepare(reviewQuery).bind(await hash(raw), time, time).first<Review>();
 if (!request) throw expired();
 const options = await generateAuthenticationOptions({rpID: env.RP_ID, userVerification: 'required'});
 return json({name: request.name, person: request.first_name+' '+request.last_initial+'.',
  options: {...options, challenge: request.challenge}});
}

export async function approveStationAssistance(env: Env, raw: string, response: AuthenticationResponseJSON) {
 const digest = await hash(raw), time = now();
 const request = await env.DB.prepare(reviewQuery).bind(digest, time, time).first<Review>();
 if (!request) throw expired();
 const actor = await env.DB.prepare(`SELECT approver.id FROM users approver JOIN passkeys key ON key.user_id=approver.id
  WHERE key.id=? AND approver.role='admin' AND approver.status='active'`).bind(response.id).first<{id:string}>();
 if (!actor) throw new HttpError(403, 'Use an active administrator’s passkey to approve.');
 await verifyAdminPasskey(env, actor.id, request.challenge, response);

 const approvedAt = now();
 const results = await env.DB.batch([
  env.DB.prepare(`UPDATE station_assisted_unlocks SET approved_by=?,passkey_id=?
   WHERE unlock_hash=? AND EXISTS(${reviewQuery}) AND EXISTS(
    SELECT 1 FROM users approver JOIN passkeys key ON key.user_id=approver.id
    WHERE approver.id=? AND key.id=? AND approver.role='admin' AND approver.status='active'
   )`).bind(actor.id, response.id, digest, digest, approvedAt, approvedAt, actor.id, response.id),
  env.DB.prepare(`UPDATE operator_unlocks SET approved=1 WHERE token_hash=? AND changes()=1`).bind(digest),
  env.DB.prepare(`INSERT INTO audit(id,actor_id,action,subject_id,created_at)
   SELECT ?,?,'station-assisted-sign-in-approved',?,? WHERE changes()=1`)
   .bind(crypto.randomUUID(), actor.id, request.user_id, approvedAt),
 ]);
 if (!results[1].meta.changes) throw expired();
 return json({ok:true});
}
