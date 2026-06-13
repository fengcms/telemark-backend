import { Hono } from 'hono';
import { callController } from '@/controllers/call.controller';
import { type CurrentUser, requireAuth, requireRoles } from '@/middleware/auth.middleware';

type CallRoutesEnv = {
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
};

export const callRoutes = new Hono<CallRoutesEnv>();

callRoutes.post('/calls/report', requireAuth(), requireRoles([2, 3]), callController.report);
callRoutes.get('/my-summary', requireAuth(), requireRoles([2, 3]), callController.mySummary);
