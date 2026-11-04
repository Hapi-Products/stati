-- Stable private groups are separate from legacy ministry-wide text labels.
CREATE TABLE worship_groups (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 owner_id TEXT NOT NULL REFERENCES users(id),
 creation_hash TEXT NOT NULL CHECK(length(creation_hash)=64),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 archived_at INTEGER
);
CREATE INDEX worship_groups_order ON worship_groups(archived_at,created_at DESC,id DESC);
CREATE TABLE worship_group_members (
 group_id TEXT NOT NULL REFERENCES worship_groups(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 assigned_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(group_id,user_id)
);
CREATE INDEX worship_group_members_user ON worship_group_members(user_id,group_id);
ALTER TABLE group_materials ADD COLUMN group_id TEXT REFERENCES worship_groups(id);
CREATE INDEX group_materials_private_group ON group_materials(group_id,state,created_at DESC,id DESC);
