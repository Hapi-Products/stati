ALTER TABLE transfers ADD COLUMN rejection_reason TEXT;
CREATE TABLE delivery_records (
 id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
 sender_id TEXT REFERENCES users(id), filename TEXT NOT NULL, bytes INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','delivered','rejected','expired')),
 rejection_reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX delivery_records_sender ON delivery_records(sender_id,created_at);
CREATE INDEX delivery_records_device ON delivery_records(device_id,created_at);
INSERT INTO delivery_records SELECT id,device_id,sender_id,filename,bytes,status,NULL,created_at,COALESCE(delivered_at,created_at) FROM transfers;
CREATE TABLE enrollment_tickets (grant_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
