CREATE TABLE station_drive_folders (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  folder_id TEXT,
  folder_name TEXT,
  allow_members INTEGER NOT NULL CHECK (allow_members IN (0, 1)),
  revision INTEGER NOT NULL CHECK (revision > 0),
  CHECK ((folder_id IS NULL AND folder_name IS NULL AND allow_members = 0) OR
         (folder_id IS NOT NULL AND folder_name IS NOT NULL))
);
