import type { SQL } from 'drizzle-orm';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from '@/db';
import { assignmentLogs, customers, users } from '@/db/schema';

export type AssignmentLogSortField = 'id' | 'customerId' | 'fromUserId' | 'toUserId' | 'operatorId' | 'action' | 'createdAt';

export interface AssignmentLogFilters {
	page: number;
	pageSize: number;
	sortField: AssignmentLogSortField;
	sortDirection: 'asc' | 'desc';
	customerId?: number;
	operatorId?: number;
	fromUserId?: number | null;
	toUserId?: number | null;
	action?: number;
	startDate?: string;
	endDate?: string;
}

export interface AssignmentLogRow {
	id: number;
	customerId: number;
	customerPhone: string;
	customerName: string | null;
	fromUserId: number | null;
	fromUserName: string | null;
	toUserId: number | null;
	toUserName: string | null;
	operatorId: number;
	operatorName: string;
	action: number;
	reason: string | null;
	createdAt: string;
}

const fromUsers = alias(users, 'from_users');
const toUsers = alias(users, 'to_users');
const operatorUsers = alias(users, 'operator_users');

const sortColumns: Record<AssignmentLogSortField, AnySQLiteColumn> = {
	id: assignmentLogs.id,
	customerId: assignmentLogs.customerId,
	fromUserId: assignmentLogs.fromUserId,
	toUserId: assignmentLogs.toUserId,
	operatorId: assignmentLogs.operatorId,
	action: assignmentLogs.action,
	createdAt: assignmentLogs.createdAt,
};

export async function findAssignmentLogs(db: Db, filters: AssignmentLogFilters): Promise<{ total: number; list: AssignmentLogRow[] }> {
	const whereClause = buildWhereClause(filters);
	const totalRows = await db
		.select({ total: count() })
		.from(assignmentLogs)
		.innerJoin(customers, eq(assignmentLogs.customerId, customers.id))
		.leftJoin(fromUsers, eq(assignmentLogs.fromUserId, fromUsers.id))
		.leftJoin(toUsers, eq(assignmentLogs.toUserId, toUsers.id))
		.innerJoin(operatorUsers, eq(assignmentLogs.operatorId, operatorUsers.id))
		.where(whereClause);
	const orderBy = filters.sortDirection === 'asc' ? asc(sortColumns[filters.sortField]) : desc(sortColumns[filters.sortField]);
	const list = await db
		.select({
			id: assignmentLogs.id,
			customerId: assignmentLogs.customerId,
			customerPhone: customers.phone,
			customerName: customers.name,
			fromUserId: assignmentLogs.fromUserId,
			fromUserName: fromUsers.realName,
			toUserId: assignmentLogs.toUserId,
			toUserName: toUsers.realName,
			operatorId: assignmentLogs.operatorId,
			operatorName: operatorUsers.realName,
			action: assignmentLogs.action,
			reason: assignmentLogs.remark,
			createdAt: assignmentLogs.createdAt,
		})
		.from(assignmentLogs)
		.innerJoin(customers, eq(assignmentLogs.customerId, customers.id))
		.leftJoin(fromUsers, eq(assignmentLogs.fromUserId, fromUsers.id))
		.leftJoin(toUsers, eq(assignmentLogs.toUserId, toUsers.id))
		.innerJoin(operatorUsers, eq(assignmentLogs.operatorId, operatorUsers.id))
		.where(whereClause)
		.orderBy(orderBy)
		.limit(filters.pageSize)
		.offset(filters.page * filters.pageSize);

	return {
		total: totalRows[0]?.total ?? 0,
		list,
	};
}

function buildWhereClause(filters: AssignmentLogFilters): SQL | undefined {
	const conditions: SQL[] = [];

	if (filters.customerId !== undefined) {
		conditions.push(eq(assignmentLogs.customerId, filters.customerId));
	}

	if (filters.operatorId !== undefined) {
		conditions.push(eq(assignmentLogs.operatorId, filters.operatorId));
	}

	if (filters.fromUserId !== undefined) {
		conditions.push(
			filters.fromUserId === null ? sql`${assignmentLogs.fromUserId} is null` : eq(assignmentLogs.fromUserId, filters.fromUserId),
		);
	}

	if (filters.toUserId !== undefined) {
		conditions.push(filters.toUserId === null ? sql`${assignmentLogs.toUserId} is null` : eq(assignmentLogs.toUserId, filters.toUserId));
	}

	if (filters.action !== undefined) {
		conditions.push(eq(assignmentLogs.action, filters.action));
	}

	if (filters.startDate) {
		conditions.push(sql`date(${assignmentLogs.createdAt}) >= ${filters.startDate}`);
	}

	if (filters.endDate) {
		conditions.push(sql`date(${assignmentLogs.createdAt}) <= ${filters.endDate}`);
	}

	return conditions.length > 0 ? and(...conditions) : undefined;
}
