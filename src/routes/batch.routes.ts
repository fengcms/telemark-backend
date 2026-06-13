import { Hono } from 'hono';
import { batchController } from '@/controllers/batch.controller';
import { type CurrentUser, requireAuth, requireRoles } from '@/middleware/auth.middleware';

type BatchRoutesEnv = {
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
};

export const batchRoutes = new Hono<BatchRoutesEnv>();

batchRoutes.get('/batches', requireAuth(), requireRoles([1, 2]), batchController.listBatches);
batchRoutes.get('/batches/:id/summary', requireAuth(), requireRoles([1, 2]), batchController.summary);
