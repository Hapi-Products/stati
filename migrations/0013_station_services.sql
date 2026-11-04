CREATE TABLE station_services (
 device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 title TEXT NOT NULL,
 date TEXT NOT NULL,
 time TEXT NOT NULL,
 archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
 revision INTEGER NOT NULL CHECK(revision>=1),
 content_json TEXT NOT NULL CHECK(json_valid(content_json)),
 created_by TEXT NOT NULL REFERENCES users(id),
 updated_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(device_id,id)
);
CREATE INDEX station_services_date ON station_services(device_id,date,time,id);
CREATE TABLE station_service_selections (
 device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
 service_id TEXT,
 updated_by TEXT NOT NULL REFERENCES users(id),
 updated_at INTEGER NOT NULL
);
