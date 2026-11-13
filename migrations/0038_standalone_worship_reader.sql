CREATE TABLE worship_live_reader_next (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES worship_groups(id) ON DELETE CASCADE,
  service_id TEXT,
  service_revision INTEGER NOT NULL,
  leadership_revision INTEGER NOT NULL,
  leader_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  position_json TEXT NOT NULL CHECK(json_valid(position_json)),
  expires_at INTEGER NOT NULL,
  song_id TEXT,
  song_hash TEXT,
  CHECK ((service_id IS NOT NULL AND song_id IS NULL AND song_hash IS NULL) OR
         (service_id IS NULL AND song_id IS NOT NULL AND song_hash IS NOT NULL)),
  PRIMARY KEY(device_id, group_id),
  FOREIGN KEY(device_id, service_id) REFERENCES station_services(device_id, id) ON DELETE CASCADE
);
INSERT INTO worship_live_reader_next
 (device_id,group_id,service_id,service_revision,leadership_revision,leader_id,session_id,sequence,item_id,position_json,expires_at)
 SELECT device_id,group_id,service_id,service_revision,leadership_revision,leader_id,session_id,sequence,item_id,position_json,expires_at
 FROM worship_live_reader;
DROP TABLE worship_live_reader;
ALTER TABLE worship_live_reader_next RENAME TO worship_live_reader;
