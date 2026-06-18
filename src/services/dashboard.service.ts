import type { Db } from '@/db';
import {
	type AgentDailyRow,
	type AgentMonthlyCalledCustomerRow,
	type AgentMonthlySummaryRow,
	countDistinctCalledCustomers,
	countIntentCustomers,
	findAgentDailyRows,
	findAgentMonthlyCalledCustomerRows,
	findAgentMonthlySummaryRows,
	findDailySummaryMetrics,
} from '@/repositories/dashboard.repository';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_AGENT_DAILY_SORT = '-totalCalls';
const SORT_FIELDS = [
	'userId',
	'totalCalls',
	'connectedCalls',
	'totalDuration',
	'avgDuration',
	'connectRate',
	'firstCallTime',
	'lastCallTime',
] as const;
const MONTHLY_SORT_FIELDS = [
	'userId',
	'totalCalls',
	'calledCustomers',
	'connectedCalls',
	'connectedCustomers',
	'totalDuration',
	'avgDuration',
	'connectRate',
	'customerConnectRate',
	'firstCallTime',
	'lastCallTime',
] as const;

type SortField = (typeof SORT_FIELDS)[number];
type MonthlySortField = (typeof MONTHLY_SORT_FIELDS)[number];

export class DashboardQueryError extends Error {
	readonly status = 400;
}

export interface DashboardOverview {
	date: string;
	totalCalls: number;
	connectedCalls: number;
	totalDuration: number;
	avgDuration: number;
	connectRate: number;
	activeAgents: number;
	intentCustomers: number;
	newCalledCustomers: number;
}

export interface AgentDailyItem {
	userId: number;
	username: string;
	realName: string;
	role: number;
	totalCalls: number;
	connectedCalls: number;
	totalDuration: number;
	avgDuration: number;
	connectRate: number;
	firstCallTime: string | null;
	lastCallTime: string | null;
}

export interface AgentDailyList {
	page: number;
	pageSize: number;
	total: number;
	list: AgentDailyItem[];
}

export interface AgentMonthlyItem {
	userId: number;
	username: string;
	realName: string;
	role: number;
	totalCalls: number;
	calledCustomers: number;
	connectedCalls: number;
	connectedCustomers: number;
	totalDuration: number;
	avgDuration: number;
	connectRate: number;
	customerConnectRate: number;
	firstCallTime: string | null;
	lastCallTime: string | null;
}

export interface AgentMonthlyList {
	month: string;
	page: number;
	pageSize: number;
	total: number;
	list: AgentMonthlyItem[];
}

export async function getDashboardOverviewService(
	db: Db,
	query: Record<string, string | string[] | undefined>,
): Promise<DashboardOverview> {
	const date = parseDateParam(query.date);
	const summaries = await findDailySummaryMetrics(db, date);

	if (summaries.length === 0) {
		return {
			date,
			totalCalls: 0,
			connectedCalls: 0,
			totalDuration: 0,
			avgDuration: 0,
			connectRate: 0,
			activeAgents: 0,
			intentCustomers: 0,
			newCalledCustomers: 0,
		};
	}

	const totalCalls = summaries.reduce((sum, row) => sum + row.totalCalls, 0);
	const connectedCalls = summaries.reduce((sum, row) => sum + row.connectedCalls, 0);
	const totalDuration = summaries.reduce((sum, row) => sum + row.totalDuration, 0);
	const activeAgents = new Set(summaries.filter((row) => row.totalCalls > 0).map((row) => row.userId)).size;
	const [intentCustomers, newCalledCustomers] = await Promise.all([
		countIntentCustomers(db),
		countDistinctCalledCustomers(db, getShanghaiDayStartIso(date), getNextShanghaiDayStartIso(date)),
	]);

	return {
		date,
		totalCalls,
		connectedCalls,
		totalDuration,
		avgDuration: averageDuration(totalDuration, connectedCalls),
		connectRate: ratio(connectedCalls, totalCalls),
		activeAgents,
		intentCustomers,
		newCalledCustomers,
	};
}

export async function getAgentDailyService(db: Db, query: Record<string, string | string[] | undefined>): Promise<AgentDailyList> {
	const date = parseDateParam(query.date);
	const page = parsePage(query.page);
	const pageSize = parsePageSize(query.pagesize);
	const sort = parseAgentDailySort(query.sort);
	const rows = await findAgentDailyRows(db, {
		date,
		userId: parseOptionalPositiveInteger(query.userId, 'userId'),
		usernameLike: parseOptionalLike(query['username-like']),
		realNameLike: parseOptionalLike(query['realName-like']),
	});
	const list = rows.map(toAgentDailyItem).sort((left, right) => compareAgentDailyItems(left, right, sort));
	const offset = page * pageSize;

	return {
		page,
		pageSize,
		total: list.length,
		list: list.slice(offset, offset + pageSize),
	};
}

export async function getAgentMonthlyService(
	db: Db,
	query: Record<string, string | string[] | undefined>,
	actor: { id: number; role: number },
): Promise<AgentMonthlyList> {
	const month = parseMonthParam(query.month);
	const page = parsePage(query.page);
	const pageSize = parsePageSize(query.pagesize);
	const sort = parseAgentMonthlySort(query.sort);
	const [startDate, endDate] = getMonthDateRange(month);
	const requestedUserId = parseOptionalPositiveInteger(query.userId, 'userId');
	const rows = await findAgentMonthlySummaryRows(db, {
		date: startDate,
		startDate,
		endDate,
		userId: actor.role === 3 ? actor.id : requestedUserId,
		usernameLike: parseOptionalLike(query['username-like']),
		realNameLike: parseOptionalLike(query['realName-like']),
	});
	const calledCustomerRows = await findAgentMonthlyCalledCustomerRows(db, {
		startTime: getShanghaiDayStartIso(startDate),
		endTime: getShanghaiDayStartIso(endDate),
		userIds: rows.map((row) => row.userId),
	});
	const calledCustomerMap = new Map(calledCustomerRows.map((row) => [row.userId, row]));
	const list = rows
		.map((row) => toAgentMonthlyItem(row, calledCustomerMap.get(row.userId)))
		.sort((left, right) => compareMonthlyItems(left, right, sort));
	const offset = page * pageSize;

	return {
		month,
		page,
		pageSize,
		total: list.length,
		list: list.slice(offset, offset + pageSize),
	};
}

function toAgentDailyItem(row: AgentDailyRow): AgentDailyItem {
	return {
		userId: row.userId,
		username: row.username,
		realName: row.realName,
		role: row.role,
		totalCalls: row.totalCalls,
		connectedCalls: row.connectedCalls,
		totalDuration: row.totalDuration,
		avgDuration: averageDuration(row.totalDuration, row.connectedCalls),
		connectRate: ratio(row.connectedCalls, row.totalCalls),
		firstCallTime: row.firstCallTime,
		lastCallTime: row.lastCallTime,
	};
}

function compareAgentDailyItems(
	left: AgentDailyItem,
	right: AgentDailyItem,
	sort: { field: SortField; direction: 'asc' | 'desc' },
): number {
	const leftValue = left[sort.field];
	const rightValue = right[sort.field];
	const direction = sort.direction === 'asc' ? 1 : -1;

	if (leftValue === rightValue) {
		return left.userId - right.userId;
	}

	if (leftValue === null) {
		return 1;
	}

	if (rightValue === null) {
		return -1;
	}

	return leftValue > rightValue ? direction : -direction;
}

function toAgentMonthlyItem(row: AgentMonthlySummaryRow, calledCustomerRow: AgentMonthlyCalledCustomerRow | undefined): AgentMonthlyItem {
	const totalCalls = Number(row.totalCalls ?? 0);
	const connectedCalls = Number(row.connectedCalls ?? 0);
	const totalDuration = Number(row.totalDuration ?? 0);
	const calledCustomers = Number(calledCustomerRow?.calledCustomers ?? 0);
	const connectedCustomers = Number(calledCustomerRow?.connectedCustomers ?? 0);

	return {
		userId: row.userId,
		username: row.username,
		realName: row.realName,
		role: row.role,
		totalCalls,
		calledCustomers,
		connectedCalls,
		connectedCustomers,
		totalDuration,
		avgDuration: averageDuration(totalDuration, connectedCalls),
		connectRate: ratio(connectedCalls, totalCalls),
		customerConnectRate: ratio(connectedCustomers, calledCustomers),
		firstCallTime: row.firstCallTime,
		lastCallTime: row.lastCallTime,
	};
}

function compareMonthlyItems(
	left: AgentMonthlyItem,
	right: AgentMonthlyItem,
	sort: { field: MonthlySortField; direction: 'asc' | 'desc' },
): number {
	const leftValue = left[sort.field];
	const rightValue = right[sort.field];
	const direction = sort.direction === 'asc' ? 1 : -1;

	if (leftValue === rightValue) {
		return left.userId - right.userId;
	}

	if (leftValue === null) {
		return 1;
	}

	if (rightValue === null) {
		return -1;
	}

	return leftValue > rightValue ? direction : -direction;
}

function parseMonthParam(value: string | string[] | undefined): string {
	const rawMonth = getFirstQueryValue(value);
	const month = rawMonth.trim().length > 0 ? rawMonth.trim() : formatBusinessMonth(new Date());

	if (!isValidMonth(month)) {
		throw new DashboardQueryError('month 格式错误，请使用 YYYY-MM');
	}

	return month;
}

function parseAgentMonthlySort(value: string | string[] | undefined): { field: MonthlySortField; direction: 'asc' | 'desc' } {
	const rawSort = getFirstQueryValue(value).trim() || '-totalCalls';
	const direction = rawSort.startsWith('-') ? 'desc' : 'asc';
	const field = rawSort.startsWith('-') ? rawSort.slice(1) : rawSort;

	if (!MONTHLY_SORT_FIELDS.includes(field as MonthlySortField)) {
		throw new DashboardQueryError('sort 字段不支持');
	}

	return {
		field: field as MonthlySortField,
		direction,
	};
}

function parseDateParam(value: string | string[] | undefined): string {
	const rawDate = getFirstQueryValue(value);
	const date = rawDate.trim().length > 0 ? rawDate.trim() : formatBusinessDate(new Date());

	if (!isValidDate(date)) {
		throw new DashboardQueryError('date 格式错误，请使用 YYYY-MM-DD');
	}

	return date;
}

function parseAgentDailySort(value: string | string[] | undefined): { field: SortField; direction: 'asc' | 'desc' } {
	const rawSort = getFirstQueryValue(value).trim() || DEFAULT_AGENT_DAILY_SORT;
	const direction = rawSort.startsWith('-') ? 'desc' : 'asc';
	const field = rawSort.startsWith('-') ? rawSort.slice(1) : rawSort;

	if (!SORT_FIELDS.includes(field as SortField)) {
		throw new DashboardQueryError('sort 字段不支持');
	}

	return {
		field: field as SortField,
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
		throw new DashboardQueryError(`${fieldName} 参数不合法`);
	}

	return parsed;
}

function parseOptionalLike(value: string | string[] | undefined): string | undefined {
	const normalized = getFirstQueryValue(value).trim();

	return normalized.length > 0 ? normalized : undefined;
}

function isValidDate(value: string): boolean {
	if (!DATE_PATTERN.test(value)) {
		return false;
	}

	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));

	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidMonth(value: string): boolean {
	if (!MONTH_PATTERN.test(value)) {
		return false;
	}

	const [year, month] = value.split('-').map(Number);

	return Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12;
}

function formatBusinessDate(date: Date): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(date);
}

function formatBusinessMonth(date: Date): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Shanghai',
		year: 'numeric',
		month: '2-digit',
	}).format(date);
}

function getMonthDateRange(month: string): [string, string] {
	const [year, monthNumber] = month.split('-').map(Number);
	const startDate = `${month}-01`;
	const nextMonthDate = new Date(Date.UTC(year, monthNumber, 1));
	const nextYear = nextMonthDate.getUTCFullYear();
	const nextMonth = String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0');

	return [startDate, `${nextYear}-${nextMonth}-01`];
}

function getShanghaiDayStartIso(date: string): string {
	return new Date(`${date}T00:00:00+08:00`).toISOString();
}

function getNextShanghaiDayStartIso(date: string): string {
	const start = new Date(`${date}T00:00:00+08:00`);
	start.setUTCDate(start.getUTCDate() + 1);

	return start.toISOString();
}

function averageDuration(totalDuration: number, connectedCalls: number): number {
	return connectedCalls > 0 ? roundTo(totalDuration / connectedCalls, 2) : 0;
}

function ratio(numerator: number, denominator: number): number {
	return denominator > 0 ? roundTo(numerator / denominator, 4) : 0;
}

function roundTo(value: number, digits: number): number {
	const factor = 10 ** digits;

	return Math.round(value * factor) / factor;
}

function getFirstQueryValue(value: string | string[] | undefined): string {
	if (Array.isArray(value)) {
		return value[0] ?? '';
	}

	return value ?? '';
}
