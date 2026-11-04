-- A durable ledger exists before writing profile bytes. Current objects do not
-- expire. Unknown/late writes keep a retired tombstone: profiles/ has no R2 TTL.
CREATE TABLE profile_photo_objects (
 object_key TEXT PRIMARY KEY,
 user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 expected_key TEXT,
 state TEXT NOT NULL CHECK(state IN ('active','ready','current','cleanup','retired')),
 expires_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX profile_photo_objects_cleanup ON profile_photo_objects(state,expires_at,updated_at);
CREATE INDEX users_photo_key ON users(photo_key) WHERE photo_key IS NOT NULL;
-- Preserve existing referenced photos, including removed accounts' history.
INSERT OR IGNORE INTO profile_photo_objects(object_key,user_id,expected_key,state,expires_at,updated_at)
 SELECT photo_key,id,NULL,'current',0,created_at FROM users WHERE photo_key IS NOT NULL;
