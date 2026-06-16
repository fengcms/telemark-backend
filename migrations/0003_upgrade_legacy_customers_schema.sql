-- 修复早期本地 customers 表仍使用 group_id、缺少 batch_id / created_at 的问题。
-- 此迁移采用重建表方式，兼容全新安装（0001 已有这些列）和旧库升级。

PRAGMA defer_foreign_keys = true;

CREATE TABLE customers_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL UNIQUE,
    name TEXT,
    company TEXT,
    type INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 0,
    remark TEXT,
    owner_id INTEGER,
    batch_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(owner_id) REFERENCES users(id),
    FOREIGN KEY(batch_id) REFERENCES batches(id)
);

INSERT INTO customers_new (
    id,
    phone,
    name,
    company,
    type,
    status,
    remark,
    owner_id,
    batch_id,
    created_at,
    updated_at
)
SELECT
    id,
    phone,
    name,
    company,
    type,
    status,
    remark,
    owner_id,
    batch_id,
    COALESCE(created_at, updated_at, CURRENT_TIMESTAMP),
    updated_at
FROM customers;

DROP TABLE customers;

ALTER TABLE customers_new RENAME TO customers;

CREATE INDEX IF NOT EXISTS idx_customers_owner_id ON customers(owner_id);
CREATE INDEX IF NOT EXISTS idx_customers_batch_id ON customers(batch_id);
CREATE INDEX IF NOT EXISTS idx_customers_type ON customers(type);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
