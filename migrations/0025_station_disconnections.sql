CREATE TABLE station_disconnections (
 device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 operation_id TEXT NOT NULL,
 PRIMARY KEY(device_id,user_id)
);
CREATE INDEX station_disconnections_user ON station_disconnections(user_id,device_id);
