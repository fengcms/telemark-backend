import { asc, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { commonCallRemarks } from '@/db/schema';
import { handleListQuery, type ListQueryResult } from '@/utils/query-builder';

const COMMON_CALL_REMARK_ALLOWED_FIELDS = [
	'id',
	'content',
	'sortOrder',
	'status',
	'usageCount',
	'createdBy',
	'updatedBy',
	'createdAt',
	'updatedAt',
] as const;

export interface CreateCommonCallRemarkInput {
	content: string;
	sortOrder: number;
	status: number;
	operatorId: number;
}

export interface UpdateCommonCallRemarkInput {
	id: number;
	content?: string;
	sortOrder?: number;
	status?: number;
	operatorId: number;
}

export type CommonCallRemarkListItem = {
	[TKey in (typeof COMMON_CALL_REMARK_ALLOWED_FIELDS)[number]]: (typeof commonCallRemarks)[TKey] extends { _: { data: infer TData } }
		? TData
		: unknown;
};

export type CommonCallRemarkMutationResult =
	| {
			ok: true;
			remark: CommonCallRemarkRow;
	  }
	| {
			ok: false;
			status: 404 | 409;
			message: string;
	  };

export interface CommonCallRemarkRow {
	id: number;
	content: string;
	sortOrder: number;
	status: number;
	usageCount: number;
	createdBy: number | null;
	updatedBy: number | null;
	createdAt: string;
	updatedAt: string;
}

export async function listEnabledCommonCallRemarksService(db: Db): Promise<string[]> {
	const rows = await db
		.select({ content: commonCallRemarks.content })
		.from(commonCallRemarks)
		.where(eq(commonCallRemarks.status, 1))
		.orderBy(asc(commonCallRemarks.sortOrder), asc(commonCallRemarks.id));

	return rows.map((row) => row.content);
}

export async function listCommonCallRemarksService(
	db: Db,
	query: Record<string, string | string[] | undefined>,
): Promise<ListQueryResult<CommonCallRemarkListItem>> {
	return handleListQuery(commonCallRemarks, withDefaultSort(query), {
		db,
		allowedFields: COMMON_CALL_REMARK_ALLOWED_FIELDS,
		defaultSortField: 'sortOrder',
	});
}

export async function createCommonCallRemarkService(db: Db, input: CreateCommonCallRemarkInput): Promise<CommonCallRemarkMutationResult> {
	const existing = await findByContent(db, input.content);

	if (existing) {
		return {
			ok: false,
			status: 409,
			message: '常用备注内容已存在',
		};
	}

	const result = await db
		.insert(commonCallRemarks)
		.values({
			content: input.content,
			sortOrder: input.sortOrder,
			status: input.status,
			createdBy: input.operatorId,
			updatedBy: input.operatorId,
		})
		.returning(commonCallRemarkReturningFields);

	const remark = result[0];

	if (!remark) {
		throw new Error('创建常用备注失败');
	}

	return {
		ok: true,
		remark,
	};
}

export async function updateCommonCallRemarkService(db: Db, input: UpdateCommonCallRemarkInput): Promise<CommonCallRemarkMutationResult> {
	const existing = await db.query.commonCallRemarks.findFirst({
		where: eq(commonCallRemarks.id, input.id),
		columns: {
			id: true,
			content: true,
		},
	});

	if (!existing) {
		return {
			ok: false,
			status: 404,
			message: '常用备注不存在',
		};
	}

	if (input.content && input.content !== existing.content) {
		const duplicate = await findByContent(db, input.content);

		if (duplicate) {
			return {
				ok: false,
				status: 409,
				message: '常用备注内容已存在',
			};
		}
	}

	const result = await db
		.update(commonCallRemarks)
		.set({
			content: input.content,
			sortOrder: input.sortOrder,
			status: input.status,
			updatedBy: input.operatorId,
			updatedAt: new Date().toISOString(),
		})
		.where(eq(commonCallRemarks.id, input.id))
		.returning(commonCallRemarkReturningFields);

	const remark = result[0];

	if (!remark) {
		throw new Error('更新常用备注失败');
	}

	return {
		ok: true,
		remark,
	};
}

export async function disableCommonCallRemarkService(db: Db, id: number, operatorId: number): Promise<CommonCallRemarkMutationResult> {
	const result = await db
		.update(commonCallRemarks)
		.set({
			status: 0,
			updatedBy: operatorId,
			updatedAt: new Date().toISOString(),
		})
		.where(eq(commonCallRemarks.id, id))
		.returning(commonCallRemarkReturningFields);

	const remark = result[0];

	if (!remark) {
		return {
			ok: false,
			status: 404,
			message: '常用备注不存在',
		};
	}

	return {
		ok: true,
		remark,
	};
}

export function parseCommonCallRemarkId(value: string): number | null {
	const parsed = Number(value);

	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const commonCallRemarkReturningFields = {
	id: commonCallRemarks.id,
	content: commonCallRemarks.content,
	sortOrder: commonCallRemarks.sortOrder,
	status: commonCallRemarks.status,
	usageCount: commonCallRemarks.usageCount,
	createdBy: commonCallRemarks.createdBy,
	updatedBy: commonCallRemarks.updatedBy,
	createdAt: commonCallRemarks.createdAt,
	updatedAt: commonCallRemarks.updatedAt,
};

async function findByContent(db: Db, content: string): Promise<{ id: number } | undefined> {
	return db.query.commonCallRemarks.findFirst({
		where: eq(commonCallRemarks.content, content),
		columns: {
			id: true,
		},
	});
}

function withDefaultSort(query: Record<string, string | string[] | undefined>): Record<string, string | string[] | undefined> {
	return {
		...query,
		sort: query.sort ?? '-sortOrder',
	};
}
