CREATE TABLE account_pins(user_id TEXT PRIMARY KEY REFERENCES users(id),salt TEXT NOT NULL,digest TEXT NOT NULL);
CREATE TABLE operator_unlocks(token_hash TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES devices(id),user_id TEXT NOT NULL REFERENCES users(id),challenge TEXT NOT NULL,expires_at INTEGER NOT NULL,approved INTEGER NOT NULL DEFAULT 0);
CREATE TABLE operator_sessions(token_hash TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES devices(id),user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
