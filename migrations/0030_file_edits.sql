-- Markup keeps stable shared-file identities; immutable bytes retain earlier versions.
CREATE TABLE file_edits (
 id TEXT PRIMARY KEY, target_kind TEXT NOT NULL CHECK(target_kind IN ('group','task')),
 target_id TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id),
 base_sha256 TEXT NOT NULL, sha256 TEXT NOT NULL, filename TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes>0 AND bytes<=12582912), content_type TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL CHECK(state IN ('uploading','committed','failed')),
 created_at INTEGER NOT NULL, cleanup_checked_at INTEGER NOT NULL DEFAULT 0, committed_at INTEGER
);
CREATE INDEX file_edits_target ON file_edits(target_kind,target_id,created_at);
CREATE INDEX file_edits_author ON file_edits(author_id,created_at);
CREATE TABLE file_edit_heads (
 target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
 edit_id TEXT NOT NULL REFERENCES file_edits(id),
 PRIMARY KEY(target_kind,target_id)
);
