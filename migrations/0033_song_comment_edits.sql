-- Additive, bounded passage data; legacy comments keep their scalar fields and retry hashes.
ALTER TABLE song_comments ADD COLUMN edits_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(edits_json));
