-- ============================================================
-- 线上测试数据清理脚本（D1 兼容版）
-- ⚠️ 危险操作：仅用于清理测试环境数据！
-- ============================================================

-- D1 数据库需要特殊处理外键约束
-- 使用 PRAGMA 临时禁用外键检查

PRAGMA foreign_keys = OFF;

-- 按依赖关系顺序删除（即使有外键也不会报错）

-- 1️⃣ 删除通话记录
DELETE FROM call_logs;

-- 2️⃣ 删除客户线索分配日志
DELETE FROM assignment_logs;

-- 3️⃣ 删除员工日报统计
DELETE FROM agent_daily_summaries;

-- 4️⃣ 删除客户线索
DELETE FROM customers;

-- 5️⃣ 删除数据批次
DELETE FROM batches;

-- 6️⃣ 删除非超管员工账号（保留 id=1）
DELETE FROM users WHERE id != 1;

-- 重新启用外键检查
PRAGMA foreign_keys = ON;
