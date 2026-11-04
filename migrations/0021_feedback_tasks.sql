CREATE TABLE feedback_tasks (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','in-progress','complete')),
 urgent INTEGER NOT NULL DEFAULT 0 CHECK(urgent IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 author_id TEXT NOT NULL REFERENCES users(id),
 updated_by TEXT NOT NULL REFERENCES users(id),
 create_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX feedback_tasks_board ON feedback_tasks(status,urgent,updated_at,id);
CREATE TABLE feedback_task_notes (
 id TEXT PRIMARY KEY,
 task_id TEXT NOT NULL REFERENCES feedback_tasks(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES users(id),
 body TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX feedback_task_notes_task ON feedback_task_notes(task_id,created_at,id);
