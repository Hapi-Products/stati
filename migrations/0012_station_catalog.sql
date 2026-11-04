CREATE TABLE station_catalog_snapshots (
 device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
 generation TEXT NOT NULL,
 expected_count INTEGER NOT NULL CHECK(expected_count BETWEEN 0 AND 10000),
 unreadable INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK(status IN ('pending','committing','ready')),
 ready_at INTEGER, ready_unreadable INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);
CREATE TABLE station_catalog (
 device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 song_id TEXT NOT NULL, title TEXT NOT NULL, content_hash TEXT NOT NULL,
 filename TEXT NOT NULL, category TEXT NOT NULL, language TEXT NOT NULL,
 font_size INTEGER NOT NULL, text TEXT NOT NULL, first_slide TEXT NOT NULL,
 added_at INTEGER NOT NULL, modified_at INTEGER NOT NULL, generation TEXT NOT NULL, search_text TEXT NOT NULL,
 payload_bytes INTEGER NOT NULL CHECK(payload_bytes BETWEEN 0 AND 8388608),
 PRIMARY KEY(device_id,song_id)
);
CREATE TABLE station_catalog_staging (
 device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 song_id TEXT NOT NULL, title TEXT NOT NULL, content_hash TEXT NOT NULL,
 filename TEXT NOT NULL, category TEXT NOT NULL, language TEXT NOT NULL,
 font_size INTEGER NOT NULL, text TEXT NOT NULL, first_slide TEXT NOT NULL,
 added_at INTEGER NOT NULL, modified_at INTEGER NOT NULL, generation TEXT NOT NULL, search_text TEXT NOT NULL,
 payload_bytes INTEGER NOT NULL CHECK(payload_bytes BETWEEN 0 AND 8388608),
 PRIMARY KEY(device_id,generation,song_id)
);
