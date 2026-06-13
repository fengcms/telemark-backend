import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { createDb } from '@/db';
import { users } from '@/db/schema';
import { verifyAccessToken } from '@/utils/crypto';

export interface CurrentUser {
	id: number;
	username: string;
	realName: string;
	role: number;
	status: number;
}

type AuthEnv = {
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
};

export const requireAuth = (): MiddlewareHandler<AuthEnv> => {
	return async (c, next) => {
		const token = extractBearerToken(c.req.header('authorization'));

		if (!token) {
			return c.json({ message: '未登录或 AccessToken 缺失' }, 401);
		}

		const payload = await verifyAccessToken(token, c.env.JWT_SECRET);

		if (!payload) {
			return c.json({ message: 'AccessToken 无效或已过期' }, 401);
		}

		const user = await createDb(c.env.DB).query.users.findFirst({
			where: eq(users.id, payload.user_id),
			columns: {
				id: true,
				username: true,
				realName: true,
				role: true,
				status: true,
			},
		});

		if (user?.status !== 1) {
			return c.json({ message: '用户不存在或已被禁用' }, 401);
		}

		c.set('currentUser', user);
		await next();
	};
};

export const requireRoles = (roles: number[]): MiddlewareHandler<AuthEnv> => {
	return async (c, next) => {
		const currentUser = c.get('currentUser');

		if (!roles.includes(currentUser.role)) {
			return c.json({ message: '权限不足' }, 403);
		}

		await next();
	};
};

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
