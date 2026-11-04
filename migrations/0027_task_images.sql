CREATE TABLE feedback_task_images (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES feedback_tasks(id), author_id TEXT NOT NULL REFERENCES users(id),
 filename TEXT NOT NULL, content_type TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE, upload_token TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('uploading','active','removed','failed')),
 created_at INTEGER NOT NULL, upload_expires_at INTEGER NOT NULL, deleted_by TEXT, cleanup_checked_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX feedback_task_images_task ON feedback_task_images(task_id,state,created_at);
CREATE INDEX feedback_task_images_author ON feedback_task_images(author_id,created_at);
CREATE INDEX feedback_task_images_cleanup ON feedback_task_images(state,cleanup_checked_at,created_at);
