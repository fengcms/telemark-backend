const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface AccessTokenPayload {
	user_id: number;
	username: string;
	role: number;
}

export interface VerifiedAccessTokenPayload extends AccessTokenPayload {
	iat: number;
	exp: number;
}

/**
 * 生成随机 salt，用于创建用户密码凭证。
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

/**
 * 在不使用 Node.js crypto 的前提下进行常量时间字符串比对。
 */
export function timingSafeEqual(left: string, right: string): boolean {
	const leftBytes = new TextEncoder().encode(left);
	const rightBytes = new TextEncoder().encode(right);
	const maxLength = Math.max(leftBytes.length, rightBytes.length);
	let diff = leftBytes.length ^ rightBytes.length;

	for (let i = 0; i < maxLength; i += 1) {
		diff |= (leftBytes[i] ?? 0) ^ (rightBytes[i] ?? 0);
	}

	return diff === 0;
}

/**
 * 使用 Web Crypto HMAC-SHA256 签发 15 分钟有效期的 AccessToken。
 */
export async function createAccessToken(payload: AccessTokenPayload, secret: string): Promise<string> {
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

/**
 * 验证 AccessToken 的签名和过期时间，验证失败返回 null。
 */
export async function verifyAccessToken(token: string, secret: string): Promise<VerifiedAccessTokenPayload | null> {
	const parts = token.split('.');

	if (parts.length !== 3) {
		return null;
	}

	const [encodedHeader, encodedPayload, signature] = parts;
	const signingInput = `${encodedHeader}.${encodedPayload}`;
	const expectedSignature = await hmacSha256Base64Url(signingInput, secret);

	if (!timingSafeEqual(signature, expectedSignature)) {
		return null;
	}

	const payload = parseJwtPayload(encodedPayload);

	if (!payload) {
		return null;
	}

	const now = Math.floor(Date.now() / 1000);

	if (payload.exp <= now) {
		return null;
	}

	return payload;
}

/**
 * 生成 32 位高强度随机 RefreshToken。
 */
export function createRefreshToken(): string {
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

function randomBase64Url(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);

	return bytesToBase64Url(bytes);
}

function base64UrlEncode(value: string): string {
	return bytesToBase64Url(new TextEncoder().encode(value));
}

function parseJwtPayload(encodedPayload: string): VerifiedAccessTokenPayload | null {
	try {
		const parsed = JSON.parse(base64UrlDecodeToString(encodedPayload)) as Partial<VerifiedAccessTokenPayload>;

		if (
			typeof parsed.user_id !== 'number' ||
			typeof parsed.username !== 'string' ||
			typeof parsed.role !== 'number' ||
			typeof parsed.iat !== 'number' ||
			typeof parsed.exp !== 'number'
		) {
			return null;
		}

		return {
			user_id: parsed.user_id,
			username: parsed.username,
			role: parsed.role,
			iat: parsed.iat,
			exp: parsed.exp,
		};
	} catch {
		return null;
	}
}

function base64UrlDecodeToString(value: string): string {
	const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
	const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}

	return new TextDecoder().decode(bytes);
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
