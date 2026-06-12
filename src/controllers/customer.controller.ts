import type { Context } from 'hono';
import { createDb } from '@/db';
import {
	type Actor,
	assignCustomersService,
	type ImportCustomerInput,
	importBatchService,
	listCustomersService,
	listMyCustomersService,
} from '@/services/customer.service';

type CustomerContext = Context<{
	Bindings: Env;
	Variables: {
		currentUser: Actor;
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

export const customerController = {
	async listCustomers(c: CustomerContext) {
		const result = await listCustomersService(createDb(c.env.DB), c.req.query());

		return c.json(result);
	},

	async listMyCustomers(c: CustomerContext) {
		const result = await listMyCustomersService(createDb(c.env.DB), c.req.query(), c.get('currentUser').id);

		return c.json(result);
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
			if (error instanceof Error && error.message === '目标员工不存在') {
				return c.json({ message: error.message }, 400);
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
