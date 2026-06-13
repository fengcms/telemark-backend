import type { Context } from 'hono';
import { createDb } from '@/db';
import type { CurrentUser } from '@/middleware/auth.middleware';
import { BatchQueryError, getBatchSummaryService, listBatchesService, parseBatchId } from '@/services/batch.service';

type BatchContext = Context<{
	Bindings: Env;
	Variables: {
		currentUser: CurrentUser;
	};
}>;

export const batchController = {
	async listBatches(c: BatchContext) {
		try {
			const result = await listBatchesService(createDb(c.env.DB), c.req.query());

			return c.json(result);
		} catch (error) {
			if (error instanceof BatchQueryError) {
				return c.json({ message: error.message }, error.status);
			}

			throw error;
		}
	},

	async summary(c: BatchContext) {
		try {
			const id = parseBatchId(c.req.param('id') ?? '');
			const result = await getBatchSummaryService(createDb(c.env.DB), id);

			return c.json(result);
		} catch (error) {
			if (error instanceof BatchQueryError) {
				return c.json({ message: error.message }, error.status);
			}

			throw error;
		}
	},
};
