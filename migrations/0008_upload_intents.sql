-- Accepted operation identity survives deletion of temporary transfer bytes.
CREATE TABLE upload_intents (
 sender_id TEXT NOT NULL REFERENCES users(id),
 device_id TEXT NOT NULL REFERENCES devices(id),
 intent_id TEXT NOT NULL,
 filename TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes>0 AND bytes<=52428800),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 transfer_id TEXT UNIQUE REFERENCES delivery_records(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 PRIMARY KEY(sender_id,device_id,intent_id)
);
CREATE INDEX upload_intents_expiry ON upload_intents(expires_at);
-- No personal fields: unknown late writes keep only a random-key tombstone.
CREATE TABLE upload_attempts (
 id TEXT PRIMARY KEY,
 object_key TEXT NOT NULL UNIQUE,
 transfer_id TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('active','ready','cleanup','retired')),
 expires_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX upload_attempts_cleanup ON upload_attempts(state,expires_at);
