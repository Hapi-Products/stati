PRAGMA foreign_keys = ON;
CREATE TABLE users (
 id TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_initial TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','removed')),
 photo_key TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE passkeys (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), public_key TEXT NOT NULL,
 counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE challenges (id TEXT PRIMARY KEY, kind TEXT NOT NULL, challenge TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE devices (
 id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, pair_code TEXT UNIQUE,
 name TEXT NOT NULL DEFAULT 'Church computer', owner_id TEXT REFERENCES users(id),
 created_at INTEGER NOT NULL, pair_expires INTEGER NOT NULL, last_seen INTEGER,
 revoked_at INTEGER, operator_id TEXT REFERENCES users(id)
);
CREATE TABLE receivers (
 id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), token_hash TEXT UNIQUE NOT NULL,
 expires_at INTEGER NOT NULL, closed_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE transfers (
 id TEXT PRIMARY KEY, receiver_id TEXT NOT NULL REFERENCES receivers(id), device_id TEXT NOT NULL REFERENCES devices(id),
 sender_id TEXT REFERENCES users(id), filename TEXT NOT NULL, bytes INTEGER NOT NULL,
 content_type TEXT NOT NULL, object_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','delivered','rejected','expired')) DEFAULT 'queued',
 created_at INTEGER NOT NULL, delivered_at INTEGER, expires_at INTEGER NOT NULL
);
CREATE TABLE requests (
 id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), user_id TEXT NOT NULL REFERENCES users(id),
 message TEXT NOT NULL, created_at INTEGER NOT NULL, acknowledged_at INTEGER
);
CREATE TABLE audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, subject_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX receivers_device ON receivers(device_id);
CREATE INDEX transfers_device ON transfers(device_id, status);
CREATE INDEX transfers_expiry ON transfers(expires_at);
CREATE INDEX requests_device ON requests(device_id, acknowledged_at);
