import type { Context } from 'hono';
import { createDb } from '@/db';
import { createUserService, disableUserService, listActiveUsersService, type UserActor, updateUserService } from '@/services/user.service';

type UserContext = Context<{
	Bindings: Env;
	Variables: {
		currentUser: UserActor;
	};
}>;

interface CreateUserRequestBody {
	username?: unknown;
	password?: unknown;
	realName?: unknown;
	phone?: unknown;
	role?: unknown;
	remark?: unknown;
}

interface UpdateUserRequestBody {
	username?: unknown;
	password?: unknown;
	realName?: unknown;
	phone?: unknown;
	role?: unknown;
	status?: unknown;
	remark?: unknown;
}

export const userController = {
	async listUsers(c: UserContext) {
		const result = await listActiveUsersService(createDb(c.env.DB), c.req.query());

		return c.json(result);
	},

	async createUser(c: UserContext) {
		const body = await c.req.json<CreateUserRequestBody>().catch(() => null);
		const username = normalizeRequiredString(body?.username);
		const frontendPasswordHash = normalizeRequiredString(body?.password);
		const realName = normalizeRequiredString(body?.realName);
		const role = normalizeRole(body?.role);

		if (!username || !frontendPasswordHash || !realName || role === null) {
			return c.json({ message: '参数错误：username、password、realName、role 不合法' }, 400);
		}

		const result = await createUserService(createDb(c.env.DB), {
			username,
			frontendPasswordHash,
			realName,
			phone: normalizeOptionalString(body?.phone),
			role,
			remark: normalizeOptionalString(body?.remark),
		});

		if (!result.ok) {
			return c.json({ message: result.message }, result.status);
		}

		return c.json(result.user);
	},

	async updateUser(c: UserContext) {
		const id = normalizePositiveInteger(c.req.param('id'));

		if (id === null) {
			return c.json({ message: '参数错误：员工 ID 不合法' }, 400);
		}

		const body = await c.req.json<UpdateUserRequestBody>().catch(() => null);
		const username = normalizeOptionalString(body?.username);
		const frontendPasswordHash = normalizeOptionalString(body?.password);
		const realName = normalizeOptionalString(body?.realName);
		const phone = normalizeNullableString(body?.phone);
		const role = normalizeOptionalRole(body?.role);
		const status = normalizeOptionalStatus(body?.status);
		const remark = normalizeNullableString(body?.remark);

		if ((body?.role !== undefined && role === undefined) || (body?.status !== undefined && status === undefined)) {
			return c.json({ message: '参数错误：role 或 status 不合法' }, 400);
		}

		const result = await updateUserService(createDb(c.env.DB), {
			id,
			username,
			frontendPasswordHash,
			realName,
			phone,
			role,
			status,
			remark,
		});

		if (!result.ok) {
			return c.json({ message: result.message }, result.status);
		}

		return c.json(result.user);
	},

	async deleteUser(c: UserContext) {
		const id = normalizePositiveInteger(c.req.param('id'));

		if (id === null) {
			return c.json({ message: '参数错误：员工 ID 不合法' }, 400);
		}

		if (id === c.get('currentUser').id) {
			return c.json({ message: '不能禁用当前登录管理员账号' }, 400);
		}

		const result = await disableUserService(createDb(c.env.DB), id);

		if (!result.ok) {
			return c.json({ message: result.message }, result.status);
		}

		return c.json(result.user);
	},
};

function normalizeRequiredString(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const normalized = value.trim();

	return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalString(value: unknown): string | undefined {
	return normalizeRequiredString(value) ?? undefined;
}

function normalizeNullableString(value: unknown): string | null | undefined {
	if (value === null) {
		return null;
	}

	return normalizeOptionalString(value);
}

function normalizeRole(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 3) {
		return null;
	}

	return value;
}

function normalizeOptionalRole(value: unknown): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	return normalizeRole(value) ?? undefined;
}

function normalizeOptionalStatus(value: unknown): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	return value === 0 || value === 1 ? value : undefined;
}

function normalizePositiveInteger(value: unknown): number | null {
	const parsed = typeof value === 'string' ? Number(value) : value;

	if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed <= 0) {
		return null;
	}

	return parsed;
}
