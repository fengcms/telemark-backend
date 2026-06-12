import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { agentDailySummaries, callLogs, customers } from '@/db/schema';

export interface ReportCallWriteInput {
	customerId: number;
	userId: number;
	duration: number;
	callResult: number;
	callRemark: string | null;
	now: string;
	date: string;
}

export async function findCustomerForCall(db: Db, customerId: number): Promise<{ id: number } | undefined> {
	return db.query.customers.findFirst({
		where: eq(customers.id, customerId),
		columns: { id: true },
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
			callTime: input.now,
			duration: input.duration,
			callResult: input.callResult,
			callRemark: input.callRemark,
		}),
		db
			.update(customers)
			.set({
				status: input.callResult,
				remark: input.callRemark,
				type: input.callResult === 1 ? 1 : undefined,
				updatedAt: input.now,
			})
			.where(eq(customers.id, input.customerId)),
		db
			.insert(agentDailySummaries)
			.values({
				userId: input.userId,
				date: input.date,
				firstCallTime: input.now,
				lastCallTime: input.now,
				totalCalls: 1,
				connectedCalls: connectedIncrement,
				totalDuration: durationIncrement,
				createdAt: input.now,
				updatedAt: input.now,
			})
			.onConflictDoUpdate({
				target: [agentDailySummaries.userId, agentDailySummaries.date],
				set: {
					lastCallTime: input.now,
					totalCalls: sql`${agentDailySummaries.totalCalls} + 1`,
					connectedCalls: sql`${agentDailySummaries.connectedCalls} + ${connectedIncrement}`,
					totalDuration: sql`${agentDailySummaries.totalDuration} + ${durationIncrement}`,
					updatedAt: input.now,
				},
			}),
	]);
}
