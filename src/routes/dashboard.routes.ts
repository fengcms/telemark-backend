import { Hono } from 'hono';
import { dashboardController } from '@/controllers/dashboard.controller';
import { type CurrentUser, requireAuth, requireRoles } from '@/middleware/auth.middleware';

type DashboardRoutesEnv = {
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
};

export const dashboardRoutes = new Hono<DashboardRoutesEnv>();

dashboardRoutes.get('/overview', requireAuth(), requireRoles([1, 2]), dashboardController.overview);
dashboardRoutes.get('/agent-daily', requireAuth(), requireRoles([1, 2]), dashboardController.agentDaily);
