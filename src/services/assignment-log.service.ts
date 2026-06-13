import type { Db } from '@/db';
import { type AssignmentLogRow, type AssignmentLogSortField, findAssignmentLogs } from '@/repositories/assignment-log.repository';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_SORT = '-id';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SORT_FIELDS = ['id', 'customerId', 'fromUserId', 'toUserId', 'operatorId', 'action', 'createdAt'] as const;

export class AssignmentLogQueryError extends Error {
	readonly status = 400;
}

export interface AssignmentLogItem {
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
	action: 'assign' | 'reassign' | 'recycle' | 'unknown';
	reason: string | null;
	createdAt: string;
}

export interface AssignmentLogListResult {
	page: number;
	pageSize: number;
	total: number;
	list: AssignmentLogItem[];
}

export async function listAssignmentLogsService(
	db: Db,
	query: Record<string, string | string[] | undefined>,
): Promise<AssignmentLogListResult> {
	const page = parsePage(query.page);
	const pageSize = parsePageSize(query.pagesize);
	const sort = parseSort(query.sort);
	const result = await findAssignmentLogs(db, {
		page,
		pageSize,
		sortField: sort.field,
		sortDirection: sort.direction,
		customerId: parseOptionalPositiveInteger(query.customerId, 'customerId'),
		operatorId: parseOptionalPositiveInteger(query.operatorId, 'operatorId'),
		fromUserId: parseOptionalNullablePositiveInteger(query.fromUserId, 'fromUserId'),
		toUserId: parseOptionalNullablePositiveInteger(query.toUserId, 'toUserId'),
		action: parseOptionalAction(query.action),
		startDate: parseOptionalDate(query.startDate, 'startDate'),
		endDate: parseOptionalDate(query.endDate, 'endDate'),
	});

	return {
		page,
		pageSize,
		total: result.total,
		list: result.list.map(toAssignmentLogItem),
	};
}

function toAssignmentLogItem(row: AssignmentLogRow): AssignmentLogItem {
	return {
		id: row.id,
		customerId: row.customerId,
		customerPhone: row.customerPhone,
		customerName: row.customerName,
		fromUserId: row.fromUserId,
		fromUserName: row.fromUserName,
		toUserId: row.toUserId,
		toUserName: row.toUserName,
		operatorId: row.operatorId,
		operatorName: row.operatorName,
		action: formatAssignmentAction(row.action),
		reason: row.reason,
		createdAt: row.createdAt,
	};
}

function formatAssignmentAction(action: number): AssignmentLogItem['action'] {
	if (action === 1) {
		return 'assign';
	}

	if (action === 2) {
		return 'reassign';
	}

	if (action === 3) {
		return 'recycle';
	}

	return 'unknown';
}

function parseOptionalAction(value: string | string[] | undefined): number | undefined {
	const rawValue = getFirstQueryValue(value).trim();

	if (!rawValue) {
		return undefined;
	}

	const actionMap: Record<string, number> = {
		assign: 1,
		reassign: 2,
		recycle: 3,
		'1': 1,
		'2': 2,
		'3': 3,
	};
	const action = actionMap[rawValue];

	if (!action) {
		throw new AssignmentLogQueryError('action 参数不合法');
	}

	return action;
}

function parseSort(value: string | string[] | undefined): { field: AssignmentLogSortField; direction: 'asc' | 'desc' } {
	const rawSort = getFirstQueryValue(value).trim() || DEFAULT_SORT;
	const direction = rawSort.startsWith('-') ? 'desc' : 'asc';
	const field = rawSort.startsWith('-') ? rawSort.slice(1) : rawSort;

	if (!SORT_FIELDS.includes(field as AssignmentLogSortField)) {
		throw new AssignmentLogQueryError('sort 字段不支持');
	}

	return {
		field: field as AssignmentLogSortField,
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
		throw new AssignmentLogQueryError(`${fieldName} 参数不合法`);
	}

	return parsed;
}

function parseOptionalNullablePositiveInteger(value: string | string[] | undefined, fieldName: string): number | null | undefined {
	const rawValue = getFirstQueryValue(value).trim();

	if (!rawValue) {
		return undefined;
	}

	if (rawValue === 'null') {
		return null;
	}

	return parseOptionalPositiveInteger(rawValue, fieldName);
}

function parseOptionalDate(value: string | string[] | undefined, fieldName: string): string | undefined {
	const rawValue = getFirstQueryValue(value).trim();

	if (!rawValue) {
		return undefined;
	}

	if (!isValidDate(rawValue)) {
		throw new AssignmentLogQueryError(`${fieldName} 日期格式错误，请使用 YYYY-MM-DD`);
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
