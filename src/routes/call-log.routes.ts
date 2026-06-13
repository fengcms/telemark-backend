import { Hono } from 'hono';
import { callLogController } from '@/controllers/call-log.controller';
import { type CurrentUser, requireAuth, requireRoles } from '@/middleware/auth.middleware';

type CallLogRoutesEnv = {
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
};

export const callLogRoutes = new Hono<CallLogRoutesEnv>();

callLogRoutes.get('/call-logs', requireAuth(), requireRoles([1, 2]), callLogController.list);
