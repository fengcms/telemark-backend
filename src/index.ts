import { Hono } from 'hono';
import { createDb } from '@/db';
import { corsMiddleware } from '@/middleware/cors.middleware';
import { authRoutes } from '@/routes/auth.routes';
import { callRoutes } from '@/routes/call.routes';
import { customerRoutes } from '@/routes/customer.routes';
import { dashboardRoutes } from '@/routes/dashboard.routes';
import { userRoutes } from '@/routes/user.routes';

const app = new Hono<{ Bindings: Env }>();

app.use('*', corsMiddleware());

app.get('/', (c) => c.text('Hello World!'));

app.get('/health', async (c) => {
	const db = createDb(c.env.DB);
	const result = await db.run('SELECT 1 AS ok');

	return c.json({
		ok: true,
		database: result.success,
	});
});

app.route('/api/auth', authRoutes);
app.route('/api', customerRoutes);
app.route('/api', callRoutes);
app.route('/api', userRoutes);
app.route('/api/dashboard', dashboardRoutes);

export default app;
