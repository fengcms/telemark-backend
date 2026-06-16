import { Hono } from 'hono';
import { commonCallRemarkController } from '@/controllers/common-call-remark.controller';
import { type CurrentUser, requireAuth, requireRoles } from '@/middleware/auth.middleware';

type CommonCallRemarkRoutesEnv = {
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
};

export const commonCallRemarkRoutes = new Hono<CommonCallRemarkRoutesEnv>();

commonCallRemarkRoutes.get('/call-remarks/common', requireAuth(), requireRoles([2, 3]), commonCallRemarkController.listEnabled);

commonCallRemarkRoutes.get('/common-call-remarks', requireAuth(), requireRoles([1, 2]), commonCallRemarkController.list);
commonCallRemarkRoutes.post('/common-call-remarks', requireAuth(), requireRoles([1, 2]), commonCallRemarkController.create);
commonCallRemarkRoutes.patch('/common-call-remarks/:id', requireAuth(), requireRoles([1, 2]), commonCallRemarkController.update);
commonCallRemarkRoutes.delete('/common-call-remarks/:id', requireAuth(), requireRoles([1, 2]), commonCallRemarkController.remove);
