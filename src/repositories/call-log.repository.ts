import type { SQL } from 'drizzle-orm';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '@/db';
import { callLogs, customers, users } from '@/db/schema';

export type CallLogSortField = 'id' | 'customerId' | 'userId' | 'duration' | 'callResult' | 'createdAt';

export interface CallLogFilters {
	page: number;
	pageSize: number;
	sortField: CallLogSortField;
	sortDirection: 'asc' | 'desc';
	userId?: number;
	customerId?: number;
	phoneLike?: string;
	callResult?: number;
	startDate?: string;
	endDate?: string;
}

export interface CallLogRow {
	id: number;
	customerId: number;
	customerName: string | null;
	customerPhone: string;
	userId: number;
	username: string;
	userRealName: string;
	duration: number;
	callResult: number;
	callRemark: string | null;
	clientRequestId: string | null;
	startedAt: string | null;
	endedAt: string | null;
	createdAt: string;
}

const sortColumns: Record<CallLogSortField, AnySQLiteColumn> = {
	id: callLogs.id,
	customerId: callLogs.customerId,
	userId: callLogs.userId,
	duration: callLogs.duration,
	callResult: callLogs.callResult,
	createdAt: callLogs.createdAt,
};

export async function findCallLogs(db: Db, filters: CallLogFilters): Promise<{ total: number; list: CallLogRow[] }> {
	const whereClause = buildWhereClause(filters);
	const totalRows = await db
		.select({ total: count() })
		.from(callLogs)
		.innerJoin(customers, eq(callLogs.customerId, customers.id))
		.innerJoin(users, eq(callLogs.userId, users.id))
		.where(whereClause);
	const orderBy = filters.sortDirection === 'asc' ? asc(sortColumns[filters.sortField]) : desc(sortColumns[filters.sortField]);
	const list = await db
		.select({
			id: callLogs.id,
			customerId: callLogs.customerId,
			customerName: customers.name,
			customerPhone: customers.phone,
			userId: callLogs.userId,
			username: users.username,
			userRealName: users.realName,
			duration: callLogs.duration,
			callResult: callLogs.callResult,
			callRemark: callLogs.callRemark,
			clientRequestId: callLogs.clientRequestId,
			startedAt: callLogs.startedAt,
			endedAt: callLogs.endedAt,
			createdAt: callLogs.createdAt,
		})
		.from(callLogs)
		.innerJoin(customers, eq(callLogs.customerId, customers.id))
		.innerJoin(users, eq(callLogs.userId, users.id))
		.where(whereClause)
		.orderBy(orderBy)
		.limit(filters.pageSize)
		.offset(filters.page * filters.pageSize);

	return {
		total: totalRows[0]?.total ?? 0,
		list,
	};
}

function buildWhereClause(filters: CallLogFilters): SQL | undefined {
	const conditions: SQL[] = [];

	if (filters.userId !== undefined) {
		conditions.push(eq(callLogs.userId, filters.userId));
	}

	if (filters.customerId !== undefined) {
		conditions.push(eq(callLogs.customerId, filters.customerId));
	}

	if (filters.phoneLike) {
		conditions.push(sql`${customers.phone} LIKE ${`%${escapeLikeValue(filters.phoneLike)}%`} ESCAPE '\\'`);
	}

	if (filters.callResult !== undefined) {
		conditions.push(eq(callLogs.callResult, filters.callResult));
	}

	if (filters.startDate) {
		conditions.push(sql`date(${callLogs.createdAt}) >= ${filters.startDate}`);
	}

	if (filters.endDate) {
		conditions.push(sql`date(${callLogs.createdAt}) <= ${filters.endDate}`);
	}

	return conditions.length > 0 ? and(...conditions) : undefined;
}

function escapeLikeValue(value: string): string {
	return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
