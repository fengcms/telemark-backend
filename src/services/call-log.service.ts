import type { Db } from '@/db';
import { type CallLogRow, type CallLogSortField, findCallLogs } from '@/repositories/call-log.repository';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_SORT = '-id';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SORT_FIELDS = ['id', 'customerId', 'userId', 'duration', 'callResult', 'createdAt'] as const;

export class CallLogQueryError extends Error {
	readonly status = 400;
}

export interface CallLogItem {
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
	startedAt: null;
	endedAt: null;
	createdAt: string;
}

export interface CallLogListResult {
	page: number;
	pageSize: number;
	total: number;
	list: CallLogItem[];
}

export async function listCallLogsService(db: Db, query: Record<string, string | string[] | undefined>): Promise<CallLogListResult> {
	const page = parsePage(query.page);
	const pageSize = parsePageSize(query.pagesize);
	const sort = parseSort(query.sort);
	const result = await findCallLogs(db, {
		page,
		pageSize,
		sortField: sort.field,
		sortDirection: sort.direction,
		userId: parseOptionalPositiveInteger(query.userId, 'userId'),
		customerId: parseOptionalPositiveInteger(query.customerId, 'customerId'),
		callResult: parseOptionalCallResult(query.callResult),
		startDate: parseOptionalDate(query.startDate, 'startDate'),
		endDate: parseOptionalDate(query.endDate, 'endDate'),
	});

	return {
		page,
		pageSize,
		total: result.total,
		list: result.list.map(toCallLogItem),
	};
}

function toCallLogItem(row: CallLogRow): CallLogItem {
	return {
		id: row.id,
		customerId: row.customerId,
		customerName: row.customerName,
		customerPhone: row.customerPhone,
		userId: row.userId,
		username: row.username,
		userRealName: row.userRealName,
		duration: row.duration,
		callResult: row.callResult,
		callRemark: row.callRemark,
		startedAt: null,
		endedAt: null,
		createdAt: row.createdAt,
	};
}

function parseOptionalCallResult(value: string | string[] | undefined): number | undefined {
	const rawValue = getFirstQueryValue(value).trim();

	if (!rawValue) {
		return undefined;
	}

	const parsed = Number(rawValue);

	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 4) {
		throw new CallLogQueryError('callResult 参数不合法');
	}

	return parsed;
}

function parseSort(value: string | string[] | undefined): { field: CallLogSortField; direction: 'asc' | 'desc' } {
	const rawSort = getFirstQueryValue(value).trim() || DEFAULT_SORT;
	const direction = rawSort.startsWith('-') ? 'desc' : 'asc';
	const field = rawSort.startsWith('-') ? rawSort.slice(1) : rawSort;

	if (!SORT_FIELDS.includes(field as CallLogSortField)) {
		throw new CallLogQueryError('sort 字段不支持');
	}

	return {
		field: field as CallLogSortField,
		direction,
	};
}

function parsePage(value: string | string[] | undefined): number {
	const parsed = Number.parseInt(getFirstQueryValue(value), 10);

	return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parsePageSize(value: string | string[] | undefined): number {
	const parsed = Number.parseInt(getFirstQueryValue(value), 10);

	if (!Number.isInteger(parsed) || parsed <= 0) {
		return DEFAULT_PAGE_SIZE;
	}

	return Math.min(parsed, MAX_PAGE_SIZE);
}

function parseOptionalPositiveInteger(value: string | string[] | undefined, fieldName: string): number | undefined {
	const rawValue = getFirstQueryValue(value).trim();

	if (!rawValue) {
		return undefined;
	}

	const parsed = Number(rawValue);

	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new CallLogQueryError(`${fieldName} 参数不合法`);
	}

	return parsed;
}

function parseOptionalDate(value: string | string[] | undefined, fieldName: string): string | undefined {
	const rawValue = getFirstQueryValue(value).trim();

	if (!rawValue) {
		return undefined;
	}

	if (!isValidDate(rawValue)) {
		throw new CallLogQueryError(`${fieldName} 日期格式错误，请使用 YYYY-MM-DD`);
	}

	return rawValue;
}

function isValidDate(value: string): boolean {
	if (!DATE_PATTERN.test(value)) {
		return false;
	}

	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));

	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function getFirstQueryValue(value: string | string[] | undefined): string {
	if (Array.isArray(value)) {
		return value[0] ?? '';
	}

	return value ?? '';
}
