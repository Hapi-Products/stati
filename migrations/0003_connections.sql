CREATE TABLE computer_connections (
 id TEXT PRIMARY KEY, receiver_id TEXT NOT NULL REFERENCES receivers(id),
 device_id TEXT NOT NULL REFERENCES devices(id), user_id TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN ('pending','approved','denied')),
 last_seen INTEGER NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(receiver_id,user_id)
);
CREATE INDEX connections_device ON computer_connections(device_id,status,last_seen);
