import type { Context } from 'hono';
import { createDb } from '@/db';
import type { CurrentUser } from '@/middleware/auth.middleware';
import { CallLogQueryError, listCallLogsService } from '@/services/call-log.service';

type CallLogContext = Context<{
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
}>;

export const callLogController = {
	async list(c: CallLogContext) {
		try {
			const result = await listCallLogsService(createDb(c.env.DB), c.req.query());

			return c.json(result);
		} catch (error) {
			if (error instanceof CallLogQueryError) {
				return c.json({ message: error.message }, error.status);
			}

			throw error;
		}
	},
};
