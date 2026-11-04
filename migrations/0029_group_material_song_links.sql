-- Keep associations across complete catalog replacement; song IDs are not foreign keys.
-- Original shared files and presentation bytes are unaffected.
CREATE TABLE group_material_song_links (
 material_id TEXT NOT NULL REFERENCES group_materials(id) ON DELETE CASCADE,
 device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 song_id TEXT NOT NULL CHECK(length(song_id)=64 AND song_id NOT GLOB '*[^a-f0-9]*'),
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(material_id,device_id,song_id)
);
CREATE INDEX group_material_song_lookup ON group_material_song_links(device_id,song_id,material_id);
