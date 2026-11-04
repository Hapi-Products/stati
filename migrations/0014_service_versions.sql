CREATE TABLE station_service_versions (
 id TEXT PRIMARY KEY,
 device_id TEXT NOT NULL,
 service_id TEXT NOT NULL,
 service_revision INTEGER NOT NULL CHECK(service_revision>=1),
 content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
 content_json TEXT NOT NULL CHECK(json_valid(content_json)),
 lyrics_json TEXT NOT NULL CHECK(json_valid(lyrics_json)),
 approved_by TEXT NOT NULL REFERENCES users(id),
 approved_by_label TEXT NOT NULL,
 approved_at INTEGER NOT NULL,
 FOREIGN KEY(device_id,service_id) REFERENCES station_services(device_id,id) ON DELETE CASCADE,
 UNIQUE(device_id,service_id,service_revision)
);
CREATE INDEX station_service_versions_lookup ON station_service_versions(device_id,service_id,service_revision DESC);
CREATE TRIGGER station_service_versions_immutable BEFORE UPDATE ON station_service_versions
 BEGIN SELECT RAISE(ABORT,'Approved service versions are immutable'); END;
