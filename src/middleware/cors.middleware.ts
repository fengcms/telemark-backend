import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';

export const corsMiddleware = (): MiddlewareHandler =>
	cors({
		origin: '*',
		allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
		exposeHeaders: ['Content-Length', 'X-Kuma-Revision'],
		maxAge: 86400,
		credentials: true,
	});
