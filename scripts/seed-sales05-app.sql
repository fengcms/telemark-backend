-- APP local seed data for sales05.
-- Login username: sales05
-- Plain password for local testing: admin123
-- Frontend password hash: 240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9

PRAGMA foreign_keys = ON;

-- 1. Test users. Passwords are all based on frontend SHA-256(admin123) + per-user salt.
INSERT INTO users (
	username,
	password_hash,
	salt,
	real_name,
	phone,
	role,
	status,
	remark,
	created_at,
	updated_at
)
VALUES
	(
		'app_manager01',
		'6be14c4f7129db30739b8df1843860834c2afe8d641ecf4c4d85e983bd7c80e7',
		'test_app_manager01_salt_20260616',
		'APP测试经理',
		'13800050001',
		2,
		1,
		'APP本地测试经理，用于创建批次和分配线索',
		'2026-06-16T00:00:00.000Z',
		'2026-06-16T00:00:00.000Z'
	),
	(
		'sales05',
		'd0fe0fcbeb80fab0ff78f992478b77259e7502593259e851f8b3710ad9a69703',
		'test_sales05_salt_20260616',
		'销售五号',
		'13800050005',
		3,
		1,
		'APP本地测试账号，密码：admin123',
		'2026-06-16T00:00:00.000Z',
		'2026-06-16T00:00:00.000Z'
	),
	(
		'sales06',
		'd2dc845fedfbfb85340d348ac3bd15f5a3b0d7097d91148157592fa4408dc402',
		'test_sales06_salt_20260616',
		'销售六号',
		'13800050006',
		3,
		1,
		'APP本地隔离测试账号，sales05 不应看到此账号客户',
		'2026-06-16T00:00:00.000Z',
		'2026-06-16T00:00:00.000Z'
	)
ON CONFLICT(username) DO UPDATE SET
	password_hash = excluded.password_hash,
	salt = excluded.salt,
	real_name = excluded.real_name,
	phone = excluded.phone,
	role = excluded.role,
	status = excluded.status,
	remark = excluded.remark,
	updated_at = excluded.updated_at;

-- 2. Test batches. Reuse existing batches with same names on repeated seed runs.
INSERT INTO batches (name, source, cost, total_count, creator_id, remark, created_at, updated_at)
SELECT
	'APP测试-家装展会线索',
	'2026春季家装展会',
	6800,
	12,
	(SELECT id FROM users WHERE username = 'app_manager01'),
	'用于 sales05 APP 待拨与历史列表测试',
	'2026-06-16T00:05:00.000Z',
	'2026-06-16T00:05:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM batches WHERE name = 'APP测试-家装展会线索');

INSERT INTO batches (name, source, cost, total_count, creator_id, remark, created_at, updated_at)
SELECT
	'APP测试-线上表单线索',
	'小程序落地页',
	3200,
	12,
	(SELECT id FROM users WHERE username = 'app_manager01'),
	'用于 sales05 APP 已拨历史、今日战报和权限隔离测试',
	'2026-06-16T00:06:00.000Z',
	'2026-06-16T00:06:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM batches WHERE name = 'APP测试-线上表单线索');

-- 3. sales05 pending customers: GET /api/my-customers.
INSERT INTO customers (
	phone,
	name,
	company,
	type,
	status,
	remark,
	owner_id,
	batch_id,
	is_deleted,
	created_at,
	updated_at
)
VALUES
	('13905050001', '林先生', '林氏装饰材料', 0, 0, NULL, (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-家装展会线索'), 0, '2026-06-16T00:10:00.000Z', '2026-06-16T00:10:00.000Z'),
	('13905050002', '陈女士', '星河花园业主', 0, 0, NULL, (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-家装展会线索'), 0, '2026-06-16T00:11:00.000Z', '2026-06-16T00:11:00.000Z'),
	('13905050003', '周经理', '远航物业', 0, 0, '老小区翻新需求', (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-家装展会线索'), 0, '2026-06-16T00:12:00.000Z', '2026-06-16T00:12:00.000Z'),
	('13905050004', '吴先生', '个人客户', 0, 0, '关注全屋定制', (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-家装展会线索'), 0, '2026-06-16T00:13:00.000Z', '2026-06-16T00:13:00.000Z'),
	('13905050005', '郑女士', '阳光城业主', 0, 0, '下午更容易接听', (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-家装展会线索'), 0, '2026-06-16T00:14:00.000Z', '2026-06-16T00:14:00.000Z'),
	('13905050006', '赵总', '华庭民宿', 0, 0, '可能有工装需求', (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-家装展会线索'), 0, '2026-06-16T00:15:00.000Z', '2026-06-16T00:15:00.000Z'),
	('13905050007', '马先生', '江南水岸业主', 0, 0, NULL, (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-家装展会线索'), 0, '2026-06-16T00:16:00.000Z', '2026-06-16T00:16:00.000Z'),
	('13905050008', '刘女士', '个人客户', 0, 0, '咨询旧房改造', (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-家装展会线索'), 0, '2026-06-16T00:17:00.000Z', '2026-06-16T00:17:00.000Z')
ON CONFLICT(phone) DO UPDATE SET
	name = excluded.name,
	company = excluded.company,
	type = excluded.type,
	status = excluded.status,
	remark = excluded.remark,
	owner_id = excluded.owner_id,
	batch_id = excluded.batch_id,
	is_deleted = excluded.is_deleted,
	deleted_at = NULL,
	deleted_by = NULL,
	delete_reason = NULL,
	updated_at = excluded.updated_at;

-- 4. sales05 history customers: GET /api/my-customers/history.
INSERT INTO customers (
	phone,
	name,
	company,
	type,
	status,
	remark,
	owner_id,
	batch_id,
	is_deleted,
	created_at,
	updated_at
)
VALUES
	('13905050101', '王先生', '云栖雅苑业主', 1, 1, '已接听，预算 15 万，下周回访', (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-线上表单线索'), 0, '2026-06-15T01:00:00.000Z', '2026-06-16T09:40:10.000Z'),
	('13905050102', '李女士', '个人客户', 0, 2, '第二次仍无人接听', (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-线上表单线索'), 0, '2026-06-15T01:05:00.000Z', '2026-06-16T08:12:00.000Z'),
	('13905050103', '黄总', '轻住酒店', 1, 1, '有工装意向，需要发案例', (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-线上表单线索'), 0, '2026-06-15T01:10:00.000Z', '2026-06-16T02:18:30.000Z'),
	('13905050104', '孙先生', '金域蓝湾业主', 0, 3, '拒接，暂不需要', (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-线上表单线索'), 0, '2026-06-15T01:15:00.000Z', '2026-06-16T03:05:00.000Z'),
	('13905050105', '何女士', '个人客户', 0, 4, '空号停机', (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-线上表单线索'), 0, '2026-06-15T01:20:00.000Z', '2026-06-16T05:22:00.000Z'),
	('13905050106', '唐经理', '盛达办公', 1, 1, '已接听，约周三量房', (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-线上表单线索'), 0, '2026-06-14T01:00:00.000Z', '2026-06-15T09:31:00.000Z'),
	('13905050107', '许女士', '梧桐里业主', 0, 2, '两次无人接听', (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-线上表单线索'), 0, '2026-06-14T01:05:00.000Z', '2026-06-15T10:20:00.000Z'),
	('13905050108', '高先生', '个人客户', 0, 3, '明确拒绝营销电话', (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-线上表单线索'), 0, '2026-06-13T01:00:00.000Z', '2026-06-14T03:12:00.000Z')
ON CONFLICT(phone) DO UPDATE SET
	name = excluded.name,
	company = excluded.company,
	type = excluded.type,
	status = excluded.status,
	remark = excluded.remark,
	owner_id = excluded.owner_id,
	batch_id = excluded.batch_id,
	is_deleted = excluded.is_deleted,
	deleted_at = NULL,
	deleted_by = NULL,
	delete_reason = NULL,
	updated_at = excluded.updated_at;

-- 5. Isolation and soft-delete customers. sales05 should not see these in normal APP lists.
INSERT INTO customers (
	phone,
	name,
	company,
	type,
	status,
	remark,
	owner_id,
	batch_id,
	is_deleted,
	deleted_at,
	deleted_by,
	delete_reason,
	created_at,
	updated_at
)
VALUES
	('13906060001', '隔离待拨客户', 'sales06 客户', 0, 0, 'sales05 不应看到', (SELECT id FROM users WHERE username = 'sales06'), (SELECT id FROM batches WHERE name = 'APP测试-家装展会线索'), 0, NULL, NULL, NULL, '2026-06-16T00:30:00.000Z', '2026-06-16T00:30:00.000Z'),
	('13906060002', '隔离历史客户', 'sales06 客户', 1, 1, 'sales05 不应看到', (SELECT id FROM users WHERE username = 'sales06'), (SELECT id FROM batches WHERE name = 'APP测试-线上表单线索'), 0, NULL, NULL, NULL, '2026-06-16T00:31:00.000Z', '2026-06-16T00:31:00.000Z'),
	('13905050901', '作废待拨客户', 'sales05 作废客户', 0, 0, '作废线索，不应进入待拨列表', (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-家装展会线索'), 1, '2026-06-16T00:32:00.000Z', (SELECT id FROM users WHERE username = 'app_manager01'), '测试作废待拨客户', '2026-06-16T00:32:00.000Z', '2026-06-16T00:32:00.000Z'),
	('13905050902', '作废历史客户', 'sales05 作废客户', 1, 1, '作废线索，不应进入历史列表', (SELECT id FROM users WHERE username = 'sales05'), (SELECT id FROM batches WHERE name = 'APP测试-线上表单线索'), 1, '2026-06-16T00:33:00.000Z', (SELECT id FROM users WHERE username = 'app_manager01'), '测试作废历史客户', '2026-06-16T00:33:00.000Z', '2026-06-16T00:33:00.000Z')
ON CONFLICT(phone) DO UPDATE SET
	name = excluded.name,
	company = excluded.company,
	type = excluded.type,
	status = excluded.status,
	remark = excluded.remark,
	owner_id = excluded.owner_id,
	batch_id = excluded.batch_id,
	is_deleted = excluded.is_deleted,
	deleted_at = excluded.deleted_at,
	deleted_by = excluded.deleted_by,
	delete_reason = excluded.delete_reason,
	updated_at = excluded.updated_at;

-- 6. Assignment audit logs for seeded active sales05 customers.
INSERT INTO assignment_logs (customer_id, from_user_id, to_user_id, operator_id, action, remark, created_at)
SELECT
	c.id,
	NULL,
	(SELECT id FROM users WHERE username = 'sales05'),
	(SELECT id FROM users WHERE username = 'app_manager01'),
	1,
	'APP测试数据分配给 sales05',
	'2026-06-16T00:40:00.000Z'
FROM customers AS c
WHERE c.phone IN (
	'13905050001',
	'13905050002',
	'13905050003',
	'13905050004',
	'13905050005',
	'13905050006',
	'13905050007',
	'13905050008',
	'13905050101',
	'13905050102',
	'13905050103',
	'13905050104',
	'13905050105',
	'13905050106',
	'13905050107',
	'13905050108'
)
AND NOT EXISTS (
	SELECT 1
	FROM assignment_logs AS al
	WHERE al.customer_id = c.id
		AND al.to_user_id = (SELECT id FROM users WHERE username = 'sales05')
		AND al.operator_id = (SELECT id FROM users WHERE username = 'app_manager01')
		AND al.remark = 'APP测试数据分配给 sales05'
);

-- 7. Call logs for history and today's summary. client_request_id makes this idempotent.
INSERT OR IGNORE INTO call_logs (
	customer_id,
	user_id,
	call_time,
	duration,
	call_result,
	call_remark,
	client_request_id,
	started_at,
	ended_at,
	created_at
)
VALUES
	((SELECT id FROM customers WHERE phone = '13905050101'), (SELECT id FROM users WHERE username = 'sales05'), '2026-06-16T01:12:20.000Z', 126, 1, '已接听，预算 15 万，下周回访', 'sales05-20260616-001', '2026-06-16T01:10:14.000Z', '2026-06-16T01:12:20.000Z', '2026-06-16T01:12:21.000Z'),
	((SELECT id FROM customers WHERE phone = '13905050102'), (SELECT id FROM users WHERE username = 'sales05'), '2026-06-16T01:30:00.000Z', 0, 2, '无人接听，晚上再拨', 'sales05-20260616-002', '2026-06-16T01:29:50.000Z', '2026-06-16T01:30:00.000Z', '2026-06-16T01:30:01.000Z'),
	((SELECT id FROM customers WHERE phone = '13905050103'), (SELECT id FROM users WHERE username = 'sales05'), '2026-06-16T02:18:30.000Z', 210, 1, '有工装意向，需要发案例', 'sales05-20260616-003', '2026-06-16T02:15:00.000Z', '2026-06-16T02:18:30.000Z', '2026-06-16T02:18:31.000Z'),
	((SELECT id FROM customers WHERE phone = '13905050104'), (SELECT id FROM users WHERE username = 'sales05'), '2026-06-16T03:05:00.000Z', 8, 3, '拒接，暂不需要', 'sales05-20260616-004', '2026-06-16T03:04:52.000Z', '2026-06-16T03:05:00.000Z', '2026-06-16T03:05:01.000Z'),
	((SELECT id FROM customers WHERE phone = '13905050105'), (SELECT id FROM users WHERE username = 'sales05'), '2026-06-16T05:22:00.000Z', 0, 4, '空号停机', 'sales05-20260616-005', '2026-06-16T05:21:54.000Z', '2026-06-16T05:22:00.000Z', '2026-06-16T05:22:01.000Z'),
	((SELECT id FROM customers WHERE phone = '13905050101'), (SELECT id FROM users WHERE username = 'sales05'), '2026-06-16T09:40:10.000Z', 88, 1, '二次跟进，确认微信发送方案', 'sales05-20260616-006', '2026-06-16T09:38:42.000Z', '2026-06-16T09:40:10.000Z', '2026-06-16T09:40:11.000Z'),
	((SELECT id FROM customers WHERE phone = '13905050102'), (SELECT id FROM users WHERE username = 'sales05'), '2026-06-16T08:12:00.000Z', 0, 2, '第二次仍无人接听', 'sales05-20260616-007', '2026-06-16T08:11:46.000Z', '2026-06-16T08:12:00.000Z', '2026-06-16T08:12:01.000Z'),
	((SELECT id FROM customers WHERE phone = '13905050106'), (SELECT id FROM users WHERE username = 'sales05'), '2026-06-15T09:31:00.000Z', 328, 1, '已接听，约周三量房', 'sales05-20260615-001', '2026-06-15T09:25:32.000Z', '2026-06-15T09:31:00.000Z', '2026-06-15T09:31:01.000Z'),
	((SELECT id FROM customers WHERE phone = '13905050107'), (SELECT id FROM users WHERE username = 'sales05'), '2026-06-15T10:20:00.000Z', 0, 2, '两次无人接听', 'sales05-20260615-002', '2026-06-15T10:19:44.000Z', '2026-06-15T10:20:00.000Z', '2026-06-15T10:20:01.000Z'),
	((SELECT id FROM customers WHERE phone = '13905050108'), (SELECT id FROM users WHERE username = 'sales05'), '2026-06-14T03:12:00.000Z', 12, 3, '明确拒绝营销电话', 'sales05-20260614-001', '2026-06-14T03:11:48.000Z', '2026-06-14T03:12:00.000Z', '2026-06-14T03:12:01.000Z');

-- 8. Today's summary for GET /api/my-summary.
INSERT INTO agent_daily_summaries (
	user_id,
	date,
	first_call_time,
	last_call_time,
	total_calls,
	connected_calls,
	total_duration,
	created_at,
	updated_at
)
VALUES (
	(SELECT id FROM users WHERE username = 'sales05'),
	'2026-06-16',
	'2026-06-16T01:12:20.000Z',
	'2026-06-16T09:40:10.000Z',
	7,
	3,
	424,
	'2026-06-16T01:12:21.000Z',
	'2026-06-16T09:40:11.000Z'
)
ON CONFLICT(user_id, date) DO UPDATE SET
	first_call_time = excluded.first_call_time,
	last_call_time = excluded.last_call_time,
	total_calls = excluded.total_calls,
	connected_calls = excluded.connected_calls,
	total_duration = excluded.total_duration,
	updated_at = excluded.updated_at;
