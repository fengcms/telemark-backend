import type { Context } from 'hono';
import { createDb } from '@/db';
import { type CallActor, getMySummaryService, reportCallService } from '@/services/call.service';

type CallContext = Context<{
	Bindings: Env;
	Variables: {
		currentUser: CallActor;
	};
}>;

interface ReportCallRequestBody {
	customerId?: unknown;
	duration?: unknown;
	callResult?: unknown;
	callRemark?: unknown;
}

export const callController = {
	async report(c: CallContext) {
		const body = await c.req.json<ReportCallRequestBody>().catch(() => null);
		const customerId = normalizePositiveInteger(body?.customerId);
		const duration = normalizeNonNegativeInteger(body?.duration);
		const callResult = normalizeNonNegativeInteger(body?.callResult);
		const callRemark = normalizeString(body?.callRemark);

		if (customerId === null || duration === null || callResult === null || callRemark === null) {
			return c.json({ message: '参数错误：customerId、duration、callResult、callRemark 不合法' }, 400);
		}

		const result = await reportCallService(createDb(c.env.DB), {
			customerId,
			duration,
			callResult,
			callRemark,
			userId: c.get('currentUser').id,
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

function normalizeString(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	return value.trim();
}
