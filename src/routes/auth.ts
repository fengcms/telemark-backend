import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDb, type Db } from '../db';
import { users } from '../db/schema';

const ACCESS_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;
const LOCAL_DEV_JWT_SECRET = 'local-dev-change-me-before-production';

type AuthEnv = {
	Bindings: Env;
};

interface LoginRequestBody {
	username?: unknown;
	password?: unknown;
}

interface RefreshRequestBody {
	refreshToken?: unknown;
}

interface InitAdminRequestBody {
	username?: unknown;
	password?: unknown;
	realName?: unknown;
	phone?: unknown;
	remark?: unknown;
}

interface AccessTokenPayload {
	user_id: number;
	username: string;
	role: number;
}

interface RefreshSession {
	id: number;
	username: string;
	realName: string;
	role: number;
}

export interface InitializeAdminInput {
	username: string;
	frontendPasswordHash: string;
	realName: string;
	phone?: string;
	remark?: string;
}

export const authRoutes = new Hono<AuthEnv>();

authRoutes.post('/init-admin', async (c) => {
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

	const admin = await initializeAdminUser(createDb(c.env.DB), {
		username,
		frontendPasswordHash,
		realName,
		phone: normalizeOptionalString(body?.phone),
		remark: normalizeOptionalString(body?.remark),
	});

	return c.json({
		id: admin.id,
		username: admin.username,
		salt: admin.salt,
	});
});

authRoutes.post('/login', async (c) => {
	const body = await c.req.json<LoginRequestBody>().catch(() => null);
	const username = normalizeRequiredString(body?.username);
	const frontendPasswordHash = normalizeRequiredString(body?.password);

	if (!username || !frontendPasswordHash) {
		return c.json({ message: '用户名或密码错误' }, 401);
	}

	const db = createDb(c.env.DB);
	const user = await db.query.users.findFirst({
		where: eq(users.username, username),
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
		return c.json({ message: '用户名或密码错误' }, 401);
	}

	const passwordHash = await hashPasswordWithSalt(frontendPasswordHash, user.salt);

	if (!timingSafeEqual(passwordHash, user.passwordHash)) {
		return c.json({ message: '用户名或密码错误' }, 401);
	}

	const accessToken = await createAccessToken(
		{
			user_id: user.id,
			username: user.username,
			role: user.role,
		},
		c.env.JWT_SECRET,
	);
	const refreshToken = createRefreshToken();
	const session: RefreshSession = {
		id: user.id,
		username: user.username,
		realName: user.realName,
		role: user.role,
	};

	await c.env.c_kv.put(refreshToken, JSON.stringify(session), {
		expirationTtl: REFRESH_TOKEN_TTL_SECONDS,
		metadata: {
			userId: user.id,
			username: user.username,
			type: 'refresh_token',
		},
	});

	return c.json({
		accessToken,
		refreshToken,
		user: session,
	});
});

authRoutes.post('/refresh', async (c) => {
	const body = await c.req.json<RefreshRequestBody>().catch(() => null);
	const refreshToken = normalizeRequiredString(body?.refreshToken);

	if (!refreshToken) {
		return c.json({ message: 'refreshToken 无效，请重新登录' }, 403);
	}

	const session = await c.env.c_kv.get<RefreshSession>(refreshToken, 'json');

	if (!session) {
		return c.json({ message: '登录状态已失效，请重新登录' }, 403);
	}

	const accessToken = await createAccessToken(
		{
			user_id: session.id,
			username: session.username,
			role: session.role,
		},
		c.env.JWT_SECRET,
	);

	return c.json({ accessToken });
});

/**
 * 初始化第一位超级管理员。
 *
 * 传入的 frontendPasswordHash 应为前端已经计算过一次的 SHA-256 明文密码哈希。
 * 函数会生成随机 salt，再计算 SHA-256(frontendPasswordHash + salt)，并写入 users 表。
 */
export async function initializeAdminUser(
	db: Db,
	input: InitializeAdminInput,
): Promise<{ id: number; username: string; salt: string; passwordHash: string }> {
	const existing = await db.query.users.findFirst({
		where: eq(users.username, input.username),
		columns: { id: true, username: true, salt: true, passwordHash: true },
	});

	if (existing) {
		return existing;
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
			phone: input.phone,
			role: 1,
			status: 1,
			remark: input.remark ?? '初始化超级管理员',
		})
		.returning({
			id: users.id,
			username: users.username,
			salt: users.salt,
			passwordHash: users.passwordHash,
		});

	const admin = result[0];

	if (!admin) {
		throw new Error('初始化超级管理员失败');
	}

	return admin;
}

/**
 * 生成随机 salt，用于管理员初始化或后续创建员工账号。
 */
export function createSalt(): string {
	return randomBase64Url(16);
}

/**
 * 计算后端最终入库密码哈希：SHA-256(frontendPasswordHash + salt)。
 */
export async function hashPasswordWithSalt(frontendPasswordHash: string, salt: string): Promise<string> {
	return sha256Hex(`${frontendPasswordHash}${salt}`);
}

async function createAccessToken(payload: AccessTokenPayload, secret: string): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const header = {
		alg: 'HS256',
		typ: 'JWT',
	};
	const jwtPayload = {
		...payload,
		iat: now,
		exp: now + ACCESS_TOKEN_TTL_SECONDS,
	};
	const encodedHeader = base64UrlEncode(JSON.stringify(header));
	const encodedPayload = base64UrlEncode(JSON.stringify(jwtPayload));
	const signingInput = `${encodedHeader}.${encodedPayload}`;
	const signature = await hmacSha256Base64Url(signingInput, secret);

	return `${signingInput}.${signature}`;
}

function createRefreshToken(): string {
	return randomBase64Url(24);
}

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', bytes);

	return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256Base64Url(input: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));

	return bytesToBase64Url(new Uint8Array(signature));
}

function timingSafeEqual(left: string, right: string): boolean {
	const leftBytes = new TextEncoder().encode(left);
	const rightBytes = new TextEncoder().encode(right);
	const maxLength = Math.max(leftBytes.length, rightBytes.length);
	let diff = leftBytes.length ^ rightBytes.length;

	for (let i = 0; i < maxLength; i += 1) {
		diff |= (leftBytes[i] ?? 0) ^ (rightBytes[i] ?? 0);
	}

	return diff === 0;
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

function randomBase64Url(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);

	return bytesToBase64Url(bytes);
}

function base64UrlEncode(value: string): string {
	return bytesToBase64Url(new TextEncoder().encode(value));
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';

	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}
