-- Preserve existing responsibilities and their revocation triggers while adding Commenter.
CREATE TABLE user_ministry_roles_next (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('worship_leader','worship_member','pastor','choir_director','commenter')),
 assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 updated_at INTEGER NOT NULL
);
INSERT INTO user_ministry_roles_next SELECT * FROM user_ministry_roles;
DROP TABLE user_ministry_roles;
ALTER TABLE user_ministry_roles_next RENAME TO user_ministry_roles;
CREATE INDEX user_ministry_roles_role ON user_ministry_roles(role,user_id);
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
-- Commenters do not select a PC operator; that existing proof schema remains unchanged.
CREATE TABLE song_comments (
 id TEXT PRIMARY KEY REFERENCES feedback_tasks(id) ON DELETE CASCADE,
 device_id TEXT NOT NULL REFERENCES devices(id),
 song_id TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 author_id TEXT NOT NULL REFERENCES users(id),
 message TEXT NOT NULL,
 quoted_text TEXT NOT NULL,
 proposed_text TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX song_comments_author ON song_comments(author_id,created_at,id);
CREATE INDEX song_comments_song ON song_comments(device_id,song_id,created_at,id);
