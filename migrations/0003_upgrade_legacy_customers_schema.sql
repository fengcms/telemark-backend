-- 修复早期本地 customers 表仍使用 group_id、缺少 batch_id / created_at 的问题。
-- 注意：SQLite/D1 对 ADD COLUMN IF NOT EXISTS 支持有限；本迁移面向已应用旧 0001 的本地库。
ALTER TABLE customers ADD COLUMN batch_id INTEGER;

ALTER TABLE customers ADD COLUMN created_at TEXT;

UPDATE customers
SET created_at = COALESCE(created_at, updated_at, CURRENT_TIMESTAMP)
WHERE created_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_batch_id ON customers(batch_id);
CREATE INDEX IF NOT EXISTS idx_customers_type ON customers(type);
