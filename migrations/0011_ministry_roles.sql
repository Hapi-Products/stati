-- Ministry responsibilities do not replace the legacy admin/member boundary.
CREATE TABLE user_ministry_roles (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('worship_leader','worship_member','pastor','choir_director')),
 assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX user_ministry_roles_role ON user_ministry_roles(role,user_id);

-- A passkey-selected ministry operator is bound to the role authenticated then.
ALTER TABLE operator_selections ADD COLUMN ministry_role TEXT
 CHECK(ministry_role IS NULL OR ministry_role IN ('worship_leader','worship_member','pastor','choir_director'));

CREATE TRIGGER ministry_role_created AFTER INSERT ON user_ministry_roles
BEGIN
 DELETE FROM operator_selections WHERE user_id=NEW.user_id;
 DELETE FROM operator_sessions WHERE user_id=NEW.user_id;
 DELETE FROM operator_unlocks WHERE user_id=NEW.user_id;
 UPDATE devices SET operator_id=NULL WHERE operator_id=NEW.user_id;
END;
CREATE TRIGGER ministry_role_changed AFTER UPDATE OF role ON user_ministry_roles
WHEN OLD.role IS NOT NEW.role
BEGIN
 DELETE FROM operator_selections WHERE user_id=NEW.user_id;
 DELETE FROM operator_sessions WHERE user_id=NEW.user_id;
 DELETE FROM operator_unlocks WHERE user_id=NEW.user_id;
 UPDATE devices SET operator_id=NULL WHERE operator_id=NEW.user_id;
END;
CREATE TRIGGER ministry_role_removed AFTER DELETE ON user_ministry_roles
BEGIN
 DELETE FROM operator_selections WHERE user_id=OLD.user_id;
 DELETE FROM operator_sessions WHERE user_id=OLD.user_id;
 DELETE FROM operator_unlocks WHERE user_id=OLD.user_id;
 UPDATE devices SET operator_id=NULL WHERE operator_id=OLD.user_id;
END;
