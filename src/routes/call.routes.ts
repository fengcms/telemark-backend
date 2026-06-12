import { Hono, type MiddlewareHandler } from 'hono';
import { callController } from '@/controllers/call.controller';
import type { CallActor } from '@/services/call.service';
import { verifyAccessToken } from '@/utils/crypto';

type CallRoutesEnv = {
	Bindings: Env;
	Variables: {
		currentUser: CallActor;
	};
};

export const callRoutes = new Hono<CallRoutesEnv>();

const requireEmployeeOrManager: MiddlewareHandler<CallRoutesEnv> = async (c, next) => {
	const token = extractBearerToken(c.req.header('authorization'));

	if (!token) {
		return c.json({ message: '未登录或 AccessToken 缺失' }, 401);
	}

	const payload = await verifyAccessToken(token, c.env.JWT_SECRET);

	if (!payload) {
		return c.json({ message: 'AccessToken 无效或已过期' }, 401);
	}

	if (payload.role !== 2 && payload.role !== 3) {
		return c.json({ message: '权限不足，仅员工或经理可回传通话记录' }, 403);
	}

	c.set('currentUser', {
		id: payload.user_id,
		username: payload.username,
		role: payload.role,
	});

	await next();
};

callRoutes.post('/calls/report', requireEmployeeOrManager, callController.report);
callRoutes.get('/my-summary', requireEmployeeOrManager, callController.mySummary);

function extractBearerToken(authorization: string | undefined): string | null {
	if (!authorization) {
		return null;
	}

	const [scheme, token] = authorization.split(' ');

	if (scheme !== 'Bearer' || !token) {
		return null;
	}

	return token;
}
