import type { Context } from 'hono';
import { createDb } from '@/db';
import type { CurrentUser } from '@/middleware/auth.middleware';
import {
	AssignCustomersError,
	assignCustomersService,
	batchUpdateCustomersService,
	CustomerHistoryQueryError,
	CustomerMutationError,
	deleteCustomerService,
	getCustomerDetailService,
	type ImportCustomerInput,
	importBatchService,
	listCustomersService,
	listMyCustomerHistoryService,
	listMyCustomersService,
	parseCustomerId,
	type UpdateCustomerInput,
	updateCustomerService,
} from '@/services/customer.service';

type CustomerContext = Context<{
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
}>;

interface ImportBatchRequestBody {
	name?: unknown;
	source?: unknown;
	cost?: unknown;
	customers?: unknown;
}

interface AssignCustomersRequestBody {
	customerIds?: unknown;
	targetUserId?: unknown;
	reason?: unknown;
}

interface DeleteCustomerRequestBody {
	reason?: unknown;
}

interface BatchUpdateCustomersRequestBody {
	customerIds?: unknown;
	patch?: unknown;
}

export const customerController = {
	async listCustomers(c: CustomerContext) {
		const result = await listCustomersService(createDb(c.env.DB), c.req.query());

		return c.json(result);
	},

	async listMyCustomers(c: CustomerContext) {
		const result = await listMyCustomersService(createDb(c.env.DB), c.req.query(), c.get('currentUser').id);

		return c.json(result);
	},

	async listMyCustomerHistory(c: CustomerContext) {
		try {
			const result = await listMyCustomerHistoryService(createDb(c.env.DB), c.req.query(), c.get('currentUser').id);

			return c.json(result);
		} catch (error) {
			if (error instanceof CustomerHistoryQueryError) {
				return c.json({ message: error.message }, error.status);
			}

			throw error;
		}
	},

	async importBatch(c: CustomerContext) {
		const body = await c.req.json<ImportBatchRequestBody>().catch(() => null);
		const name = normalizeRequiredString(body?.name);
		const source = normalizeRequiredString(body?.source);
		const cost = normalizeNonNegativeNumber(body?.cost);
		const customerInputs = normalizeCustomerInputs(body?.customers);

		if (!name || !source || cost === null || customerInputs.length === 0) {
			return c.json({ message: '参数错误：name、source、cost、customers 不能为空' }, 400);
		}

		const result = await importBatchService(createDb(c.env.DB), {
			name,
			source,
			cost,
			customers: customerInputs,
			creatorId: c.get('currentUser').id,
		});

		return c.json(result);
	},

	async assignCustomers(c: CustomerContext) {
		const body = await c.req.json<AssignCustomersRequestBody>().catch(() => null);
		const customerIds = normalizeIdArray(body?.customerIds);
		const targetUserId = normalizeNullableId(body?.targetUserId);
		const reason = normalizeRequiredString(body?.reason);

		if (customerIds.length === 0 || targetUserId === undefined || !reason) {
			return c.json({ message: '参数错误：customerIds、targetUserId、reason 不合法' }, 400);
		}

		try {
			const result = await assignCustomersService(createDb(c.env.DB), {
				customerIds,
				targetUserId,
				reason,
				assignerId: c.get('currentUser').id,
			});

			return c.json(result);
		} catch (error) {
			if (error instanceof AssignCustomersError) {
				return c.json({ message: error.message }, error.status);
			}

			throw error;
		}
	},

	async detail(c: CustomerContext) {
		try {
			const id = parseCustomerId(c.req.param('id') ?? '');
			const result = await getCustomerDetailService(createDb(c.env.DB), id);

			return c.json(result);
		} catch (error) {
			if (error instanceof CustomerMutationError) {
				return c.json({ message: error.message }, error.status);
			}

			throw error;
		}
	},

	async update(c: CustomerContext) {
		const body = await c.req.json<Record<string, unknown>>().catch(() => null);

		try {
			const id = parseCustomerId(c.req.param('id') ?? '');
			const patch = normalizeCustomerPatch(body);
			const result = await updateCustomerService(createDb(c.env.DB), id, patch);

			return c.json(result);
		} catch (error) {
			if (error instanceof CustomerMutationError) {
				return c.json({ message: error.message }, error.status);
			}

			throw error;
		}
	},

	async delete(c: CustomerContext) {
		const body = await c.req.json<DeleteCustomerRequestBody>().catch(() => null);

		try {
			const id = parseCustomerId(c.req.param('id') ?? '');
			const result = await deleteCustomerService(createDb(c.env.DB), {
				id,
				operatorId: c.get('currentUser').id,
				reason: normalizeDeleteReason(body),
			});

			return c.json(result);
		} catch (error) {
			if (error instanceof CustomerMutationError) {
				return c.json({ message: error.message }, error.status);
			}

			throw error;
		}
	},

	async batchUpdate(c: CustomerContext) {
		const body = await c.req.json<BatchUpdateCustomersRequestBody>().catch(() => null);

		try {
			if (!isRecord(body)) {
				throw new CustomerMutationError(400, '请求体不合法');
			}

			const customerIds = normalizeStrictIdArray(body.customerIds);
			const patch = normalizeBatchUpdatePatch(body.patch);
			const result = await batchUpdateCustomersService(createDb(c.env.DB), { customerIds, patch });

			return c.json(result);
		} catch (error) {
			if (error instanceof CustomerMutationError) {
				return c.json({ message: error.message }, error.status);
			}

			throw error;
		}
	},
};

function normalizeRequiredString(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const normalized = value.trim();

	return normalized.length > 0 ? normalized : null;
}

function normalizeNonNegativeNumber(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		return null;
	}

	return value;
}

function normalizeCustomerInputs(value: unknown): ImportCustomerInput[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((item) => {
		if (!isRecord(item)) {
			return [];
		}

		const phone = normalizeRequiredString(item.phone);

		if (!phone) {
			return [];
		}

		return [
			{
				phone,
				name: normalizeOptionalString(item.name),
				company: normalizeOptionalString(item.company),
			},
		];
	});
}

function normalizeIdArray(value: unknown): number[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((item): item is number => Number.isInteger(item) && item > 0);
}

function normalizeStrictIdArray(value: unknown): number[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new CustomerMutationError(400, 'customerIds 必须是非空数组');
	}

	if (value.length > 500) {
		throw new CustomerMutationError(400, 'customerIds 最多支持 500 个');
	}

	if (!value.every((item): item is number => Number.isInteger(item) && item > 0)) {
		throw new CustomerMutationError(400, 'customerIds 必须都是正整数');
	}

	return value;
}

function normalizeNullableId(value: unknown): number | null | undefined {
	if (value === null) {
		return null;
	}

	if (Number.isInteger(value) && typeof value === 'number' && value > 0) {
		return value;
	}

	return undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
	return normalizeRequiredString(value) ?? undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function normalizeCustomerPatch(body: Record<string, unknown> | null): UpdateCustomerInput {
	if (!isRecord(body)) {
		throw new CustomerMutationError(400, '请求体不合法');
	}

	const allowedKeys = new Set(['name', 'company', 'type', 'status', 'remark']);
	const keys = Object.keys(body);
	const unknownKey = keys.find((key) => !allowedKeys.has(key));

	if (unknownKey) {
		throw new CustomerMutationError(400, `不允许更新字段：${unknownKey}`);
	}

	if (keys.length === 0) {
		throw new CustomerMutationError(400, '请求体没有可更新字段');
	}

	const patch: UpdateCustomerInput = {};

	if ('name' in body) {
		patch.name = normalizeOptionalNullableString(body.name);
	}

	if ('company' in body) {
		patch.company = normalizeOptionalNullableString(body.company);
	}

	if ('type' in body) {
		patch.type = normalizeCustomerType(body.type);
	}

	if ('status' in body) {
		patch.status = normalizeCustomerStatus(body.status);
	}

	if ('remark' in body) {
		patch.remark = normalizeOptionalNullableString(body.remark);
	}

	return patch;
}

function normalizeBatchUpdatePatch(value: unknown): { type?: number; status?: number; remark?: string | null } {
	if (!isRecord(value)) {
		throw new CustomerMutationError(400, 'patch 不能为空');
	}

	const allowedKeys = new Set(['type', 'status', 'remark']);
	const keys = Object.keys(value);
	const unknownKey = keys.find((key) => !allowedKeys.has(key));

	if (unknownKey) {
		throw new CustomerMutationError(400, `不允许更新字段：${unknownKey}`);
	}

	if (keys.length === 0) {
		throw new CustomerMutationError(400, 'patch 不能为空');
	}

	const patch: { type?: number; status?: number; remark?: string | null } = {};

	if ('type' in value) {
		patch.type = normalizeCustomerType(value.type);
	}

	if ('status' in value) {
		patch.status = normalizeCustomerStatus(value.status);
	}

	if ('remark' in value) {
		patch.remark = normalizeOptionalNullableString(value.remark);
	}

	return patch;
}

function normalizeCustomerType(value: unknown): number {
	if (value !== 0 && value !== 1) {
		throw new CustomerMutationError(400, 'type 只能是 0 或 1');
	}

	return value;
}

function normalizeCustomerStatus(value: unknown): number {
	if (!Number.isInteger(value) || typeof value !== 'number' || value < 0 || value > 4) {
		throw new CustomerMutationError(400, 'status 只能是 0、1、2、3、4');
	}

	return value;
}

function normalizeOptionalNullableString(value: unknown): string | null {
	if (value === null) {
		return null;
	}

	if (typeof value !== 'string') {
		throw new CustomerMutationError(400, '字符串字段不合法');
	}

	return value.trim();
}

function normalizeDeleteReason(body: DeleteCustomerRequestBody | null): string | null {
	if (!body || body.reason === undefined) {
		return null;
	}

	return normalizeOptionalNullableString(body.reason);
}
