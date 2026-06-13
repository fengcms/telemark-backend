ALTER TABLE customers ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN deleted_at TEXT;
ALTER TABLE customers ADD COLUMN deleted_by INTEGER;
ALTER TABLE customers ADD COLUMN delete_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_is_deleted ON customers(is_deleted);
