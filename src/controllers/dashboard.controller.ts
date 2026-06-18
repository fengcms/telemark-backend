import type { Context } from 'hono';
import { createDb } from '@/db';
import type { CurrentUser } from '@/middleware/auth.middleware';
import {
	DashboardQueryError,
	getAgentDailyService,
	getAgentMonthlyService,
	getDashboardOverviewService,
} from '@/services/dashboard.service';

type DashboardContext = Context<{
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
}>;

export const dashboardController = {
	async overview(c: DashboardContext) {
		try {
			const result = await getDashboardOverviewService(createDb(c.env.DB), c.req.query());

			return c.json(result);
		} catch (error) {
			if (error instanceof DashboardQueryError) {
				return c.json({ message: error.message }, error.status);
			}

			throw error;
		}
	},

	async agentDaily(c: DashboardContext) {
		try {
			const result = await getAgentDailyService(createDb(c.env.DB), c.req.query());

			return c.json(result);
		} catch (error) {
			if (error instanceof DashboardQueryError) {
				return c.json({ message: error.message }, error.status);
			}

			throw error;
		}
	},

	async agentMonthly(c: DashboardContext) {
		try {
			const currentUser = c.get('currentUser');
			const result = await getAgentMonthlyService(createDb(c.env.DB), c.req.query(), {
				id: currentUser.id,
				role: currentUser.role,
			});

			return c.json(result);
		} catch (error) {
			if (error instanceof DashboardQueryError) {
				return c.json({ message: error.message }, error.status);
			}

			throw error;
		}
	},
};
