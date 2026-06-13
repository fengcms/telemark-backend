import type { Db } from '@/db';
import {
	findCallLogByClientRequestId,
	findCustomerForCall,
	findDailySummaryByUserAndDate,
	writeCallReportBatch,
} from '@/repositories/call.repository';

export interface CallActor {
	id: number;
	username: string;
	role: number;
}

export interface ReportCallInput {
	customerId: number;
	duration: number;
	callResult: number;
	callRemark: string;
	userId: number;
	clientRequestId?: string;
	startedAt?: string;
	endedAt?: string;
}

export type ReportCallResult =
	| {
			ok: true;
			customerId: number;
			userId: number;
			date: string;
			idempotent: boolean;
	  }
	| {
			ok: false;
			status: 403 | 404;
			message: string;
	  };

export async function reportCallService(db: Db, input: ReportCallInput): Promise<ReportCallResult> {
	if (input.clientRequestId) {
		const existingCallLog = await findCallLogByClientRequestId(db, {
			userId: input.userId,
			clientRequestId: input.clientRequestId,
		});

		if (existingCallLog) {
			return {
				ok: true,
				customerId: existingCallLog.customerId,
				userId: input.userId,
				date: formatBusinessDate(resolveExistingReportTime(existingCallLog)),
				idempotent: true,
			};
		}
	}

	const customer = await findCustomerForCall(db, input.customerId);

	if (!customer) {
		return {
			ok: false,
			status: 404,
			message: '客户线索不存在',
		};
	}

	if (customer.ownerId !== input.userId) {
		return {
			ok: false,
			status: 403,
			message: '无权上报该客户通话记录',
		};
	}

	const now = new Date().toISOString();
	const reportTime = input.endedAt ?? now;
	const date = formatBusinessDate(new Date(reportTime));

	try {
		await writeCallReportBatch(db, {
			customerId: input.customerId,
			userId: input.userId,
			duration: input.duration,
			callResult: input.callResult,
			callRemark: normalizeNullableString(input.callRemark),
			now,
			reportTime,
			date,
			clientRequestId: input.clientRequestId ?? null,
			startedAt: input.startedAt ?? null,
			endedAt: input.endedAt ?? null,
		});
	} catch (error) {
		if (input.clientRequestId && isUniqueClientRequestConflict(error)) {
			const existingCallLog = await findCallLogByClientRequestId(db, {
				userId: input.userId,
				clientRequestId: input.clientRequestId,
			});

			if (existingCallLog) {
				return {
					ok: true,
					customerId: existingCallLog.customerId,
					userId: input.userId,
					date: formatBusinessDate(resolveExistingReportTime(existingCallLog)),
					idempotent: true,
				};
			}
		}

		throw error;
	}

	return {
		ok: true,
		customerId: input.customerId,
		userId: input.userId,
		date,
		idempotent: false,
	};
}

export interface MySummaryInput {
	userId: number;
}

export interface MySummaryResult {
	totalCalls: number;
	connectedCalls: number;
	totalDuration: number;
	firstCallTime: string | null;
	lastCallTime: string | null;
}

export async function getMySummaryService(db: Db, input: MySummaryInput): Promise<MySummaryResult> {
	const today = formatBusinessDate(new Date());
	const row = await findDailySummaryByUserAndDate(db, input.userId, today);

	if (!row) {
		return {
			totalCalls: 0,
			connectedCalls: 0,
			totalDuration: 0,
			firstCallTime: null,
			lastCallTime: null,
		};
	}

	return {
		totalCalls: row.totalCalls,
		connectedCalls: row.connectedCalls,
		totalDuration: row.totalDuration,
		firstCallTime: row.firstCallTime,
		lastCallTime: row.lastCallTime,
	};
}

function normalizeNullableString(value: string): string | null {
	const normalized = value.trim();

	return normalized.length > 0 ? normalized : null;
}

function formatBusinessDate(date: Date): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(date);
}

function resolveExistingReportTime(row: { endedAt: string | null; callTime: string; createdAt: string }): Date {
	return new Date(row.endedAt ?? row.callTime ?? row.createdAt);
}

function isUniqueClientRequestConflict(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	const message = error.message.toLowerCase();

	return message.includes('unique') && message.includes('client_request_id');
}
