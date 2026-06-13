import { aliasedTable, and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/db';
import { assignmentLogs, batches, customers, users } from '@/db/schema';

export interface CreateBatchInput {
	name: string;
	source: string | null;
	cost: number;
	totalCount: number;
	creatorId: number;
}

export interface InsertCustomerInput {
	phone: string;
	name: string | null;
	company: string | null;
	batchId: number;
}

export interface AssignmentLogInput {
	customerId: number;
	fromUserId: number | null;
	toUserId: number | null;
	operatorId: number;
	action: number;
	remark: string | null;
}

export interface CustomerDetailRow {
	id: number;
	phone: string;
	name: string | null;
	company: string | null;
	type: number;
	status: number;
	remark: string | null;
	ownerId: number | null;
	ownerName: string | null;
	batchId: number | null;
	batchName: string | null;
	isDeleted: number;
	deletedAt: string | null;
	deletedBy: number | null;
	deleteReason: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CustomerBasicRow {
	id: number;
	phone: string;
	name: string | null;
	company: string | null;
	type: number;
	status: number;
	remark: string | null;
	ownerId: number | null;
	batchId: number | null;
	createdAt: string;
	updatedAt: string;
}

export interface UpdateCustomerInput {
	name?: string | null;
	company?: string | null;
	type?: number;
	status?: number;
	remark?: string | null;
	updatedAt: string;
}

export interface BatchUpdateCustomerInput {
	type?: number;
	status?: number;
	remark?: string | null;
	updatedAt: string;
}

export async function createBatch(db: Db, input: CreateBatchInput): Promise<{ id: number }> {
	const result = await db
		.insert(batches)
		.values({
			name: input.name,
			source: input.source,
			cost: input.cost,
			totalCount: input.totalCount,
			creatorId: input.creatorId,
		})
		.returning({ id: batches.id });

	const batch = result[0];

	if (!batch) {
		throw new Error('创建批次失败');
	}

	return batch;
}

export async function findCustomerByPhone(db: Db, phone: string): Promise<{ id: number } | undefined> {
	return db.query.customers.findFirst({
		where: eq(customers.phone, phone),
		columns: { id: true },
	});
}

export async function insertCustomer(db: Db, input: InsertCustomerInput): Promise<{ id: number }> {
	const result = await db
		.insert(customers)
		.values({
			phone: input.phone,
			name: input.name,
			company: input.company,
			batchId: input.batchId,
		})
		.returning({ id: customers.id });

	const customer = result[0];

	if (!customer) {
		throw new Error('创建客户线索失败');
	}

	return customer;
}

export async function findActiveUserById(db: Db, userId: number): Promise<{ id: number; role: number; status: number } | undefined> {
	return db.query.users.findFirst({
		where: eq(users.id, userId),
		columns: { id: true, role: true, status: true },
	});
}

export async function findCustomersByIds(
	db: Db,
	customerIds: number[],
): Promise<Array<{ id: number; ownerId: number | null; isDeleted: number }>> {
	if (customerIds.length === 0) {
		return [];
	}

	return db
		.select({
			id: customers.id,
			ownerId: customers.ownerId,
			isDeleted: customers.isDeleted,
		})
		.from(customers)
		.where(inArray(customers.id, customerIds));
}

export async function findActiveCustomersByIds(db: Db, customerIds: number[]): Promise<Array<{ id: number; isDeleted: number }>> {
	if (customerIds.length === 0) {
		return [];
	}

	return db
		.select({
			id: customers.id,
			isDeleted: customers.isDeleted,
		})
		.from(customers)
		.where(inArray(customers.id, customerIds));
}

export async function findCustomerDetailById(db: Db, id: number): Promise<CustomerDetailRow | undefined> {
	const owner = aliasedTable(users, 'owner');

	const rows = await db
		.select({
			id: customers.id,
			phone: customers.phone,
			name: customers.name,
			company: customers.company,
			type: customers.type,
			status: customers.status,
			remark: customers.remark,
			ownerId: customers.ownerId,
			ownerName: owner.realName,
			batchId: customers.batchId,
			batchName: batches.name,
			isDeleted: customers.isDeleted,
			deletedAt: customers.deletedAt,
			deletedBy: customers.deletedBy,
			deleteReason: customers.deleteReason,
			createdAt: customers.createdAt,
			updatedAt: customers.updatedAt,
		})
		.from(customers)
		.leftJoin(owner, eq(customers.ownerId, owner.id))
		.leftJoin(batches, eq(customers.batchId, batches.id))
		.where(and(eq(customers.id, id), eq(customers.isDeleted, 0)))
		.limit(1);

	return rows[0];
}

export async function findCustomerBasicById(db: Db, id: number): Promise<CustomerBasicRow | undefined> {
	return db.query.customers.findFirst({
		where: and(eq(customers.id, id), eq(customers.isDeleted, 0)),
		columns: {
			id: true,
			phone: true,
			name: true,
			company: true,
			type: true,
			status: true,
			remark: true,
			ownerId: true,
			batchId: true,
			createdAt: true,
			updatedAt: true,
		},
	});
}

export async function updateCustomerById(db: Db, id: number, input: UpdateCustomerInput): Promise<CustomerBasicRow | undefined> {
	const result = await db
		.update(customers)
		.set(input)
		.where(and(eq(customers.id, id), eq(customers.isDeleted, 0)))
		.returning({
			id: customers.id,
			phone: customers.phone,
			name: customers.name,
			company: customers.company,
			type: customers.type,
			status: customers.status,
			remark: customers.remark,
			ownerId: customers.ownerId,
			batchId: customers.batchId,
			createdAt: customers.createdAt,
			updatedAt: customers.updatedAt,
		});

	return result[0];
}

export async function findCustomerDeleteStateById(db: Db, id: number): Promise<{ id: number; isDeleted: number } | undefined> {
	return db.query.customers.findFirst({
		where: eq(customers.id, id),
		columns: { id: true, isDeleted: true },
	});
}

export async function softDeleteCustomerById(
	db: Db,
	input: { id: number; deletedAt: string; deletedBy: number; deleteReason: string | null },
): Promise<void> {
	await db
		.update(customers)
		.set({
			isDeleted: 1,
			deletedAt: input.deletedAt,
			deletedBy: input.deletedBy,
			deleteReason: input.deleteReason,
			updatedAt: input.deletedAt,
		})
		.where(eq(customers.id, input.id));
}

export async function batchUpdateCustomersByIds(db: Db, customerIds: number[], input: BatchUpdateCustomerInput): Promise<number> {
	if (customerIds.length === 0) {
		return 0;
	}

	const result = await db.update(customers).set(input).where(inArray(customers.id, customerIds)).returning({ id: customers.id });

	return result.length;
}

export async function updateCustomersOwnerWithLogs(
	db: Db,
	customerIds: number[],
	targetUserId: number | null,
	logs: AssignmentLogInput[],
): Promise<void> {
	if (customerIds.length === 0 || logs.length === 0) {
		return;
	}

	await db.batch([
		db
			.update(customers)
			.set({ ownerId: targetUserId, updatedAt: new Date().toISOString() })
			.where(and(inArray(customers.id, customerIds), eq(customers.isDeleted, 0))),
		db.insert(assignmentLogs).values(logs),
	]);
}
