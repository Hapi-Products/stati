CREATE TABLE station_song_commands (
 id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), author_id TEXT NOT NULL REFERENCES users(id),
 song_id TEXT NOT NULL, content_hash TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('clone','archive')),
 group_name TEXT, status TEXT NOT NULL CHECK(status IN ('pending','applied','failed')), result_json TEXT, message TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX station_song_commands_device ON station_song_commands(device_id,status,created_at);
