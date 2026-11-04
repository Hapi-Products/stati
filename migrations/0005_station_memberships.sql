CREATE TABLE station_memberships (
 device_id TEXT NOT NULL REFERENCES devices(id), user_id TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN ('approved','denied')), updated_at INTEGER NOT NULL,
 PRIMARY KEY(device_id,user_id)
);
INSERT INTO station_memberships SELECT c.device_id,c.user_id,c.status,c.created_at FROM computer_connections c WHERE c.status IN ('approved','denied') AND c.id=(SELECT recent.id FROM computer_connections recent WHERE recent.device_id=c.device_id AND recent.user_id=c.user_id AND recent.status IN ('approved','denied') ORDER BY recent.created_at DESC,recent.id DESC LIMIT 1);
