-- A verified joining code gives this browser time to finish one registration.
-- The code is not stored. New grants retain the station revocation boundary.
ALTER TABLE enrollment_tickets ADD COLUMN device_id TEXT REFERENCES devices(id) ON DELETE CASCADE;
ALTER TABLE enrollment_tickets ADD COLUMN challenge_id TEXT;
CREATE INDEX enrollment_tickets_expiry ON enrollment_tickets(expires_at);
