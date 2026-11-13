CREATE TABLE worship_live_reader (
  device_id TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES worship_groups(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  service_revision INTEGER NOT NULL,
  leadership_revision INTEGER NOT NULL,
  leader_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  position_json TEXT NOT NULL CHECK(json_valid(position_json)),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(device_id, group_id),
  FOREIGN KEY(device_id, service_id) REFERENCES station_services(device_id, id) ON DELETE CASCADE
);
