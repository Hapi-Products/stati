-- Local roles never inherit authority from the account-wide legacy roles.
-- Preserve those legacy values until all clients have migrated to station scope.
ALTER TABLE station_memberships ADD COLUMN role TEXT NOT NULL DEFAULT 'member'
 CHECK(role IN ('member','admin'));
ALTER TABLE station_memberships ADD COLUMN ministry_role TEXT
 CHECK(ministry_role IN ('worship_leader','worship_member','pastor','choir_director','commenter'));

-- Ownership is already an explicit grant. Preserve explicit denials and removals.
INSERT INTO station_memberships(device_id,user_id,status,updated_at,role)
 SELECT d.id,d.owner_id,'approved',d.created_at,'admin' FROM devices d
 WHERE d.owner_id IS NOT NULL AND d.revoked_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM station_disconnections removed
  WHERE removed.device_id=d.id AND removed.user_id=d.owner_id)
 ON CONFLICT(device_id,user_id) DO UPDATE SET role='admin'
 WHERE station_memberships.status='approved';
