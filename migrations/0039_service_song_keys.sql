CREATE TABLE station_service_song_keys (
 device_id TEXT NOT NULL,
 service_id TEXT NOT NULL,
 item_id TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 pitch INTEGER CHECK(pitch BETWEEN 0 AND 11),
 revision INTEGER NOT NULL CHECK(revision>=1),
 PRIMARY KEY(device_id,service_id,item_id),
 FOREIGN KEY(device_id,service_id) REFERENCES station_services(device_id,id) ON DELETE CASCADE
);
