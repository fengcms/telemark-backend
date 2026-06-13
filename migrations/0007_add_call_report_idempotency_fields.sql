ALTER TABLE call_logs ADD COLUMN client_request_id TEXT;
ALTER TABLE call_logs ADD COLUMN started_at TEXT;
ALTER TABLE call_logs ADD COLUMN ended_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS call_logs_user_client_request_unique
ON call_logs (user_id, client_request_id)
WHERE client_request_id IS NOT NULL;
