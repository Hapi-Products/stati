-- Shared chord sheets / lyric reference images. Active objects have no expiry.
-- Group names organize the ministry-wide library; they are not access-control groups.
CREATE TABLE group_materials (
 id TEXT PRIMARY KEY,
 object_key TEXT NOT NULL UNIQUE,
 upload_token TEXT NOT NULL,
 group_name TEXT NOT NULL CHECK(length(group_name) BETWEEN 1 AND 80),
 group_key TEXT NOT NULL CHECK(length(group_key) BETWEEN 1 AND 160),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 filename TEXT NOT NULL CHECK(length(filename) BETWEEN 1 AND 200),
 bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 12582912),
 content_type TEXT NOT NULL CHECK(content_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
 author_id TEXT NOT NULL REFERENCES users(id),
 state TEXT NOT NULL CHECK(state IN ('uploading','active','deleting','retired')),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 upload_expires_at INTEGER NOT NULL
);
CREATE INDEX group_materials_library ON group_materials(state,created_at DESC,id DESC);
CREATE INDEX group_materials_group ON group_materials(group_key,state,created_at DESC,id DESC);
