import { hash, HttpError, now } from './core';
import type { MinistryAuthority } from './ministry-roles';
import { stationMinistryGuard } from './station-catalog';

export const maxDriveAccounts = 20;

export function driveLimitSql(user: string, admin: string) {
  return `COALESCE((SELECT account_limit FROM station_drive_limits
    WHERE device_id=folder.device_id AND user_id=${user}),
    CASE WHEN ${admin} OR folder.allow_members=1 THEN 1 ELSE 0 END)`;
}

const eligibleUser = `(candidate.role='admin' OR (
  EXISTS(SELECT 1 FROM user_ministry_roles WHERE user_id=candidate.id AND role IN ('worship_member','worship_leader'))
  AND EXISTS(SELECT 1 FROM station_memberships WHERE device_id=folder.device_id AND user_id=candidate.id AND status='approved')))
  AND NOT EXISTS(SELECT 1 FROM station_disconnections WHERE device_id=folder.device_id AND user_id=candidate.id)`;

export function driveAccounts(env: Env, deviceId: string, userId: string) {
  return env.DB.prepare('SELECT id,label FROM station_drive_accounts WHERE device_id=? AND user_id=? ORDER BY linked_at,id')
    .bind(deviceId, userId).all<{ id: string; label: string }>();
}

export function driveMembers(env: Env, deviceId: string) {
  return env.DB.prepare(`SELECT candidate.id,TRIM(candidate.first_name || ' ' || candidate.last_initial) AS name,
    ${driveLimitSql('candidate.id', "candidate.role='admin'")} AS accountLimit,
    (SELECT COUNT(*) FROM station_drive_accounts WHERE device_id=folder.device_id AND user_id=candidate.id) AS linkedAccounts
    FROM station_drive_folders folder CROSS JOIN users candidate
    WHERE folder.device_id=? AND folder.folder_id IS NOT NULL AND candidate.status='active' AND ${eligibleUser}
    ORDER BY candidate.first_name COLLATE NOCASE,candidate.last_initial COLLATE NOCASE,candidate.id`).bind(deviceId).all();
}

export async function setDriveLimit(env: Env, authority: MinistryAuthority, deviceId: string, userId: string, revision: number, limit: number) {
  const time = now();
  const guard = stationMinistryGuard(authority, deviceId, 'manageTeam', time);
  const auditId = crypto.randomUUID();
  const mutations = await env.DB.batch([
    env.DB.prepare(`UPDATE station_drive_folders AS folder SET revision=revision+1
      WHERE device_id=? AND revision=? AND folder_id IS NOT NULL AND ${guard.sql}
      AND EXISTS(SELECT 1 FROM users candidate WHERE candidate.id=? AND candidate.status='active' AND ${eligibleUser})`)
      .bind(deviceId, revision, ...guard.params, userId),
    env.DB.prepare(`INSERT INTO station_drive_limits(device_id,user_id,account_limit) SELECT ?,?,? WHERE changes()>0
      ON CONFLICT(device_id,user_id) DO UPDATE SET account_limit=excluded.account_limit`).bind(deviceId, userId, limit),
    env.DB.prepare("INSERT INTO audit(id,actor_id,action,subject_id,created_at) SELECT ?,?,'drive-account-limit',?,? WHERE changes()>0")
      .bind(auditId, authority.user.id, userId, time),
    env.DB.prepare(`DELETE FROM station_drive_accounts WHERE id IN (
      SELECT id FROM station_drive_accounts WHERE device_id=? AND user_id=? ORDER BY linked_at,id LIMIT -1 OFFSET ?
    ) AND EXISTS(SELECT 1 FROM audit WHERE id=?)`).bind(deviceId, userId, limit, auditId),
  ]);
  if (!mutations[0].meta.changes) throw new HttpError(409, 'The person or Drive settings changed. Refresh and try again.');
}

export async function registerDriveAccount(
  env: Env, authority: MinistryAuthority, deviceId: string, revision: number,
  account: { permissionId: string; label: string }
) {
  const time = now();
  const guard = stationMinistryGuard(authority, deviceId, 'sendFiles', time);
  const userId = authority.user.id;
  const identity = await hash(JSON.stringify([deviceId, userId, account.permissionId]));
  const limit = driveLimitSql('?', '?');
  const linked = await env.DB.prepare(`INSERT INTO station_drive_accounts(id,device_id,user_id,identity_hash,label,linked_at)
    SELECT ?,folder.device_id,?,?,?,? FROM station_drive_folders folder
    WHERE folder.device_id=? AND folder.revision=? AND folder.folder_id IS NOT NULL AND ${guard.sql}
    AND EXISTS(SELECT 1 FROM users candidate WHERE candidate.id=? AND ${eligibleUser})
    AND ${limit}>0 AND (
      EXISTS(SELECT 1 FROM station_drive_accounts WHERE device_id=folder.device_id AND user_id=? AND identity_hash=?)
      OR (SELECT COUNT(*) FROM station_drive_accounts WHERE device_id=folder.device_id AND user_id=?)<${limit}
    )
    ON CONFLICT(device_id,user_id,identity_hash) DO UPDATE SET label=excluded.label`)
    .bind(crypto.randomUUID(), userId, identity, account.label, time, deviceId, revision, ...guard.params,
      userId, userId, Number(authority.user.role === 'admin'), userId, identity, userId, userId, Number(authority.user.role === 'admin')).run();
  if (!linked.meta.changes) throw new HttpError(409, 'The Google Drive account limit was reached or your access changed. Check File Providers in Features.');
}

export async function removeDriveAccount(env: Env, authority: MinistryAuthority, deviceId: string, revision: number, id: string) {
  const guard = stationMinistryGuard(authority, deviceId, 'sendFiles');
  const mutations = await env.DB.batch([
    env.DB.prepare(`DELETE FROM station_drive_accounts WHERE id=? AND device_id=? AND user_id=? AND ${guard.sql}
      AND EXISTS(SELECT 1 FROM station_drive_folders WHERE device_id=? AND revision=?)`)
      .bind(id, deviceId, authority.user.id, ...guard.params, deviceId, revision),
    env.DB.prepare('UPDATE station_drive_folders SET revision=revision+1 WHERE device_id=? AND changes()>0').bind(deviceId),
  ]);
  if (!mutations[0].meta.changes) throw new HttpError(409, 'The account or Drive settings changed. Refresh and try again.');
}
