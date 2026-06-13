import { Hono } from 'hono';
import { authController } from '@/controllers/auth.controller';
import { type CurrentUser, requireAuth } from '@/middleware/auth.middleware';

type AuthRoutesEnv = {
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
};

export const authRoutes = new Hono<AuthRoutesEnv>();

authRoutes.post('/init-admin', authController.initAdmin);
authRoutes.post('/login', authController.login);
authRoutes.post('/refresh', authController.refresh);
authRoutes.post('/logout', requireAuth(), authController.logout);
authRoutes.post('/change-password', requireAuth(), authController.changePassword);
