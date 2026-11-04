CREATE TABLE delivery_dismissals (
 transfer_id TEXT NOT NULL REFERENCES delivery_records(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 dismissed_at INTEGER NOT NULL,
 PRIMARY KEY(transfer_id,user_id)
);
