import { Hono, type MiddlewareHandler } from 'hono';
import { customerController } from '@/controllers/customer.controller';
import type { Actor } from '@/services/customer.service';
import { type VerifiedAccessTokenPayload, verifyAccessToken } from '@/utils/crypto';

type CustomerRoutesEnv = {
	Bindings: Env;
	Variables: {
		currentUser: Actor;
	};
};

export const customerRoutes = new Hono<CustomerRoutesEnv>();

const requireAdminOrManager: MiddlewareHandler<CustomerRoutesEnv> = async (c, next) => {
	const auth = await authenticate(c.req.header('authorization'), c.env.JWT_SECRET);

	if (!auth.ok) {
		return c.json({ message: auth.message }, auth.status);
	}

	if (auth.payload.role !== 1 && auth.payload.role !== 2) {
		return c.json({ message: '权限不足' }, 403);
	}

	c.set('currentUser', {
		id: auth.payload.user_id,
		username: auth.payload.username,
		role: auth.payload.role,
	});

	await next();
};

const requireEmployeeOrManager: MiddlewareHandler<CustomerRoutesEnv> = async (c, next) => {
	const auth = await authenticate(c.req.header('authorization'), c.env.JWT_SECRET);

	if (!auth.ok) {
		return c.json({ message: auth.message }, auth.status);
	}

	if (auth.payload.role !== 2 && auth.payload.role !== 3) {
		return c.json({ message: '权限不足，仅员工或经理可访问自己的客户' }, 403);
	}

	c.set('currentUser', {
		id: auth.payload.user_id,
		username: auth.payload.username,
		role: auth.payload.role,
	});

	await next();
};

customerRoutes.post('/batches/import', requireAdminOrManager, customerController.importBatch);
customerRoutes.get('/customers', requireAdminOrManager, customerController.listCustomers);
customerRoutes.get('/my-customers', requireEmployeeOrManager, customerController.listMyCustomers);
customerRoutes.post('/customers/assign', requireAdminOrManager, customerController.assignCustomers);

async function authenticate(
	authorization: string | undefined,
	jwtSecret: string,
): Promise<
	| {
			ok: true;
			payload: VerifiedAccessTokenPayload;
	  }
	| {
			ok: false;
			status: 401;
			message: string;
	  }
> {
	const token = extractBearerToken(authorization);

	if (!token) {
		return {
			ok: false,
			status: 401,
			message: '未登录或 AccessToken 缺失',
		};
	}

	const payload = await verifyAccessToken(token, jwtSecret);

	if (!payload) {
		return {
			ok: false,
			status: 401,
			message: 'AccessToken 无效或已过期',
		};
	}

	return {
		ok: true,
		payload,
	};
}

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
