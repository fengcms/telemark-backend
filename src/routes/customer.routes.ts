import { Hono } from 'hono';
import { customerController } from '@/controllers/customer.controller';
import { type CurrentUser, requireAuth, requireRoles } from '@/middleware/auth.middleware';

type CustomerRoutesEnv = {
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
};

export const customerRoutes = new Hono<CustomerRoutesEnv>();

customerRoutes.post('/batches/import', requireAuth(), requireRoles([1, 2]), customerController.importBatch);
customerRoutes.get('/customers', requireAuth(), requireRoles([1, 2]), customerController.listCustomers);
customerRoutes.get('/my-customers', requireAuth(), requireRoles([2, 3]), customerController.listMyCustomers);
customerRoutes.post('/customers/assign', requireAuth(), requireRoles([1, 2]), customerController.assignCustomers);
customerRoutes.post('/customers/batch-update', requireAuth(), requireRoles([1, 2]), customerController.batchUpdate);
customerRoutes.get('/customers/:id', requireAuth(), requireRoles([1, 2]), customerController.detail);
customerRoutes.patch('/customers/:id', requireAuth(), requireRoles([1, 2]), customerController.update);
customerRoutes.delete('/customers/:id', requireAuth(), requireRoles([1, 2]), customerController.delete);
