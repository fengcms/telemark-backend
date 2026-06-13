import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { users } from '@/db/schema';
import { createAccessToken, createRefreshToken, createSalt, hashPasswordWithSalt, timingSafeEqual } from '@/utils/crypto';

const REFRESH_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;

export interface AuthServiceDeps {
	db: Db;
	kv: KVNamespace;
	jwtSecret: string;
}

export interface LoginInput {
	username: string;
	frontendPasswordHash: string;
}

export interface RefreshInput {
	refreshToken: string;
}

export interface LogoutInput {
	refreshToken: string;
}

export interface ChangePasswordInput {
	userId: number;
	oldFrontendPasswordHash: string;
	newFrontendPasswordHash: string;
}

export type LogoutResult =
	| {
			ok: true;
	  }
	| {
			ok: false;
			status: 403;
			message: string;
	  };

export type ChangePasswordResult =
	| {
			ok: true;
	  }
	| {
			ok: false;
			status: 401;
			message: string;
	  };

export interface InitializeAdminInput {
	username: string;
	frontendPasswordHash: string;
	realName: string;
	phone?: string;
	remark?: string;
}

export interface AuthUser {
	id: number;
	username: string;
	realName: string;
	role: number;
}

export type LoginResult =
	| {
			ok: true;
			accessToken: string;
			refreshToken: string;
			user: AuthUser;
	  }
	| {
			ok: false;
			status: 401;
			message: string;
	  };

export type RefreshResult =
	| {
			ok: true;
			accessToken: string;
	  }
	| {
			ok: false;
			status: 403;
			message: string;
	  };

export interface InitializeAdminResult {
	id: number;
	username: string;
	salt: string;
}

export type InitializeAdminServiceResult =
	| {
			ok: true;
			admin: InitializeAdminResult;
	  }
	| {
			ok: false;
			status: 409;
			message: string;
	  };

interface RefreshSession extends AuthUser {}

export async function loginService(deps: AuthServiceDeps, input: LoginInput): Promise<LoginResult> {
	const user = await deps.db.query.users.findFirst({
		where: eq(users.username, input.username),
		columns: {
			id: true,
			username: true,
			passwordHash: true,
			salt: true,
			realName: true,
			role: true,
			status: true,
		},
	});

	if (!user || user.status === 0) {
		return {
			ok: false,
			status: 401,
			message: '用户名或密码错误',
		};
	}

	const passwordHash = await hashPasswordWithSalt(input.frontendPasswordHash, user.salt);

	if (!timingSafeEqual(passwordHash, user.passwordHash)) {
		return {
			ok: false,
			status: 401,
			message: '用户名或密码错误',
		};
	}

	const authUser: AuthUser = {
		id: user.id,
		username: user.username,
		realName: user.realName,
		role: user.role,
	};
	const accessToken = await createAccessToken(
		{
			user_id: authUser.id,
			username: authUser.username,
			role: authUser.role,
		},
		deps.jwtSecret,
	);
	const refreshToken = createRefreshToken();

	await deps.kv.put(refreshToken, JSON.stringify(authUser), {
		expirationTtl: REFRESH_TOKEN_TTL_SECONDS,
		metadata: {
			userId: authUser.id,
			username: authUser.username,
			type: 'refresh_token',
		},
	});

	return {
		ok: true,
		accessToken,
		refreshToken,
		user: authUser,
	};
}

export async function refreshService(deps: AuthServiceDeps, input: RefreshInput): Promise<RefreshResult> {
	const session = await deps.kv.get<RefreshSession>(input.refreshToken, 'json');

	if (!session) {
		return {
			ok: false,
			status: 403,
			message: '登录状态已失效，请重新登录',
		};
	}

	const user = await deps.db.query.users.findFirst({
		where: eq(users.id, session.id),
		columns: {
			id: true,
			username: true,
			role: true,
			status: true,
		},
	});

	if (user?.status !== 1) {
		await deps.kv.delete(input.refreshToken);

		return {
			ok: false,
			status: 403,
			message: '登录状态已失效，请重新登录',
		};
	}

	const accessToken = await createAccessToken(
		{
			user_id: user.id,
			username: user.username,
			role: user.role,
		},
		deps.jwtSecret,
	);

	return {
		ok: true,
		accessToken,
	};
}

export async function logoutService(deps: AuthServiceDeps, input: LogoutInput): Promise<LogoutResult> {
	const session = await deps.kv.get<RefreshSession>(input.refreshToken, 'json');

	if (!session) {
		return {
			ok: false,
			status: 403,
			message: 'refreshToken 无效或已过期',
		};
	}

	await deps.kv.delete(input.refreshToken);

	return {
		ok: true,
	};
}

export async function changePasswordService(deps: AuthServiceDeps, input: ChangePasswordInput): Promise<ChangePasswordResult> {
	const user = await deps.db.query.users.findFirst({
		where: eq(users.id, input.userId),
		columns: {
			id: true,
			passwordHash: true,
			salt: true,
			status: true,
		},
	});

	if (!user || user.status === 0) {
		return {
			ok: false,
			status: 401,
			message: '用户不存在或已被禁用',
		};
	}

	const oldPasswordHash = await hashPasswordWithSalt(input.oldFrontendPasswordHash, user.salt);

	if (!timingSafeEqual(oldPasswordHash, user.passwordHash)) {
		return {
			ok: false,
			status: 401,
			message: '旧密码错误',
		};
	}

	const newSalt = createSalt();
	const newPasswordHash = await hashPasswordWithSalt(input.newFrontendPasswordHash, newSalt);

	await deps.db
		.update(users)
		.set({
			passwordHash: newPasswordHash,
			salt: newSalt,
			updatedAt: new Date().toISOString(),
		})
		.where(eq(users.id, input.userId));

	return {
		ok: true,
	};
}

export async function initializeAdminService(deps: AuthServiceDeps, input: InitializeAdminInput): Promise<InitializeAdminServiceResult> {
	const existingUser = await deps.db.query.users.findFirst({
		columns: { id: true },
	});

	if (existingUser) {
		return {
			ok: false,
			status: 409,
			message: '系统已存在用户，禁止重复初始化管理员',
		};
	}

	const existingSuperAdmin = await deps.db.query.users.findFirst({
		where: eq(users.role, 1),
		columns: { id: true },
	});

	if (existingSuperAdmin) {
		return {
			ok: false,
			status: 409,
			message: '系统已存在超级管理员，禁止重复初始化',
		};
	}

	const salt = createSalt();
	const passwordHash = await hashPasswordWithSalt(input.frontendPasswordHash, salt);
	const result = await deps.db
		.insert(users)
		.values({
			username: input.username,
			passwordHash,
			salt,
			realName: input.realName,
			phone: input.phone,
			role: 1,
			status: 1,
			remark: input.remark ?? '初始化超级管理员',
		})
		.returning({
			id: users.id,
			username: users.username,
			salt: users.salt,
		});

	const admin = result[0];

	if (!admin) {
		throw new Error('初始化超级管理员失败');
	}

	return {
		ok: true,
		admin,
	};
}
