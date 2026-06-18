import type { Context } from 'hono';
import { createDb } from '@/db';
import type { CurrentUser } from '@/middleware/auth.middleware';
import { getMySummaryService, reportCallService } from '@/services/call.service';

type CallContext = Context<{
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
}>;

interface ReportCallRequestBody {
	customerId?: unknown;
	duration?: unknown;
	callResult?: unknown;
	callRemark?: unknown;
	customerType?: unknown;
	clientRequestId?: unknown;
	startedAt?: unknown;
	endedAt?: unknown;
}

export const callController = {
	async report(c: CallContext) {
		const body = await c.req.json<ReportCallRequestBody>().catch(() => null);
		const customerId = normalizePositiveInteger(body?.customerId);
		const duration = normalizeNonNegativeInteger(body?.duration);
		const callResult = normalizeNonNegativeInteger(body?.callResult);
		const customerType = normalizeCustomerType(body?.customerType);
		const clientRequestId = normalizeOptionalClientRequestId(body?.clientRequestId);
		const startedAt = normalizeOptionalIsoDate(body?.startedAt);
		const endedAt = normalizeOptionalIsoDate(body?.endedAt);

		if (customerId === null || duration === null || callResult === null) {
			return c.json({ message: '参数错误：customerId、duration、callResult 不合法' }, 400);
		}

		if (customerType === null) {
			return c.json({ message: '参数错误：customerType 只能是 -1、0、1、2' }, 400);
		}

		const callRemark = normalizeCallRemark(body?.callRemark, callResult);

		if (callRemark === undefined) {
			return c.json({ message: '参数错误：已接听时 callRemark 必填' }, 400);
		}

		if (clientRequestId === null) {
			return c.json({ message: '参数错误：clientRequestId 不合法' }, 400);
		}

		if (startedAt === null || endedAt === null) {
			return c.json({ message: '参数错误：startedAt 或 endedAt 不合法' }, 400);
		}

		if (startedAt && endedAt && new Date(endedAt).getTime() < new Date(startedAt).getTime()) {
			return c.json({ message: '参数错误：endedAt 不能早于 startedAt' }, 400);
		}

		const result = await reportCallService(createDb(c.env.DB), {
			customerId,
			duration,
			callResult,
			callRemark,
			customerType,
			userId: c.get('currentUser').id,
			clientRequestId: clientRequestId ?? undefined,
			startedAt: startedAt ?? undefined,
			endedAt: endedAt ?? undefined,
		});

		if (!result.ok) {
			return c.json({ message: result.message }, result.status);
		}

		return c.json(result);
	},

	async mySummary(c: CallContext) {
		const result = await getMySummaryService(createDb(c.env.DB), {
			userId: c.get('currentUser').id,
		});

		return c.json(result);
	},
};

function normalizePositiveInteger(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		return null;
	}

	return value;
}

function normalizeNonNegativeInteger(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
		return null;
	}

	return value;
}

function normalizeCustomerType(value: unknown): number | null {
	if (value !== -1 && value !== 0 && value !== 1 && value !== 2) {
		return null;
	}

	return value;
}

function normalizeCallRemark(value: unknown, callResult: number): string | null | undefined {
	if (callResult !== 1) {
		return null;
	}

	if (typeof value !== 'string') {
		return undefined;
	}

	const normalized = value.trim();

	return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalClientRequestId(value: unknown): string | undefined | null {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'string') {
		return null;
	}

	const normalized = value.trim();

	if (!normalized || normalized.length > 128) {
		return null;
	}

	return normalized;
}

function normalizeOptionalIsoDate(value: unknown): string | undefined | null {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'string') {
		return null;
	}

	const normalized = value.trim();

	if (!normalized) {
		return null;
	}

	const date = new Date(normalized);

	if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) {
		return null;
	}

	return normalized;
}
