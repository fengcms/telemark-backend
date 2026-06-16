import type { Context } from 'hono';
import { createDb } from '@/db';
import type { CurrentUser } from '@/middleware/auth.middleware';
import {
	createCommonCallRemarkService,
	disableCommonCallRemarkService,
	listCommonCallRemarksService,
	listEnabledCommonCallRemarksService,
	parseCommonCallRemarkId,
	updateCommonCallRemarkService,
} from '@/services/common-call-remark.service';

type CommonCallRemarkContext = Context<{
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
}>;

interface CreateCommonCallRemarkRequestBody {
	content?: unknown;
	sortOrder?: unknown;
	status?: unknown;
}

interface UpdateCommonCallRemarkRequestBody {
	content?: unknown;
	sortOrder?: unknown;
	status?: unknown;
}

export const commonCallRemarkController = {
	async listEnabled(c: CommonCallRemarkContext) {
		const result = await listEnabledCommonCallRemarksService(createDb(c.env.DB));

		return c.json(result);
	},

	async list(c: CommonCallRemarkContext) {
		const result = await listCommonCallRemarksService(createDb(c.env.DB), c.req.query());

		return c.json(result);
	},

	async create(c: CommonCallRemarkContext) {
		const body = await c.req.json<CreateCommonCallRemarkRequestBody>().catch(() => null);
		const content = normalizeRequiredString(body?.content);
		const normalizedSortOrder = normalizeOptionalNonNegativeInteger(body?.sortOrder);
		const normalizedStatus = normalizeOptionalStatus(body?.status);

		if (!content || normalizedSortOrder === null || normalizedStatus === null) {
			return c.json({ message: '参数错误：content、sortOrder 或 status 不合法' }, 400);
		}

		const result = await createCommonCallRemarkService(createDb(c.env.DB), {
			content,
			sortOrder: normalizedSortOrder ?? 0,
			status: normalizedStatus ?? 1,
			operatorId: c.get('currentUser').id,
		});

		if (!result.ok) {
			return c.json({ message: result.message }, result.status);
		}

		return c.json(result.remark);
	},

	async update(c: CommonCallRemarkContext) {
		const id = parseCommonCallRemarkId(c.req.param('id') ?? '');

		if (id === null) {
			return c.json({ message: '参数错误：常用备注 ID 不合法' }, 400);
		}

		const body = await c.req.json<UpdateCommonCallRemarkRequestBody>().catch(() => null);
		const content = normalizeOptionalString(body?.content);
		const sortOrder = normalizeOptionalNonNegativeInteger(body?.sortOrder);
		const status = normalizeOptionalStatus(body?.status);

		if ((body?.content !== undefined && !content) || sortOrder === null || status === null) {
			return c.json({ message: '参数错误：content、sortOrder 或 status 不合法' }, 400);
		}

		const result = await updateCommonCallRemarkService(createDb(c.env.DB), {
			id,
			content,
			sortOrder: sortOrder ?? undefined,
			status: status ?? undefined,
			operatorId: c.get('currentUser').id,
		});

		if (!result.ok) {
			return c.json({ message: result.message }, result.status);
		}

		return c.json(result.remark);
	},

	async remove(c: CommonCallRemarkContext) {
		const id = parseCommonCallRemarkId(c.req.param('id') ?? '');

		if (id === null) {
			return c.json({ message: '参数错误：常用备注 ID 不合法' }, 400);
		}

		const result = await disableCommonCallRemarkService(createDb(c.env.DB), id, c.get('currentUser').id);

		if (!result.ok) {
			return c.json({ message: result.message }, result.status);
		}

		return c.json(result.remark);
	},
};

function normalizeRequiredString(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const normalized = value.trim();

	return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalString(value: unknown): string | undefined {
	return normalizeRequiredString(value) ?? undefined;
}

function normalizeOptionalNonNegativeInteger(value: unknown): number | null | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
		return null;
	}

	return value;
}

function normalizeOptionalStatus(value: unknown): number | null | undefined {
	if (value === undefined) {
		return undefined;
	}

	return value === 0 || value === 1 ? value : null;
}
