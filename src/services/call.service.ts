import type { Db } from '@/db';
import { findCustomerForCall, findDailySummaryByUserAndDate, writeCallReportBatch } from '@/repositories/call.repository';

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
}

export type ReportCallResult =
	| {
			ok: true;
			customerId: number;
			userId: number;
			date: string;
	  }
	| {
			ok: false;
			status: 403 | 404;
			message: string;
	  };

export async function reportCallService(db: Db, input: ReportCallInput): Promise<ReportCallResult> {
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

	const callTime = new Date();
	const now = callTime.toISOString();
	const date = formatBusinessDate(callTime);

	await writeCallReportBatch(db, {
		customerId: input.customerId,
		userId: input.userId,
		duration: input.duration,
		callResult: input.callResult,
		callRemark: normalizeNullableString(input.callRemark),
		now,
		date,
	});

	return {
		ok: true,
		customerId: input.customerId,
		userId: input.userId,
		date,
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
