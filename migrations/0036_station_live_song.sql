CREATE TABLE station_live_song (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  service_revision INTEGER NOT NULL,
  song_id TEXT NOT NULL,
  song_title TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(device_id, service_id) REFERENCES station_services(device_id, id) ON DELETE CASCADE
);
