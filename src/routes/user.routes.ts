import { Hono, type MiddlewareHandler } from 'hono';
import { userController } from '@/controllers/user.controller';
import type { UserActor } from '@/services/user.service';
import { type VerifiedAccessTokenPayload, verifyAccessToken } from '@/utils/crypto';

type UserRoutesEnv = {
	Bindings: Env;
	Variables: {
		currentUser: UserActor;
	};
};

export const userRoutes = new Hono<UserRoutesEnv>();

const requireAdminOrManager: MiddlewareHandler<UserRoutesEnv> = async (c, next) => {
	const auth = await authenticate(c.req.header('authorization'), c.env.JWT_SECRET);

	if (!auth.ok) {
		return c.json({ message: auth.message }, auth.status);
	}

	if (auth.payload.role !== 1 && auth.payload.role !== 2) {
		return c.json({ message: '权限不足' }, 403);
	}

	c.set('currentUser', toActor(auth.payload));
	await next();
};

const requireAdmin: MiddlewareHandler<UserRoutesEnv> = async (c, next) => {
	const auth = await authenticate(c.req.header('authorization'), c.env.JWT_SECRET);

	if (!auth.ok) {
		return c.json({ message: auth.message }, auth.status);
	}

	if (auth.payload.role !== 1) {
		return c.json({ message: '权限不足，仅管理员可操作员工账号' }, 403);
	}

	c.set('currentUser', toActor(auth.payload));
	await next();
};

userRoutes.get('/users', requireAdminOrManager, userController.listUsers);
userRoutes.post('/users', requireAdmin, userController.createUser);
userRoutes.patch('/users/:id', requireAdmin, userController.updateUser);
userRoutes.delete('/users/:id', requireAdmin, userController.deleteUser);

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

function toActor(payload: VerifiedAccessTokenPayload): UserActor {
	return {
		id: payload.user_id,
		username: payload.username,
		role: payload.role,
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
