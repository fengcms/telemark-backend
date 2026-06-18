import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// 用户/员工表：系统登录主体，包含管理员、经理、普通员工三类角色。
export const users = sqliteTable(
	'users',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),

		// 登录账号，全系统唯一。
		username: text('username').notNull().unique(),

		// 密码哈希与盐值，后续登录校验必须同时使用。
		passwordHash: text('password_hash').notNull(),
		salt: text('salt').notNull(),

		// 员工基础资料。
		realName: text('real_name').notNull(),
		phone: text('phone'),

		// 1: 超级管理员, 2: 经理, 3: 普通员工。
		role: integer('role').notNull().default(3),

		// 1: 在职/正常, 0: 离职/禁用。
		status: integer('status').notNull().default(1),
		remark: text('remark'),

		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index('idx_users_role').on(table.role), index('idx_users_status').on(table.status)],
);

// 数据批次表：记录管理员每次导入号码的来源、成本和数量。
export const batches = sqliteTable(
	'batches',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),

		// 批次名称，例如：2026年6月展会名单。
		name: text('name').notNull(),

		// 数据来源，例如：展会、广告投放、合作渠道。
		source: text('source'),

		// 批次成本，建议用“分”存储，避免小数精度问题。
		cost: integer('cost').notNull().default(0),

		// 本批次导入的线索总数。
		totalCount: integer('total_count').notNull().default(0),

		// 执行导入的管理员/经理。
		creatorId: integer('creator_id')
			.notNull()
			.references(() => users.id),

		remark: text('remark'),
		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index('idx_batches_creator_id').on(table.creatorId), index('idx_batches_created_at').on(table.createdAt)],
);

// 客户线索表：当前线索状态与归属，以 phone 做全局查重依据。
export const customers = sqliteTable(
	'customers',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),

		// 客户电话号码，导入前建议先规范化格式。
		phone: text('phone').notNull().unique(),
		name: text('name'),
		company: text('company'),

		// -1: 废线索, 0: 普通线索, 1: 意向客户, 2: 高意向客户。
		type: integer('type').notNull().default(0),

		// 0: 未拨打, 1: 已接听, 2: 无人接听, 3: 拒接, 4: 空号停机。
		status: integer('status').notNull().default(0),

		// 最新总备注，通话单次备注保存在 call_logs。
		remark: text('remark'),

		// 当前归属销售；为空表示在公海/未分配。
		ownerId: integer('owner_id').references(() => users.id),

		// 所属导入批次。
		batchId: integer('batch_id')
			.notNull()
			.references(() => batches.id),

		// 软删除/作废标记：1 表示客户已作废，历史通话与分配日志仍保留。
		isDeleted: integer('is_deleted').notNull().default(0),
		deletedAt: text('deleted_at'),
		deletedBy: integer('deleted_by').references(() => users.id),
		deleteReason: text('delete_reason'),

		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index('idx_customers_owner_id').on(table.ownerId),
		index('idx_customers_batch_id').on(table.batchId),
		index('idx_customers_type').on(table.type),
		index('idx_customers_status').on(table.status),
		index('idx_customers_is_deleted').on(table.isDeleted),
	],
);

// 通话记录历史表：每一次拨打都写入一条不可变轨迹。
export const callLogs = sqliteTable(
	'call_logs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),

		// 被拨打的客户线索。
		customerId: integer('customer_id')
			.notNull()
			.references(() => customers.id),

		// 执行拨打的员工。
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),

		// 实际拨打时间。
		callTime: text('call_time').notNull().default(sql`CURRENT_TIMESTAMP`),

		// 通话时长，单位：秒。
		duration: integer('duration').notNull().default(0),

		// 单次拨打结果状态码，通常与 customers.status 保持同一套枚举。
		callResult: integer('call_result').notNull(),
		callRemark: text('call_remark'),
		clientRequestId: text('client_request_id'),
		startedAt: text('started_at'),
		endedAt: text('ended_at'),

		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index('idx_call_logs_customer_id').on(table.customerId),
		index('idx_call_logs_user_id').on(table.userId),
		index('idx_call_logs_call_time').on(table.callTime),
		uniqueIndex('call_logs_user_client_request_unique')
			.on(table.userId, table.clientRequestId)
			.where(sql`${table.clientRequestId} IS NOT NULL`),
	],
);

// 线索分配流转历史表：记录分配、转移、收回公海等动作，供审计与防撞单使用。
export const assignmentLogs = sqliteTable(
	'assignment_logs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),

		// 被流转的客户线索。
		customerId: integer('customer_id')
			.notNull()
			.references(() => customers.id),

		// 原归属销售；为空表示从公海/未分配状态分配出去。
		fromUserId: integer('from_user_id').references(() => users.id),

		// 新归属销售；为空表示收回公海/取消分配。
		toUserId: integer('to_user_id').references(() => users.id),

		// 执行本次分配/回收动作的管理员或经理。
		operatorId: integer('operator_id')
			.notNull()
			.references(() => users.id),

		// 1: 分配, 2: 转移, 3: 收回公海。
		action: integer('action').notNull(),
		remark: text('remark'),

		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		index('idx_assignment_logs_customer_id').on(table.customerId),
		index('idx_assignment_logs_from_user_id').on(table.fromUserId),
		index('idx_assignment_logs_to_user_id').on(table.toUserId),
		index('idx_assignment_logs_operator_id').on(table.operatorId),
		index('idx_assignment_logs_created_at').on(table.createdAt),
	],
);

// 员工每日行为统计表：按员工和日期聚合，用于日报、排行榜和管理后台统计。
export const agentDailySummaries = sqliteTable(
	'agent_daily_summaries',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),

		// 被统计的员工。
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),

		// 统计日期，格式：YYYY-MM-DD。
		date: text('date').notNull(),

		// 当日首次拨打时间和最后拨打时间。
		firstCallTime: text('first_call_time'),
		lastCallTime: text('last_call_time'),

		// 当日总拨打次数、接通次数和总通话时长。
		totalCalls: integer('total_calls').notNull().default(0),
		connectedCalls: integer('connected_calls').notNull().default(0),
		totalDuration: integer('total_duration').notNull().default(0),

		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [
		uniqueIndex('uniq_agent_daily_summaries_user_id_date').on(table.userId, table.date),
		index('idx_agent_daily_summaries_date').on(table.date),
	],
);

// 常用客户反馈备注表：供 APP 快捷选择，管理后台可维护启停与排序。
export const commonCallRemarks = sqliteTable(
	'common_call_remarks',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),

		// 备注内容，全局唯一。
		content: text('content').notNull().unique(),

		// 排序值，越小越靠前。
		sortOrder: integer('sort_order').notNull().default(0),

		// 1: 启用, 0: 停用。
		status: integer('status').notNull().default(1),

		// 预留使用次数，后续可用于智能排序。
		usageCount: integer('usage_count').notNull().default(0),

		createdBy: integer('created_by').references(() => users.id),
		updatedBy: integer('updated_by').references(() => users.id),

		createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
		updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
	},
	(table) => [index('idx_common_call_remarks_status_sort').on(table.status, table.sortOrder)],
);

export const usersRelations = relations(users, ({ many }) => ({
	createdBatches: many(batches),
	customers: many(customers),
	callLogs: many(callLogs),
	assignmentLogsFrom: many(assignmentLogs, { relationName: 'fromUser' }),
	assignmentLogsTo: many(assignmentLogs, { relationName: 'toUser' }),
	assignmentLogsOperated: many(assignmentLogs, { relationName: 'operator' }),
	dailySummaries: many(agentDailySummaries),
	createdCommonCallRemarks: many(commonCallRemarks, { relationName: 'commonCallRemarkCreator' }),
	updatedCommonCallRemarks: many(commonCallRemarks, { relationName: 'commonCallRemarkUpdater' }),
}));

export const batchesRelations = relations(batches, ({ one, many }) => ({
	creator: one(users, {
		fields: [batches.creatorId],
		references: [users.id],
	}),
	customers: many(customers),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
	owner: one(users, {
		fields: [customers.ownerId],
		references: [users.id],
	}),
	batch: one(batches, {
		fields: [customers.batchId],
		references: [batches.id],
	}),
	callLogs: many(callLogs),
	assignmentLogs: many(assignmentLogs),
}));

export const callLogsRelations = relations(callLogs, ({ one }) => ({
	customer: one(customers, {
		fields: [callLogs.customerId],
		references: [customers.id],
	}),
	user: one(users, {
		fields: [callLogs.userId],
		references: [users.id],
	}),
}));

export const assignmentLogsRelations = relations(assignmentLogs, ({ one }) => ({
	customer: one(customers, {
		fields: [assignmentLogs.customerId],
		references: [customers.id],
	}),
	fromUser: one(users, {
		fields: [assignmentLogs.fromUserId],
		references: [users.id],
		relationName: 'fromUser',
	}),
	toUser: one(users, {
		fields: [assignmentLogs.toUserId],
		references: [users.id],
		relationName: 'toUser',
	}),
	operator: one(users, {
		fields: [assignmentLogs.operatorId],
		references: [users.id],
		relationName: 'operator',
	}),
}));

export const agentDailySummariesRelations = relations(agentDailySummaries, ({ one }) => ({
	user: one(users, {
		fields: [agentDailySummaries.userId],
		references: [users.id],
	}),
}));

export const commonCallRemarksRelations = relations(commonCallRemarks, ({ one }) => ({
	creator: one(users, {
		fields: [commonCallRemarks.createdBy],
		references: [users.id],
		relationName: 'commonCallRemarkCreator',
	}),
	updater: one(users, {
		fields: [commonCallRemarks.updatedBy],
		references: [users.id],
		relationName: 'commonCallRemarkUpdater',
	}),
}));
