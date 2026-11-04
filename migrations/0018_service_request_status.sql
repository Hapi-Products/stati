-- Direct request status updates no longer require an approval/acknowledgement chain.
-- Preserve existing request history and attachment/identity constraints.
CREATE TABLE service_requests_status (
 device_id TEXT NOT NULL,
 service_id TEXT NOT NULL,
 id TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 author_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 placement TEXT NOT NULL,
 deadline INTEGER,
 assignee_id TEXT REFERENCES users(id),
 attachment_transfer_id TEXT,
 attachment_sha256 TEXT,
 attachment_filename TEXT,
 attachment_bytes INTEGER,
 status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','received','needs-correction','approved','added')),
 status_note TEXT NOT NULL DEFAULT '',
 content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
 create_hash TEXT NOT NULL CHECK(length(create_hash)=64),
 approved_hash TEXT,
 approved_at INTEGER,
 added_at INTEGER,
 updated_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(device_id,service_id,id),
 FOREIGN KEY(device_id,service_id) REFERENCES station_services(device_id,id) ON DELETE CASCADE,
 CHECK((attachment_transfer_id IS NULL AND attachment_sha256 IS NULL AND attachment_filename IS NULL AND attachment_bytes IS NULL) OR (attachment_transfer_id IS NOT NULL AND attachment_sha256 IS NOT NULL AND length(attachment_sha256)=64 AND attachment_filename IS NOT NULL AND attachment_bytes IS NOT NULL AND attachment_bytes>0)),
 CHECK(status<>'added' OR added_at IS NOT NULL)
);
INSERT INTO service_requests_status(device_id,service_id,id,revision,author_id,title,body,placement,deadline,assignee_id,attachment_transfer_id,attachment_sha256,attachment_filename,attachment_bytes,status,status_note,content_hash,create_hash,approved_hash,approved_at,added_at,updated_by,created_at,updated_at) SELECT device_id,service_id,id,revision,author_id,title,body,placement,deadline,assignee_id,attachment_transfer_id,attachment_sha256,attachment_filename,attachment_bytes,status,status_note,content_hash,create_hash,approved_hash,approved_at,added_at,updated_by,created_at,updated_at FROM service_requests;
DROP TABLE service_requests;
ALTER TABLE service_requests_status RENAME TO service_requests;
CREATE INDEX service_requests_service ON service_requests(device_id,service_id,created_at,id);
CREATE INDEX service_requests_author ON service_requests(author_id,created_at);
