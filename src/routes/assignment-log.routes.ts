import { Hono } from 'hono';
import { assignmentLogController } from '@/controllers/assignment-log.controller';
import { type CurrentUser, requireAuth, requireRoles } from '@/middleware/auth.middleware';

type AssignmentLogRoutesEnv = {
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
};

export const assignmentLogRoutes = new Hono<AssignmentLogRoutesEnv>();

assignmentLogRoutes.get('/assignment-logs', requireAuth(), requireRoles([1, 2]), assignmentLogController.list);
