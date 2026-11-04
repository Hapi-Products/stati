-- Deleting a task or comment hides it without discarding the original content.
ALTER TABLE feedback_tasks ADD COLUMN deleted_at INTEGER;
ALTER TABLE feedback_tasks ADD COLUMN deleted_by TEXT REFERENCES users(id);
ALTER TABLE feedback_task_notes ADD COLUMN deleted_at INTEGER;
ALTER TABLE feedback_task_notes ADD COLUMN deleted_by TEXT REFERENCES users(id);
CREATE INDEX feedback_tasks_visible_board ON feedback_tasks(deleted_at,status,urgent,updated_at,id);
CREATE INDEX feedback_task_notes_visible ON feedback_task_notes(task_id,deleted_at,created_at,id);
