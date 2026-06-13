import { eq, inArray } from 'drizzle-orm';
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

export async function findCustomersByIds(db: Db, customerIds: number[]): Promise<Array<{ id: number; ownerId: number | null }>> {
	if (customerIds.length === 0) {
		return [];
	}

	return db
		.select({
			id: customers.id,
			ownerId: customers.ownerId,
		})
		.from(customers)
		.where(inArray(customers.id, customerIds));
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
		db.update(customers).set({ ownerId: targetUserId }).where(inArray(customers.id, customerIds)),
		db.insert(assignmentLogs).values(logs),
	]);
}
