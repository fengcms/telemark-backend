-- 修复早期本地 customers 表仍使用 group_id、缺少 batch_id / created_at 的问题。
-- 此迁移专为旧版本地库设计；全新安装时 0001 已包含这些定义。
--
-- ⚠️ 重要提示：
--   SQLite/D1 不支持 "ALTER TABLE ADD COLUMN IF NOT EXISTS"。
--   如果此迁移报错 "duplicate column name"，说明该列已在 0001 中创建，
--   可安全忽略此错误，继续后续迁移。
--
-- 对于全新安装（推荐）：
--   可直接运行 pnpm db:migrations:apply:local，
--   遇到 0003 错误时按 Enter 继续，后续迁移仍会正常执行。

-- 尝试添加 batch_id 列（全新安装时会因已存在而报错，可忽略）
ALTER TABLE customers ADD COLUMN batch_id INTEGER;

-- 尝试添加 created_at 列（全新安装时会因已存在而报错，可忽略）
ALTER TABLE customers ADD COLUMN created_at TEXT;

-- 更新空值（幂等操作）
UPDATE customers
SET created_at = COALESCE(created_at, updated_at, CURRENT_TIMESTAMP)
WHERE created_at IS NULL;

-- 创建索引（IF NOT EXISTS 保证幂等）
CREATE INDEX IF NOT EXISTS idx_customers_batch_id ON customers(batch_id);
CREATE INDEX IF NOT EXISTS idx_customers_type ON customers(type);
