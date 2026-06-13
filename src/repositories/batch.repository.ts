import type { SQL } from 'drizzle-orm';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from '@/db';
import { batches, customers, users } from '@/db/schema';

export type BatchSortField = 'id' | 'name' | 'source' | 'cost' | 'creatorId' | 'createdAt' | 'updatedAt';

export interface BatchListFilters {
	page: number;
	pageSize: number;
	sortField: BatchSortField;
	sortDirection: 'asc' | 'desc';
	nameLike?: string;
	sourceLike?: string;
	creatorId?: number;
}

export interface BatchListRow {
	id: number;
	name: string;
	source: string | null;
	cost: number;
	creatorId: number;
	creatorName: string;
	createdAt: string;
	updatedAt: string;
}

export interface BatchDetail {
	id: number;
	name: string;
	source: string | null;
	cost: number;
}

export interface BatchCustomerStats {
	totalCustomers: number;
	assignedCustomers: number;
	unassignedCustomers: number;
	calledCustomers: number;
	uncalledCustomers: number;
	connectedCustomers: number;
	intentCustomers: number;
	invalidCustomers: number;
}

const sortColumns: Record<BatchSortField, AnySQLiteColumn> = {
	id: batches.id,
	name: batches.name,
	source: batches.source,
	cost: batches.cost,
	creatorId: batches.creatorId,
	createdAt: batches.createdAt,
	updatedAt: batches.updatedAt,
};

export async function findBatches(db: Db, filters: BatchListFilters): Promise<{ total: number; list: BatchListRow[] }> {
	const whereClause = buildBatchWhereClause(filters);
	const totalRows = await db.select({ total: count() }).from(batches).innerJoin(users, eq(batches.creatorId, users.id)).where(whereClause);
	const sortColumn = sortColumns[filters.sortField];
	const orderBy = filters.sortDirection === 'asc' ? asc(sortColumn) : desc(sortColumn);
	const list = await db
		.select({
			id: batches.id,
			name: batches.name,
			source: batches.source,
			cost: batches.cost,
			creatorId: batches.creatorId,
			creatorName: users.realName,
			createdAt: batches.createdAt,
			updatedAt: batches.updatedAt,
		})
		.from(batches)
		.innerJoin(users, eq(batches.creatorId, users.id))
		.where(whereClause)
		.orderBy(orderBy)
		.limit(filters.pageSize)
		.offset(filters.page * filters.pageSize);

	return {
		total: totalRows[0]?.total ?? 0,
		list,
	};
}

export async function findBatchById(db: Db, id: number): Promise<BatchDetail | undefined> {
	return db.query.batches.findFirst({
		where: eq(batches.id, id),
		columns: {
			id: true,
			name: true,
			source: true,
			cost: true,
		},
	});
}

export async function getBatchCustomerStats(db: Db, batchId: number): Promise<BatchCustomerStats> {
	const rows = await db
		.select({
			totalCustomers: count(),
			assignedCustomers: sql<number>`sum(case when ${customers.ownerId} is not null then 1 else 0 end)`,
			unassignedCustomers: sql<number>`sum(case when ${customers.ownerId} is null then 1 else 0 end)`,
			calledCustomers: sql<number>`sum(case when ${customers.status} != 0 then 1 else 0 end)`,
			uncalledCustomers: sql<number>`sum(case when ${customers.status} = 0 then 1 else 0 end)`,
			connectedCustomers: sql<number>`sum(case when ${customers.status} = 1 then 1 else 0 end)`,
			intentCustomers: sql<number>`sum(case when ${customers.type} = 1 then 1 else 0 end)`,
			invalidCustomers: sql<number>`sum(case when ${customers.status} = 4 then 1 else 0 end)`,
		})
		.from(customers)
		.where(and(eq(customers.batchId, batchId), eq(customers.isDeleted, 0)));
	const row = rows[0];

	return {
		totalCustomers: Number(row?.totalCustomers ?? 0),
		assignedCustomers: Number(row?.assignedCustomers ?? 0),
		unassignedCustomers: Number(row?.unassignedCustomers ?? 0),
		calledCustomers: Number(row?.calledCustomers ?? 0),
		uncalledCustomers: Number(row?.uncalledCustomers ?? 0),
		connectedCustomers: Number(row?.connectedCustomers ?? 0),
		intentCustomers: Number(row?.intentCustomers ?? 0),
		invalidCustomers: Number(row?.invalidCustomers ?? 0),
	};
}

function buildBatchWhereClause(filters: BatchListFilters): SQL | undefined {
	const conditions: SQL[] = [];

	if (filters.nameLike) {
		conditions.push(sql`instr(${batches.name}, ${filters.nameLike}) > 0`);
	}

	if (filters.sourceLike) {
		conditions.push(sql`instr(${batches.source}, ${filters.sourceLike}) > 0`);
	}

	if (filters.creatorId !== undefined) {
		conditions.push(eq(batches.creatorId, filters.creatorId));
	}

	return conditions.length > 0 ? and(...conditions) : undefined;
}
