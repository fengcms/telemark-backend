import type { Db } from '@/db';
import { type BatchListRow, type BatchSortField, findBatchById, findBatches, getBatchCustomerStats } from '@/repositories/batch.repository';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_BATCH_SORT = '-id';
const SORT_FIELDS = ['id', 'name', 'source', 'cost', 'creatorId', 'createdAt', 'updatedAt'] as const;

export class BatchQueryError extends Error {
	readonly status: 400 | 404;

	constructor(status: 400 | 404, message: string) {
		super(message);
		this.status = status;
	}
}

export interface BatchListItem {
	id: number;
	name: string;
	source: string | null;
	cost: number;
	creatorId: number;
	creatorName: string;
	createdAt: string;
	updatedAt: string;
}

export interface BatchListResult {
	page: number;
	pageSize: number;
	total: number;
	list: BatchListItem[];
}

export interface BatchSummary {
	batchId: number;
	name: string;
	source: string | null;
	cost: number;
	totalCustomers: number;
	assignedCustomers: number;
	unassignedCustomers: number;
	calledCustomers: number;
	uncalledCustomers: number;
	connectedCustomers: number;
	intentCustomers: number;
	invalidCustomers: number;
	connectRate: number;
	intentRate: number;
	costPerIntent: number;
}

export async function listBatchesService(db: Db, query: Record<string, string | string[] | undefined>): Promise<BatchListResult> {
	const page = parsePage(query.page);
	const pageSize = parsePageSize(query.pagesize);
	const sort = parseBatchSort(query.sort);
	const result = await findBatches(db, {
		page,
		pageSize,
		sortField: sort.field,
		sortDirection: sort.direction,
		nameLike: parseOptionalLike(query['name-like']),
		sourceLike: parseOptionalLike(query['source-like']),
		creatorId: parseOptionalPositiveInteger(query.creatorId, 'creatorId'),
	});

	return {
		page,
		pageSize,
		total: result.total,
		list: result.list.map(toBatchListItem),
	};
}

export async function getBatchSummaryService(db: Db, id: number): Promise<BatchSummary> {
	const batch = await findBatchById(db, id);

	if (!batch) {
		throw new BatchQueryError(404, '批次不存在');
	}

	const stats = await getBatchCustomerStats(db, id);

	return {
		batchId: batch.id,
		name: batch.name,
		source: batch.source,
		cost: batch.cost,
		...stats,
		connectRate: ratio(stats.connectedCustomers, stats.calledCustomers),
		intentRate: ratio(stats.intentCustomers, stats.calledCustomers),
		costPerIntent: stats.intentCustomers > 0 ? roundTo(batch.cost / stats.intentCustomers, 2) : 0,
	};
}

export function parseBatchId(value: string): number {
	const parsed = Number(value);

	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new BatchQueryError(400, '批次 ID 不合法');
	}

	return parsed;
}

function toBatchListItem(row: BatchListRow): BatchListItem {
	return {
		id: row.id,
		name: row.name,
		source: row.source,
		cost: row.cost,
		creatorId: row.creatorId,
		creatorName: row.creatorName,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function parseBatchSort(value: string | string[] | undefined): { field: BatchSortField; direction: 'asc' | 'desc' } {
	const rawSort = getFirstQueryValue(value).trim() || DEFAULT_BATCH_SORT;
	const direction = rawSort.startsWith('-') ? 'desc' : 'asc';
	const field = rawSort.startsWith('-') ? rawSort.slice(1) : rawSort;

	if (!SORT_FIELDS.includes(field as BatchSortField)) {
		throw new BatchQueryError(400, 'sort 字段不支持');
	}

	return {
		field: field as BatchSortField,
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
		throw new BatchQueryError(400, `${fieldName} 参数不合法`);
	}

	return parsed;
}

function parseOptionalLike(value: string | string[] | undefined): string | undefined {
	const normalized = getFirstQueryValue(value).trim();

	return normalized.length > 0 ? normalized : undefined;
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
