import { Hono } from 'hono';
import { userController } from '@/controllers/user.controller';
import { type CurrentUser, requireAuth, requireRoles } from '@/middleware/auth.middleware';

type UserRoutesEnv = {
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
};

export const userRoutes = new Hono<UserRoutesEnv>();

userRoutes.get('/users', requireAuth(), requireRoles([1, 2]), userController.listUsers);
userRoutes.post('/users', requireAuth(), requireRoles([1]), userController.createUser);
userRoutes.patch('/users/:id', requireAuth(), requireRoles([1]), userController.updateUser);
userRoutes.delete('/users/:id', requireAuth(), requireRoles([1]), userController.deleteUser);
