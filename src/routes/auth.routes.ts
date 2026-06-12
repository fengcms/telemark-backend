import { Hono } from 'hono';
import { authController } from '@/controllers/auth.controller';

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/init-admin', authController.initAdmin);
authRoutes.post('/login', authController.login);
authRoutes.post('/refresh', authController.refresh);
