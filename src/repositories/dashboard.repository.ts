import type { SQL } from 'drizzle-orm';
import { and, count, eq, gte, like, lt, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { agentDailySummaries, callLogs, customers, users } from '@/db/schema';

export interface DailySummaryMetricRow {
	userId: number;
	totalCalls: number;
	connectedCalls: number;
	totalDuration: number;
}

export interface AgentDailyRow {
	userId: number;
	username: string;
	realName: string;
	role: number;
	totalCalls: number;
	connectedCalls: number;
	totalDuration: number;
	firstCallTime: string | null;
	lastCallTime: string | null;
}

export interface AgentDailyFilters {
	date: string;
	userId?: number;
	usernameLike?: string;
	realNameLike?: string;
}

export async function findDailySummaryMetrics(db: Db, date: string): Promise<DailySummaryMetricRow[]> {
	return db
		.select({
			userId: agentDailySummaries.userId,
			totalCalls: agentDailySummaries.totalCalls,
			connectedCalls: agentDailySummaries.connectedCalls,
			totalDuration: agentDailySummaries.totalDuration,
		})
		.from(agentDailySummaries)
		.where(eq(agentDailySummaries.date, date));
}

// First version: intentCustomers is cumulative customers.type=1, not daily newly-created intent customers.
export async function countIntentCustomers(db: Db): Promise<number> {
	const rows = await db
		.select({ total: count() })
		.from(customers)
		.where(and(eq(customers.type, 1), eq(customers.isDeleted, 0)));

	return rows[0]?.total ?? 0;
}

export async function countDistinctCalledCustomers(db: Db, startTime: string, endTime: string): Promise<number> {
	const rows = await db
		.select({
			total: sql<number>`count(distinct ${callLogs.customerId})`,
		})
		.from(callLogs)
		.where(and(gte(callLogs.callTime, startTime), lt(callLogs.callTime, endTime)));

	return Number(rows[0]?.total ?? 0);
}

export async function findAgentDailyRows(db: Db, filters: AgentDailyFilters): Promise<AgentDailyRow[]> {
	const conditions: SQL[] = [eq(agentDailySummaries.date, filters.date)];

	if (filters.userId !== undefined) {
		conditions.push(eq(agentDailySummaries.userId, filters.userId));
	}

	if (filters.usernameLike) {
		conditions.push(like(users.username, `%${escapeLikeValue(filters.usernameLike)}%`));
	}

	if (filters.realNameLike) {
		conditions.push(like(users.realName, `%${escapeLikeValue(filters.realNameLike)}%`));
	}

	// Keep historical summary rows even if the linked user is now disabled.
	return db
		.select({
			userId: agentDailySummaries.userId,
			username: users.username,
			realName: users.realName,
			role: users.role,
			totalCalls: agentDailySummaries.totalCalls,
			connectedCalls: agentDailySummaries.connectedCalls,
			totalDuration: agentDailySummaries.totalDuration,
			firstCallTime: agentDailySummaries.firstCallTime,
			lastCallTime: agentDailySummaries.lastCallTime,
		})
		.from(agentDailySummaries)
		.innerJoin(users, eq(agentDailySummaries.userId, users.id))
		.where(and(...conditions));
}

function escapeLikeValue(value: string): string {
	return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
