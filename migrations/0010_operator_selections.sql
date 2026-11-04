-- A selected profile is distinct from the administrator's authentication proof.
CREATE TABLE operator_selections (
 device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 selection_hash TEXT NOT NULL UNIQUE,
 proof_kind TEXT NOT NULL CHECK(proof_kind IN ('member','pin','passkey')),
 status TEXT NOT NULL CHECK(status IN ('pending','active')),
 admin_session_hash TEXT,
 unlock_hash TEXT,
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 CHECK((status='pending' AND proof_kind='passkey' AND admin_session_hash IS NULL AND unlock_hash IS NOT NULL)
  OR (status='active' AND unlock_hash IS NULL AND
   ((proof_kind='member' AND admin_session_hash IS NULL) OR (proof_kind IN ('pin','passkey') AND admin_session_hash IS NOT NULL))))
);
CREATE INDEX operator_selections_user ON operator_selections(user_id);
CREATE INDEX operator_selections_expiry ON operator_selections(expires_at);

-- Revocation is part of the identity mutation transaction. Restoring a role,
-- status, PIN or pairing later cannot revive an earlier selection or proof.
CREATE TRIGGER operator_user_authority_changed AFTER UPDATE OF role,status ON users
WHEN OLD.role IS NOT NEW.role OR OLD.status IS NOT NEW.status
BEGIN
 DELETE FROM operator_selections WHERE user_id=NEW.id OR device_id IN (SELECT id FROM devices WHERE owner_id=NEW.id AND OLD.status IS NOT NEW.status);
 DELETE FROM operator_sessions WHERE user_id=NEW.id OR device_id IN (SELECT id FROM devices WHERE owner_id=NEW.id AND OLD.status IS NOT NEW.status);
 DELETE FROM operator_unlocks WHERE user_id=NEW.id OR device_id IN (SELECT id FROM devices WHERE owner_id=NEW.id AND OLD.status IS NOT NEW.status);
 UPDATE devices SET operator_id=NULL WHERE operator_id=NEW.id OR (owner_id=NEW.id AND OLD.status IS NOT NEW.status);
END;
CREATE TRIGGER operator_device_authority_changed AFTER UPDATE OF token_hash,owner_id,revoked_at ON devices
WHEN OLD.token_hash IS NOT NEW.token_hash OR OLD.owner_id IS NOT NEW.owner_id OR OLD.revoked_at IS NOT NEW.revoked_at
BEGIN
 DELETE FROM operator_selections WHERE device_id=NEW.id;
 DELETE FROM operator_sessions WHERE device_id=NEW.id;
 DELETE FROM operator_unlocks WHERE device_id=NEW.id;
 UPDATE devices SET operator_id=NULL WHERE id=NEW.id;
END;
CREATE TRIGGER operator_pin_created AFTER INSERT ON account_pins
BEGIN
 DELETE FROM operator_selections WHERE user_id=NEW.user_id;
 DELETE FROM operator_sessions WHERE user_id=NEW.user_id;
 DELETE FROM operator_unlocks WHERE user_id=NEW.user_id;
 UPDATE devices SET operator_id=NULL WHERE operator_id=NEW.user_id;
END;
CREATE TRIGGER operator_pin_changed AFTER UPDATE OF salt,digest ON account_pins
WHEN OLD.salt IS NOT NEW.salt OR OLD.digest IS NOT NEW.digest
BEGIN
 DELETE FROM operator_selections WHERE user_id=NEW.user_id;
 DELETE FROM operator_sessions WHERE user_id=NEW.user_id;
 DELETE FROM operator_unlocks WHERE user_id=NEW.user_id;
 UPDATE devices SET operator_id=NULL WHERE operator_id=NEW.user_id;
END;
CREATE TRIGGER operator_pin_removed AFTER DELETE ON account_pins
BEGIN
 DELETE FROM operator_selections WHERE user_id=OLD.user_id;
 DELETE FROM operator_sessions WHERE user_id=OLD.user_id;
 DELETE FROM operator_unlocks WHERE user_id=OLD.user_id;
 UPDATE devices SET operator_id=NULL WHERE operator_id=OLD.user_id;
END;
