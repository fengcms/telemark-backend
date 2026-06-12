import type { Context } from 'hono';
import { createDb } from '@/db';
import { initializeAdminService, loginService, logoutService, refreshService } from '@/services/auth.service';

const LOCAL_DEV_JWT_SECRET = 'local-dev-change-me-before-production';

type AuthContext = Context<{ Bindings: Env }>;

interface LoginRequestBody {
	username?: unknown;
	password?: unknown;
}

interface RefreshRequestBody {
	refreshToken?: unknown;
}

interface LogoutRequestBody {
	refreshToken?: unknown;
}

interface InitAdminRequestBody {
	username?: unknown;
	password?: unknown;
	realName?: unknown;
	phone?: unknown;
	remark?: unknown;
}

export const authController = {
	async initAdmin(c: AuthContext) {
		if (c.env.JWT_SECRET !== LOCAL_DEV_JWT_SECRET) {
			return c.json({ message: '初始化接口仅允许本地开发环境使用' }, 403);
		}

		const body = await c.req.json<InitAdminRequestBody>().catch(() => null);
		const username = normalizeRequiredString(body?.username);
		const frontendPasswordHash = normalizeRequiredString(body?.password);
		const realName = normalizeRequiredString(body?.realName);

		if (!username || !frontendPasswordHash || !realName) {
			return c.json({ message: 'username、password、realName 不能为空' }, 400);
		}

		const result = await initializeAdminService(createAuthDeps(c), {
			username,
			frontendPasswordHash,
			realName,
			phone: normalizeOptionalString(body?.phone),
			remark: normalizeOptionalString(body?.remark),
		});

		if (!result.ok) {
			return c.json({ message: result.message }, result.status);
		}

		return c.json(result.admin);
	},

	async login(c: AuthContext) {
		const body = await c.req.json<LoginRequestBody>().catch(() => null);
		const username = normalizeRequiredString(body?.username);
		const frontendPasswordHash = normalizeRequiredString(body?.password);

		if (!username || !frontendPasswordHash) {
			return c.json({ message: '用户名或密码错误' }, 401);
		}

		const result = await loginService(createAuthDeps(c), {
			username,
			frontendPasswordHash,
		});

		if (!result.ok) {
			return c.json({ message: result.message }, result.status);
		}

		return c.json({
			accessToken: result.accessToken,
			refreshToken: result.refreshToken,
			user: result.user,
		});
	},

	async refresh(c: AuthContext) {
		const body = await c.req.json<RefreshRequestBody>().catch(() => null);
		const refreshToken = normalizeRequiredString(body?.refreshToken);

		if (!refreshToken) {
			return c.json({ message: 'refreshToken 无效，请重新登录' }, 403);
		}

		const result = await refreshService(createAuthDeps(c), { refreshToken });

		if (!result.ok) {
			return c.json({ message: result.message }, result.status);
		}

		return c.json({ accessToken: result.accessToken });
	},

	async logout(c: AuthContext) {
		const body = await c.req.json<LogoutRequestBody>().catch(() => null);
		const refreshToken = normalizeRequiredString(body?.refreshToken);

		if (!refreshToken) {
			return c.json({ message: 'refreshToken 不能为空' }, 400);
		}

		const result = await logoutService(createAuthDeps(c), { refreshToken });

		if (!result.ok) {
			return c.json({ message: result.message }, result.status);
		}

		return c.json({ ok: true });
	},
};

function createAuthDeps(c: AuthContext) {
	return {
		db: createDb(c.env.DB),
		kv: c.env.c_kv,
		jwtSecret: c.env.JWT_SECRET,
	};
}

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
