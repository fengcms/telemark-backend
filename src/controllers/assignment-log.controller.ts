import type { Context } from 'hono';
import { createDb } from '@/db';
import type { CurrentUser } from '@/middleware/auth.middleware';
import { AssignmentLogQueryError, listAssignmentLogsService } from '@/services/assignment-log.service';

type AssignmentLogContext = Context<{
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
}>;

export const assignmentLogController = {
	async list(c: AssignmentLogContext) {
		try {
			const result = await listAssignmentLogsService(createDb(c.env.DB), c.req.query());

			return c.json(result);
		} catch (error) {
			if (error instanceof AssignmentLogQueryError) {
				return c.json({ message: error.message }, error.status);
			}

			throw error;
		}
	},
};
