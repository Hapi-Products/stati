CREATE TABLE station_drive_limits (
  device_id TEXT NOT NULL REFERENCES station_drive_folders(device_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_limit INTEGER NOT NULL CHECK (account_limit BETWEEN 0 AND 20),
  PRIMARY KEY (device_id, user_id)
);

CREATE TABLE station_drive_accounts (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES station_drive_folders(device_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  identity_hash TEXT NOT NULL,
  label TEXT NOT NULL,
  linked_at INTEGER NOT NULL,
  UNIQUE (device_id, user_id, identity_hash)
);
