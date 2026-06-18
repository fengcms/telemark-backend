import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { agentDailySummaries, callLogs, customers } from '@/db/schema';

export interface ReportCallWriteInput {
	customerId: number;
	userId: number;
	duration: number;
	callResult: number;
	callRemark: string | null;
	now: string;
	reportTime: string;
	date: string;
	clientRequestId: string | null;
	startedAt: string | null;
	endedAt: string | null;
}

export interface ExistingCallReportRow {
	customerId: number;
	userId: number;
	callTime: string;
	endedAt: string | null;
	createdAt: string;
}

export async function findCustomerForCall(db: Db, customerId: number): Promise<{ id: number; ownerId: number | null } | undefined> {
	return db.query.customers.findFirst({
		where: and(eq(customers.id, customerId), eq(customers.isDeleted, 0)),
		columns: { id: true, ownerId: true },
	});
}

export async function findCallLogByClientRequestId(
	db: Db,
	input: { userId: number; clientRequestId: string },
): Promise<ExistingCallReportRow | undefined> {
	return db.query.callLogs.findFirst({
		where: and(eq(callLogs.userId, input.userId), eq(callLogs.clientRequestId, input.clientRequestId)),
		columns: {
			customerId: true,
			userId: true,
			callTime: true,
			endedAt: true,
			createdAt: true,
		},
	});
}

export interface DailySummaryRow {
	totalCalls: number;
	connectedCalls: number;
	totalDuration: number;
	firstCallTime: string | null;
	lastCallTime: string | null;
}

export async function findDailySummaryByUserAndDate(db: Db, userId: number, date: string): Promise<DailySummaryRow | undefined> {
	return db.query.agentDailySummaries.findFirst({
		where: and(eq(agentDailySummaries.userId, userId), eq(agentDailySummaries.date, date)),
		columns: {
			totalCalls: true,
			connectedCalls: true,
			totalDuration: true,
			firstCallTime: true,
			lastCallTime: true,
		},
	});
}

export async function writeCallReportBatch(db: Db, input: ReportCallWriteInput): Promise<void> {
	const isConnected = input.duration > 0 && input.callResult === 1;
	const connectedIncrement = isConnected ? 1 : 0;
	const durationIncrement = isConnected ? input.duration : 0;

	await db.batch([
		db.insert(callLogs).values({
			customerId: input.customerId,
			userId: input.userId,
			callTime: input.reportTime,
			duration: input.duration,
			callResult: input.callResult,
			callRemark: input.callRemark,
			clientRequestId: input.clientRequestId,
			startedAt: input.startedAt,
			endedAt: input.endedAt,
			createdAt: input.now,
		}),
		db
			.update(customers)
			.set({
				status: input.callResult,
				remark: input.callResult === 1 ? input.callRemark : undefined,
				type: input.callResult === 1 ? 1 : undefined,
				updatedAt: input.now,
			})
			.where(eq(customers.id, input.customerId)),
		db
			.insert(agentDailySummaries)
			.values({
				userId: input.userId,
				date: input.date,
				firstCallTime: input.reportTime,
				lastCallTime: input.reportTime,
				totalCalls: 1,
				connectedCalls: connectedIncrement,
				totalDuration: durationIncrement,
				createdAt: input.now,
				updatedAt: input.now,
			})
			.onConflictDoUpdate({
				target: [agentDailySummaries.userId, agentDailySummaries.date],
				set: {
					firstCallTime: sql`case when ${agentDailySummaries.firstCallTime} is null or ${agentDailySummaries.firstCallTime} > ${input.reportTime} then ${input.reportTime} else ${agentDailySummaries.firstCallTime} end`,
					lastCallTime: sql`case when ${agentDailySummaries.lastCallTime} is null or ${agentDailySummaries.lastCallTime} < ${input.reportTime} then ${input.reportTime} else ${agentDailySummaries.lastCallTime} end`,
					totalCalls: sql`${agentDailySummaries.totalCalls} + 1`,
					connectedCalls: sql`${agentDailySummaries.connectedCalls} + ${connectedIncrement}`,
					totalDuration: sql`${agentDailySummaries.totalDuration} + ${durationIncrement}`,
					updatedAt: input.now,
				},
			}),
	]);
}
