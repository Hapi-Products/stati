CREATE TABLE station_backup_codes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE station_assisted_unlocks (
  unlock_hash TEXT PRIMARY KEY REFERENCES operator_unlocks(token_hash) ON DELETE CASCADE,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  passkey_id TEXT REFERENCES passkeys(id) ON DELETE SET NULL
);

CREATE TABLE station_assisted_sessions (
  proof_hash TEXT PRIMARY KEY REFERENCES operator_sessions(token_hash) ON DELETE CASCADE,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  passkey_id TEXT REFERENCES passkeys(id) ON DELETE SET NULL
);
