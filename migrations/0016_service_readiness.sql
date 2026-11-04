CREATE TABLE station_service_checks (
 device_id TEXT NOT NULL,
 service_id TEXT NOT NULL,
 version_id TEXT NOT NULL REFERENCES station_service_versions(id) ON DELETE CASCADE,
 content_key TEXT NOT NULL CHECK(length(content_key)=64),
 report_json TEXT NOT NULL CHECK(json_valid(report_json)),
 checked_at INTEGER NOT NULL,
 checked_by TEXT NOT NULL REFERENCES users(id),
 acknowledged_at INTEGER,
 acknowledged_by TEXT REFERENCES users(id),
 PRIMARY KEY(device_id,service_id),
 FOREIGN KEY(device_id,service_id) REFERENCES station_services(device_id,id) ON DELETE CASCADE
);
CREATE INDEX station_service_checks_content ON station_service_checks(content_key,checked_at);
