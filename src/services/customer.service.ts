import { eq, isNotNull, isNull, type SQL } from 'drizzle-orm';
import type { Db } from '@/db';
import { customers } from '@/db/schema';
import {
	batchUpdateCustomersByIds,
	type CustomerBasicRow,
	type CustomerDetailRow,
	countCustomersByBatchId,
	createBatch,
	deleteBatchById,
	findActiveCustomersByIds,
	findActiveUserById,
	findCustomerBasicById,
	findCustomerDeleteStateById,
	findCustomerDetailById,
	findCustomersByIds,
	findMyCustomerHistory,
	type InsertCustomerInput,
	insertCustomersBatch,
	type MyCustomerHistorySortField,
	softDeleteCustomerById,
	updateCustomerById,
	updateCustomersOwnerWithLogs,
} from '@/repositories/customer.repository';
import { handleListQuery, type ListQueryResult } from '@/utils/query-builder';

const ASSIGNMENT_ACTION_ASSIGN = 1;
const ASSIGNMENT_ACTION_TRANSFER = 2;
const ASSIGNMENT_ACTION_RECLAIM = 3;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_MY_CUSTOMER_HISTORY_SORT = '-updatedAt';
const MY_CUSTOMER_HISTORY_SORT_FIELDS = ['id', 'status', 'type', 'createdAt', 'updatedAt'] as const;
export const MAX_IMPORT_CUSTOMERS = 1000;
export const MAX_ASSIGN_CUSTOMERS = 50;

export interface Actor {
	id: number;
	username: string;
	role: number;
}

export interface ImportCustomerInput {
	phone: string;
	name?: string;
	company?: string;
}

export interface ImportBatchInput {
	name: string;
	source: string;
	cost: number;
	customers: ImportCustomerInput[];
	inputCount: number;
	creatorId: number;
}

export interface ImportBatchResult {
	batchId: number;
	importedCount: number;
	skippedDuplicateCount: number;
}

export interface AssignCustomersInput {
	customerIds: number[];
	targetUserId: number | null;
	reason: string;
	assignerId: number;
}

export interface AssignCustomersResult {
	updatedCount: number;
	loggedCount: number;
}

export interface UpdateCustomerInput {
	name?: string | null;
	company?: string | null;
	type?: number;
	status?: number;
	remark?: string | null;
}

export interface BatchUpdateCustomersInput {
	customerIds: number[];
	patch: {
		type?: number;
		status?: number;
		remark?: string | null;
	};
}

export interface MyCustomerHistoryResult {
	page: number;
	pageSize: number;
	total: number;
	list: CustomerBasicRow[];
}

const CUSTOMER_LIST_ALLOWED_FIELDS = [
	'id',
	'phone',
	'name',
	'company',
	'type',
	'status',
	'remark',
	'ownerId',
	'batchId',
	'createdAt',
	'updatedAt',
] as const;

export type CustomerListItem = {
	[TKey in (typeof CUSTOMER_LIST_ALLOWED_FIELDS)[number]]: (typeof customers)[TKey] extends { _: { data: infer TData } } ? TData : unknown;
};

export class AssignCustomersError extends Error {
	readonly status: 400 | 404;

	constructor(status: 400 | 404, message: string) {
		super(message);
		this.status = status;
	}
}

export class ImportBatchError extends Error {
	readonly status = 400;
}

export class CustomerMutationError extends Error {
	readonly status: 400 | 404;

	constructor(status: 400 | 404, message: string) {
		super(message);
		this.status = status;
	}
}

export class CustomerHistoryQueryError extends Error {
	readonly status: 400;

	constructor(message: string) {
		super(message);
		this.status = 400;
	}
}

export async function listCustomersService(
	db: Db,
	query: Record<string, string | string[] | undefined>,
): Promise<ListQueryResult<CustomerListItem>> {
	const forcedConditions = resolveIsAssignedCondition(query.is_assigned);
	forcedConditions.push(eq(customers.isDeleted, 0));

	return handleListQuery(customers, query, {
		db,
		allowedFields: CUSTOMER_LIST_ALLOWED_FIELDS,
		defaultSortField: 'id',
		forcedConditions,
	});
}

export async function listMyCustomersService(
	db: Db,
	query: Record<string, string | string[] | undefined>,
	userId: number,
): Promise<ListQueryResult<CustomerListItem>> {
	return handleListQuery(customers, query, {
		db,
		allowedFields: CUSTOMER_LIST_ALLOWED_FIELDS,
		defaultSortField: 'id',
		forcedConditions: [eq(customers.ownerId, userId), eq(customers.status, 0), eq(customers.isDeleted, 0)],
	});
}

export async function listMyCustomerHistoryService(
	db: Db,
	query: Record<string, string | string[] | undefined>,
	userId: number,
): Promise<MyCustomerHistoryResult> {
	assertNoForbiddenPersonalHistoryParams(query);

	const page = parseStrictPage(query.page);
	const pageSize = parseStrictPageSize(query.pagesize);
	const sort = parseMyCustomerHistorySort(query.sort);
	const result = await findMyCustomerHistory(db, {
		userId,
		page,
		pageSize,
		sortField: sort.field,
		sortDirection: sort.direction,
		status: parseOptionalStatus(query.status),
		statusIn: parseOptionalStatusIn(query['status-in']),
		type: parseOptionalType(query.type),
		typeIn: parseOptionalTypeIn(query['type-in']),
		nameLike: parseOptionalLike(query['name-like']),
		phoneLike: parseOptionalLike(query['phone-like']),
		companyLike: parseOptionalLike(query['company-like']),
	});

	return {
		page,
		pageSize,
		total: result.total,
		list: result.list,
	};
}

export async function importBatchService(db: Db, input: ImportBatchInput): Promise<ImportBatchResult> {
	if (input.inputCount > MAX_IMPORT_CUSTOMERS) {
		throw new ImportBatchError(`单次最多导入 ${MAX_IMPORT_CUSTOMERS} 条客户线索`);
	}

	const uniqueCustomers = new Map<string, Omit<InsertCustomerInput, 'batchId'>>();

	for (const customer of input.customers) {
		const phone = normalizePhone(customer.phone);

		if (!phone || uniqueCustomers.has(phone)) {
			continue;
		}

		uniqueCustomers.set(phone, {
			phone,
			name: normalizeNullableString(customer.name),
			company: normalizeNullableString(customer.company),
		});
	}

	const batch = await createBatch(db, {
		name: input.name,
		source: input.source,
		cost: input.cost,
		totalCount: input.inputCount,
		creatorId: input.creatorId,
	});

	try {
		await insertCustomersBatch(
			db,
			Array.from(uniqueCustomers.values(), (customer) => ({ ...customer, batchId: batch.id })),
		);
	} catch (error) {
		await deleteBatchById(db, batch.id).catch(() => undefined);
		throw error;
	}

	const importedCount = await countCustomersByBatchId(db, batch.id);

	return {
		batchId: batch.id,
		importedCount,
		skippedDuplicateCount: input.inputCount - importedCount,
	};
}

export async function assignCustomersService(db: Db, input: AssignCustomersInput): Promise<AssignCustomersResult> {
	const uniqueCustomerIds = Array.from(new Set(input.customerIds));

	if (uniqueCustomerIds.length > MAX_ASSIGN_CUSTOMERS) {
		throw new AssignCustomersError(400, `单次最多分配 ${MAX_ASSIGN_CUSTOMERS} 条客户线索`);
	}

	if (input.targetUserId !== null) {
		const targetUser = await findActiveUserById(db, input.targetUserId);

		if (!targetUser) {
			throw new AssignCustomersError(404, '目标员工不存在');
		}

		if (targetUser.status !== 1) {
			throw new AssignCustomersError(400, '目标员工已被禁用');
		}

		if (targetUser.role !== 2 && targetUser.role !== 3) {
			throw new AssignCustomersError(400, '目标员工角色不允许分配客户');
		}
	}

	const currentCustomers = await findCustomersByIds(db, uniqueCustomerIds);

	if (currentCustomers.length === 0) {
		return {
			updatedCount: 0,
			loggedCount: 0,
		};
	}

	if (currentCustomers.some((customer) => customer.isDeleted === 1)) {
		throw new AssignCustomersError(400, '已作废客户不允许分配');
	}

	await updateCustomersOwnerWithLogs(
		db,
		currentCustomers.map((customer) => customer.id),
		input.targetUserId,
		currentCustomers.map((customer) => ({
			customerId: customer.id,
			fromUserId: customer.ownerId,
			toUserId: input.targetUserId,
			operatorId: input.assignerId,
			action: resolveAssignmentAction(customer.ownerId, input.targetUserId),
			remark: normalizeNullableString(input.reason),
		})),
	);

	return {
		updatedCount: currentCustomers.length,
		loggedCount: currentCustomers.length,
	};
}

export function parseCustomerId(value: string): number {
	const parsed = Number(value);

	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new CustomerMutationError(400, '客户 ID 不合法');
	}

	return parsed;
}

export async function getCustomerDetailService(db: Db, id: number): Promise<CustomerDetailRow> {
	const customer = await findCustomerDetailById(db, id);

	if (!customer) {
		throw new CustomerMutationError(404, '客户不存在');
	}

	return customer;
}

export async function updateCustomerService(db: Db, id: number, input: UpdateCustomerInput): Promise<CustomerBasicRow> {
	const existing = await findCustomerBasicById(db, id);

	if (!existing) {
		throw new CustomerMutationError(404, '客户不存在');
	}

	const updated = await updateCustomerById(db, id, {
		...input,
		updatedAt: new Date().toISOString(),
	});

	if (!updated) {
		throw new CustomerMutationError(404, '客户不存在');
	}

	return updated;
}

export async function deleteCustomerService(
	db: Db,
	input: { id: number; operatorId: number; reason?: string | null },
): Promise<{ ok: true; id: number }> {
	const existing = await findCustomerDeleteStateById(db, input.id);

	if (!existing) {
		throw new CustomerMutationError(404, '客户不存在');
	}

	if (existing.isDeleted === 1) {
		return { ok: true, id: input.id };
	}

	await softDeleteCustomerById(db, {
		id: input.id,
		deletedAt: new Date().toISOString(),
		deletedBy: input.operatorId,
		deleteReason: normalizeNullableString(input.reason ?? undefined),
	});

	return { ok: true, id: input.id };
}

export async function batchUpdateCustomersService(db: Db, input: BatchUpdateCustomersInput): Promise<{ updatedCount: number }> {
	const uniqueCustomerIds = Array.from(new Set(input.customerIds));

	if (uniqueCustomerIds.length === 0) {
		throw new CustomerMutationError(400, 'customerIds 不能为空');
	}

	if (uniqueCustomerIds.length > 500) {
		throw new CustomerMutationError(400, 'customerIds 最多支持 500 个');
	}

	const currentCustomers = await findActiveCustomersByIds(db, uniqueCustomerIds);

	if (currentCustomers.length !== uniqueCustomerIds.length) {
		throw new CustomerMutationError(400, 'customerIds 中存在不存在的客户');
	}

	if (currentCustomers.some((customer) => customer.isDeleted === 1)) {
		throw new CustomerMutationError(400, 'customerIds 中存在已作废客户');
	}

	const updatedCount = await batchUpdateCustomersByIds(db, uniqueCustomerIds, {
		...input.patch,
		updatedAt: new Date().toISOString(),
	});

	return { updatedCount };
}

function resolveAssignmentAction(fromUserId: number | null, targetUserId: number | null): number {
	if (targetUserId === null) {
		return ASSIGNMENT_ACTION_RECLAIM;
	}

	return fromUserId === null ? ASSIGNMENT_ACTION_ASSIGN : ASSIGNMENT_ACTION_TRANSFER;
}

function resolveIsAssignedCondition(isAssigned: string | string[] | undefined): SQL[] {
	const value = typeof isAssigned === 'string' ? isAssigned.trim() : '';

	if (value === '0') {
		return [isNull(customers.ownerId)];
	}

	if (value === '1') {
		return [isNotNull(customers.ownerId)];
	}

	return [];
}

function normalizePhone(phone: string): string | null {
	const normalized = phone.trim();

	return normalized.length > 0 ? normalized : null;
}

function normalizeNullableString(value: string | undefined): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const normalized = value.trim();

	return normalized.length > 0 ? normalized : null;
}

function assertNoForbiddenPersonalHistoryParams(query: Record<string, string | string[] | undefined>): void {
	for (const key of ['ownerId', 'owner_id', 'userId']) {
		if (query[key] !== undefined) {
			throw new CustomerHistoryQueryError('不允许使用 ownerId/userId 查询个人历史客户');
		}
	}
}

function parseStrictPage(value: string | string[] | undefined): number {
	const rawValue = getFirstQueryValue(value).trim();

	if (!rawValue) {
		return 0;
	}

	const parsed = Number(rawValue);

	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new CustomerHistoryQueryError('page 参数不合法');
	}

	return parsed;
}

function parseStrictPageSize(value: string | string[] | undefined): number {
	const rawValue = getFirstQueryValue(value).trim();

	if (!rawValue) {
		return DEFAULT_PAGE_SIZE;
	}

	const parsed = Number(rawValue);

	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new CustomerHistoryQueryError('pagesize 参数不合法');
	}

	return Math.min(parsed, MAX_PAGE_SIZE);
}

function parseMyCustomerHistorySort(value: string | string[] | undefined): {
	field: MyCustomerHistorySortField;
	direction: 'asc' | 'desc';
} {
	const rawSort = getFirstQueryValue(value).trim() || DEFAULT_MY_CUSTOMER_HISTORY_SORT;
	const direction = rawSort.startsWith('-') ? 'desc' : 'asc';
	const field = rawSort.startsWith('-') ? rawSort.slice(1) : rawSort;

	if (!MY_CUSTOMER_HISTORY_SORT_FIELDS.includes(field as MyCustomerHistorySortField)) {
		throw new CustomerHistoryQueryError('sort 字段不支持');
	}

	return {
		field: field as MyCustomerHistorySortField,
		direction,
	};
}

function parseOptionalStatus(value: string | string[] | undefined): number | undefined {
	const rawValue = getFirstQueryValue(value).trim();

	if (!rawValue) {
		return undefined;
	}

	const parsed = Number(rawValue);

	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
		throw new CustomerHistoryQueryError('status 参数不合法');
	}

	return parsed;
}

function parseOptionalStatusIn(value: string | string[] | undefined): number[] | undefined {
	const values = parseIntegerList(value);

	if (!values) {
		return undefined;
	}

	if (values.some((item) => item < 1 || item > 4)) {
		throw new CustomerHistoryQueryError('status-in 参数不合法');
	}

	return values;
}

function parseOptionalType(value: string | string[] | undefined): number | undefined {
	const rawValue = getFirstQueryValue(value).trim();

	if (!rawValue) {
		return undefined;
	}

	const parsed = Number(rawValue);

	if (!isValidCustomerType(parsed)) {
		throw new CustomerHistoryQueryError('type 参数不合法');
	}

	return parsed;
}

function parseOptionalTypeIn(value: string | string[] | undefined): number[] | undefined {
	const values = parseIntegerList(value);

	if (!values) {
		return undefined;
	}

	if (values.some((item) => !isValidCustomerType(item))) {
		throw new CustomerHistoryQueryError('type-in 参数不合法');
	}

	return values;
}

function isValidCustomerType(value: number): boolean {
	return value === -1 || value === 0 || value === 1 || value === 2;
}

function parseIntegerList(value: string | string[] | undefined): number[] | undefined {
	const rawValue = getFirstQueryValue(value).trim();

	if (!rawValue) {
		return undefined;
	}

	const values = rawValue.split(',').map((item) => {
		const normalized = item.trim();
		const parsed = Number(normalized);

		if (!normalized || !Number.isInteger(parsed)) {
			throw new CustomerHistoryQueryError('in 参数不合法');
		}

		return parsed;
	});

	return values.length > 0 ? values : undefined;
}

function parseOptionalLike(value: string | string[] | undefined): string | undefined {
	const normalized = getFirstQueryValue(value).trim();

	return normalized.length > 0 ? normalized : undefined;
}

function getFirstQueryValue(value: string | string[] | undefined): string {
	if (Array.isArray(value)) {
		return value[0] ?? '';
	}

	return value ?? '';
}
