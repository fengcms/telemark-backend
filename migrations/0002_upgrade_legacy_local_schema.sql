-- 如果本地库仍停留在旧 3 表结构，这里补齐新增核心表。
-- 旧本地库的列补丁放在后续 0003 迁移中，避免全新库重复 ADD COLUMN。
CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    source TEXT,
    cost INTEGER NOT NULL DEFAULT 0,
    total_count INTEGER NOT NULL DEFAULT 0,
    creator_id INTEGER NOT NULL,
    remark TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(creator_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS assignment_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    from_user_id INTEGER,
    to_user_id INTEGER,
    operator_id INTEGER NOT NULL,
    action INTEGER NOT NULL,
    remark TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id) REFERENCES customers(id),
    FOREIGN KEY(from_user_id) REFERENCES users(id),
    FOREIGN KEY(to_user_id) REFERENCES users(id),
    FOREIGN KEY(operator_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS agent_daily_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    first_start_at TEXT,
    last_end_at TEXT,
    total_calls INTEGER NOT NULL DEFAULT 0,
    connected_calls INTEGER NOT NULL DEFAULT 0,
    total_duration INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_batches_creator_id ON batches(creator_id);
CREATE INDEX IF NOT EXISTS idx_batches_created_at ON batches(created_at);
CREATE INDEX IF NOT EXISTS idx_call_logs_customer_id ON call_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_user_id ON call_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_call_time ON call_logs(call_time);
CREATE INDEX IF NOT EXISTS idx_assignment_logs_customer_id ON assignment_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_assignment_logs_from_user_id ON assignment_logs(from_user_id);
CREATE INDEX IF NOT EXISTS idx_assignment_logs_to_user_id ON assignment_logs(to_user_id);
CREATE INDEX IF NOT EXISTS idx_assignment_logs_operator_id ON assignment_logs(operator_id);
CREATE INDEX IF NOT EXISTS idx_assignment_logs_created_at ON assignment_logs(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_daily_summaries_user_id_date ON agent_daily_summaries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_agent_daily_summaries_date ON agent_daily_summaries(date);
