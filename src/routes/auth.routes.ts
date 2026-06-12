import { Hono, type MiddlewareHandler } from 'hono';
import { authController } from '@/controllers/auth.controller';
import { verifyAccessToken } from '@/utils/crypto';

type AuthRoutesEnv = {
	Bindings: Env;
};

export const authRoutes = new Hono<AuthRoutesEnv>();

const requireAuthenticated: MiddlewareHandler<AuthRoutesEnv> = async (c, next) => {
	const token = extractBearerToken(c.req.header('authorization'));

	if (!token) {
		return c.json({ message: '未登录或 AccessToken 缺失' }, 401);
	}

	const payload = await verifyAccessToken(token, c.env.JWT_SECRET);

	if (!payload) {
		return c.json({ message: 'AccessToken 无效或已过期' }, 401);
	}

	await next();
};

authRoutes.post('/init-admin', authController.initAdmin);
authRoutes.post('/login', authController.login);
authRoutes.post('/refresh', authController.refresh);
authRoutes.post('/logout', requireAuthenticated, authController.logout);

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
