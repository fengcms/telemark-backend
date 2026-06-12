import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { customers } from '@/db/schema';
import {
	createBatch,
	findActiveUserById,
	findCustomerByPhone,
	findCustomersByIds,
	insertCustomer,
	updateCustomersOwnerWithLogs,
} from '@/repositories/customer.repository';
import { handleListQuery, type ListQueryResult } from '@/utils/query-builder';

const ASSIGNMENT_ACTION_ASSIGN = 1;
const ASSIGNMENT_ACTION_TRANSFER = 2;
const ASSIGNMENT_ACTION_RECLAIM = 3;

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

export async function listCustomersService(
	db: Db,
	query: Record<string, string | string[] | undefined>,
): Promise<ListQueryResult<CustomerListItem>> {
	return handleListQuery(customers, query, {
		db,
		allowedFields: CUSTOMER_LIST_ALLOWED_FIELDS,
		defaultSortField: 'id',
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
		forcedConditions: [eq(customers.ownerId, userId), eq(customers.status, 0)],
	});
}

export async function importBatchService(db: Db, input: ImportBatchInput): Promise<ImportBatchResult> {
	const batch = await createBatch(db, {
		name: input.name,
		source: input.source,
		cost: input.cost,
		totalCount: input.customers.length,
		creatorId: input.creatorId,
	});

	let importedCount = 0;
	let skippedDuplicateCount = 0;
	const seenPhones = new Set<string>();

	for (const customer of input.customers) {
		const phone = normalizePhone(customer.phone);

		if (!phone || seenPhones.has(phone)) {
			skippedDuplicateCount += 1;
			continue;
		}

		seenPhones.add(phone);

		const existing = await findCustomerByPhone(db, phone);

		if (existing) {
			skippedDuplicateCount += 1;
			continue;
		}

		await insertCustomer(db, {
			phone,
			name: normalizeNullableString(customer.name),
			company: normalizeNullableString(customer.company),
			batchId: batch.id,
		});
		importedCount += 1;
	}

	return {
		batchId: batch.id,
		importedCount,
		skippedDuplicateCount,
	};
}

export async function assignCustomersService(db: Db, input: AssignCustomersInput): Promise<AssignCustomersResult> {
	const uniqueCustomerIds = Array.from(new Set(input.customerIds));

	if (input.targetUserId !== null) {
		const targetUser = await findActiveUserById(db, input.targetUserId);

		if (!targetUser) {
			throw new Error('目标员工不存在');
		}
	}

	const currentCustomers = await findCustomersByIds(db, uniqueCustomerIds);

	if (currentCustomers.length === 0) {
		return {
			updatedCount: 0,
			loggedCount: 0,
		};
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

function resolveAssignmentAction(fromUserId: number | null, targetUserId: number | null): number {
	if (targetUserId === null) {
		return ASSIGNMENT_ACTION_RECLAIM;
	}

	return fromUserId === null ? ASSIGNMENT_ACTION_ASSIGN : ASSIGNMENT_ACTION_TRANSFER;
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
