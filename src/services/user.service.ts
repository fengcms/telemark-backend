import { eq, type SQL } from 'drizzle-orm';
import type { Db } from '@/db';
import { users } from '@/db/schema';
import { createSalt, hashPasswordWithSalt } from '@/utils/crypto';
import { handleListQuery, type ListQueryResult } from '@/utils/query-builder';

const USER_LIST_ALLOWED_FIELDS = ['id', 'username', 'realName', 'phone', 'role', 'status', 'remark', 'createdAt', 'updatedAt'] as const;

export interface UserActor {
	id: number;
	username: string;
	role: number;
}

export interface SafeUser {
	id: number;
	username: string;
	realName: string;
	phone: string | null;
	role: number;
	status: number;
	remark: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CreateUserInput {
	username: string;
	frontendPasswordHash: string;
	realName: string;
	phone?: string;
	role: number;
	remark?: string;
}

export interface UpdateUserInput {
	id: number;
	username?: string;
	frontendPasswordHash?: string;
	realName?: string;
	phone?: string | null;
	role?: number;
	status?: number;
	remark?: string | null;
}

export type CreateUserResult =
	| {
			ok: true;
			user: SafeUser;
	  }
	| {
			ok: false;
			status: 409;
			message: string;
	  };

export type UpdateUserResult =
	| {
			ok: true;
			user: SafeUser;
	  }
	| {
			ok: false;
			status: 404 | 409;
			message: string;
	  };

export type DeleteUserResult =
	| {
			ok: true;
			user: SafeUser;
	  }
	| {
			ok: false;
			status: 404;
			message: string;
	  };

export async function listActiveUsersService(
	db: Db,
	query: Record<string, string | string[] | undefined>,
): Promise<ListQueryResult<Pick<SafeUser, (typeof USER_LIST_ALLOWED_FIELDS)[number]>>> {
	const forcedConditions = resolveIsDisableCondition(query.is_disable);

	return handleListQuery(users, query, {
		db,
		allowedFields: USER_LIST_ALLOWED_FIELDS,
		defaultSortField: 'id',
		forcedConditions,
	});
}

export async function createUserService(db: Db, input: CreateUserInput): Promise<CreateUserResult> {
	const existing = await db.query.users.findFirst({
		where: eq(users.username, input.username),
		columns: { id: true },
	});

	if (existing) {
		return {
			ok: false,
			status: 409,
			message: '用户名已存在',
		};
	}

	const salt = createSalt();
	const passwordHash = await hashPasswordWithSalt(input.frontendPasswordHash, salt);
	const result = await db
		.insert(users)
		.values({
			username: input.username,
			passwordHash,
			salt,
			realName: input.realName,
			phone: normalizeNullableString(input.phone),
			role: input.role,
			status: 1,
			remark: normalizeNullableString(input.remark),
		})
		.returning(safeUserReturningFields);

	const user = result[0];

	if (!user) {
		throw new Error('创建员工失败');
	}

	return {
		ok: true,
		user,
	};
}

export async function updateUserService(db: Db, input: UpdateUserInput): Promise<UpdateUserResult> {
	const existing = await db.query.users.findFirst({
		where: eq(users.id, input.id),
		columns: { id: true, username: true },
	});

	if (!existing) {
		return {
			ok: false,
			status: 404,
			message: '员工不存在',
		};
	}

	if (input.username && input.username !== existing.username) {
		const duplicate = await db.query.users.findFirst({
			where: eq(users.username, input.username),
			columns: { id: true },
		});

		if (duplicate) {
			return {
				ok: false,
				status: 409,
				message: '用户名已存在',
			};
		}
	}

	const hasValidPassword = typeof input.frontendPasswordHash === 'string' && input.frontendPasswordHash.trim().length > 0;
	const credentials = hasValidPassword ? await createPasswordCredentials(input.frontendPasswordHash as string) : null;
	const updateData: Record<string, unknown> = {
		username: input.username,
		realName: input.realName,
		phone: input.phone,
		role: input.role,
		status: input.status,
		remark: input.remark,
		updatedAt: new Date().toISOString(),
	};

	if (credentials) {
		updateData.passwordHash = credentials.passwordHash;
		updateData.salt = credentials.salt;
	}

	const result = await db.update(users).set(updateData).where(eq(users.id, input.id)).returning(safeUserReturningFields);

	const user = result[0];

	if (!user) {
		throw new Error('更新员工失败');
	}

	return {
		ok: true,
		user,
	};
}

export async function disableUserService(db: Db, id: number): Promise<DeleteUserResult> {
	const result = await db
		.update(users)
		.set({
			status: 0,
			updatedAt: new Date().toISOString(),
		})
		.where(eq(users.id, id))
		.returning(safeUserReturningFields);

	const user = result[0];

	if (!user) {
		return {
			ok: false,
			status: 404,
			message: '员工不存在',
		};
	}

	return {
		ok: true,
		user,
	};
}

const safeUserReturningFields = {
	id: users.id,
	username: users.username,
	realName: users.realName,
	phone: users.phone,
	role: users.role,
	status: users.status,
	remark: users.remark,
	createdAt: users.createdAt,
	updatedAt: users.updatedAt,
};

async function createPasswordCredentials(frontendPasswordHash: string): Promise<{ passwordHash: string; salt: string }> {
	const salt = createSalt();
	const passwordHash = await hashPasswordWithSalt(frontendPasswordHash, salt);

	return {
		passwordHash,
		salt,
	};
}

function normalizeNullableString(value: string | undefined): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const normalized = value.trim();

	return normalized.length > 0 ? normalized : null;
}

function resolveIsDisableCondition(isDisable: string | string[] | undefined): SQL[] {
	const value = typeof isDisable === 'string' ? isDisable.trim() : '';

	if (value === '0') {
		return [eq(users.status, 1)];
	}

	if (value === '1') {
		return [eq(users.status, 0)];
	}

	return [eq(users.status, 1)];
}
