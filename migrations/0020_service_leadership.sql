-- Service-order leadership is separate from technical media review and from
-- immutable history copies. Existing plans and versions remain unchanged.
CREATE TABLE station_service_leadership (
 device_id TEXT NOT NULL,
 service_id TEXT NOT NULL,
 leader_id TEXT REFERENCES users(id),
 revision INTEGER NOT NULL CHECK(revision>=1),
 finalized_revision INTEGER,
 finalized_at INTEGER,
 acknowledged_revision INTEGER,
 acknowledged_by TEXT REFERENCES users(id),
 acknowledged_at INTEGER,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(device_id,service_id),
 FOREIGN KEY(device_id,service_id) REFERENCES station_services(device_id,id) ON DELETE CASCADE,
 CHECK((finalized_revision IS NULL AND finalized_at IS NULL) OR (finalized_revision>=1 AND finalized_at IS NOT NULL AND leader_id IS NOT NULL)),
 CHECK((acknowledged_revision IS NULL AND acknowledged_by IS NULL AND acknowledged_at IS NULL) OR (acknowledged_revision>=1 AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL))
);
