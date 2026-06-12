-- 修复早期本地 call_logs 表 call_time / created_at 默认值与当前 Drizzle schema 不一致的问题。
-- SQLite 不能直接修改已有列的 DEFAULT，因此采用重建表并复制数据的方式。
PRAGMA defer_foreign_keys = true;

CREATE TABLE call_logs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    call_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    duration INTEGER NOT NULL DEFAULT 0,
    call_result INTEGER NOT NULL,
    call_remark TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id) REFERENCES customers(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
);

INSERT INTO call_logs_new (
    id,
    customer_id,
    user_id,
    call_time,
    duration,
    call_result,
    call_remark,
    created_at
)
SELECT
    id,
    customer_id,
    user_id,
    COALESCE(call_time, created_at, CURRENT_TIMESTAMP),
    duration,
    call_result,
    call_remark,
    COALESCE(created_at, call_time, CURRENT_TIMESTAMP)
FROM call_logs;

DROP TABLE call_logs;

ALTER TABLE call_logs_new RENAME TO call_logs;

CREATE INDEX IF NOT EXISTS idx_call_logs_customer_id ON call_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_user_id ON call_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_call_time ON call_logs(call_time);
