CREATE TABLE IF NOT EXISTS common_call_remarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 1,
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    updated_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id),
    FOREIGN KEY(updated_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_common_call_remarks_status_sort
ON common_call_remarks(status, sort_order);

INSERT INTO common_call_remarks (content, sort_order, status, usage_count, created_at, updated_at)
VALUES
    ('客户已接听，有明确意向', 10, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('客户有意向，稍后回访', 20, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('客户需要先看案例', 30, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('客户需要报价方案', 40, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('客户要求加微信沟通', 50, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('客户暂时不需要', 60, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('客户正在忙，约定稍后再拨', 70, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('无人接听，稍后再拨', 80, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('电话已接通但非本人', 90, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('客户拒接', 100, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('客户明确拒绝营销电话', 110, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('号码空号或停机', 120, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(content) DO NOTHING;
