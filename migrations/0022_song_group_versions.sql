ALTER TABLE station_catalog ADD COLUMN group_name TEXT;
ALTER TABLE station_catalog ADD COLUMN source_song_id TEXT;
ALTER TABLE station_catalog_staging ADD COLUMN group_name TEXT;
ALTER TABLE station_catalog_staging ADD COLUMN source_song_id TEXT;
CREATE INDEX station_catalog_group ON station_catalog(device_id,group_name,title,song_id);
