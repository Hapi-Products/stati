-- Listing and filtering use narrow indexed metadata rather than whole lyric rows.
CREATE INDEX station_catalog_category ON station_catalog(device_id,category);
CREATE INDEX station_catalog_order ON station_catalog(device_id,title,song_id);
CREATE INDEX station_catalog_language ON station_catalog(device_id,language);
