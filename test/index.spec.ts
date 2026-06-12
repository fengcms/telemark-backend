import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { createAccessToken } from "../src/utils/crypto";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("Hello World worker", () => {
	it("provides local D1 and KV bindings", async () => {
		const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();

		await env.c_kv.put("binding-smoke-test", "ok");
		const value = await env.c_kv.get("binding-smoke-test");
		await env.c_kv.delete("binding-smoke-test");

		expect(row?.ok).toBe(1);
		expect(value).toBe("ok");
	});

	it("responds with Hello World! (unit style)", async () => {
		const request = new IncomingRequest("http://example.com");
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
	});

	it("responds with Hello World! (integration style)", async () => {
		const response = await SELF.fetch("https://example.com");
		expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
	});

	it("reports health through Hono and Drizzle", async () => {
		const response = await SELF.fetch("https://example.com/health");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ok: true,
			database: true,
		});
	});

	it("initializes an admin, logs in, and refreshes the access token", async () => {
		await ensureUsersTable();

		const username = `admin_${crypto.randomUUID()}`;
		const password = await sha256Hex("local-password");

		const initResponse = await SELF.fetch("https://example.com/api/auth/init-admin", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				username,
				password,
				realName: "本地管理员",
			}),
		});

		expect(initResponse.status).toBe(200);

		const duplicateInitResponse = await SELF.fetch(
			"https://example.com/api/auth/init-admin",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					username: `admin_${crypto.randomUUID()}`,
					password,
					realName: "另一个管理员",
				}),
			},
		);

		expect(duplicateInitResponse.status).toBe(409);
		expect(await duplicateInitResponse.json()).toEqual({
			message: "系统已存在用户，禁止重复初始化管理员",
		});

		const loginResponse = await SELF.fetch("https://example.com/api/auth/login", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username, password }),
		});

		expect(loginResponse.status).toBe(200);

		const loginBody = await loginResponse.json<{
			accessToken: string;
			refreshToken: string;
			user: { id: number; username: string; realName: string; role: number };
		}>();

		expect(loginBody.accessToken.split(".")).toHaveLength(3);
		expect(loginBody.refreshToken).toHaveLength(32);
		expect(loginBody.user).toMatchObject({
			username,
			realName: "本地管理员",
			role: 1,
		});

		const refreshResponse = await SELF.fetch(
			"https://example.com/api/auth/refresh",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ refreshToken: loginBody.refreshToken }),
			},
		);

		expect(refreshResponse.status).toBe(200);
		expect(
			(await refreshResponse.json<{ accessToken: string }>()).accessToken.split(
				".",
			),
		).toHaveLength(3);
	});

	it("imports customers and assigns them with audit logs", async () => {
		await ensureCrmTables();

		const admin = await createTestUser("batch_admin", 1);
		const agent = await createTestUser("sales_agent", 3);
		const accessToken = await createAccessToken(
			{
				user_id: admin.id,
				username: admin.username,
				role: admin.role,
			},
			env.JWT_SECRET,
		);
		const createdEmployeeUsername = `api_sales_${crypto.randomUUID()}`;
		const createdEmployeePassword = await sha256Hex("employee-password");
		const createUserResponse = await SELF.fetch("https://example.com/api/users", {
			method: "POST",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				username: createdEmployeeUsername,
				password: createdEmployeePassword,
				realName: "接口创建员工",
				phone: "13900001111",
				role: 3,
				remark: "接口测试",
			}),
		});

		expect(createUserResponse.status).toBe(200);
		const createdEmployee = await createUserResponse.json<{
			id: number;
			username: string;
			realName: string;
			role: number;
			passwordHash?: string;
			salt?: string;
		}>();

		expect(createdEmployee).toMatchObject({
			username: createdEmployeeUsername,
			realName: "接口创建员工",
			role: 3,
		});
		expect(createdEmployee.passwordHash).toBeUndefined();
		expect(createdEmployee.salt).toBeUndefined();

		const usersResponse = await SELF.fetch(
			"https://example.com/api/users?page=0&pagesize=20&role=3",
			{
				headers: {
					authorization: `Bearer ${accessToken}`,
				},
			},
		);

		expect(usersResponse.status).toBe(200);
		const usersBody = await usersResponse.json<{
			total: number;
			list: Array<{ id: number; username: string; passwordHash?: string; salt?: string }>;
		}>();

		expect(usersBody.total).toBeGreaterThanOrEqual(1);
		expect(usersBody.list.some((item) => item.username === createdEmployeeUsername)).toBe(true);
		expect(usersBody.list.every((item) => item.passwordHash === undefined && item.salt === undefined)).toBe(true);

		const phone = `139${String(Date.now()).slice(-8)}`;
		const importResponse = await SELF.fetch(
			"https://example.com/api/batches/import",
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					name: "测试批次",
					source: "curl-test",
					cost: 100,
					customers: [
						{ phone, name: "客户A", company: "公司A" },
						{ phone, name: "客户A重复", company: "公司A" },
					],
				}),
			},
		);

		expect(importResponse.status).toBe(200);
		const importBody = await importResponse.json<{
			batchId: number;
			importedCount: number;
			skippedDuplicateCount: number;
		}>();

		expect(importBody.importedCount).toBe(1);
		expect(importBody.skippedDuplicateCount).toBe(1);

		const listResponse = await SELF.fetch(
			`https://example.com/api/customers?phone-like=${phone.slice(0, 6)}&sort=-id&page=0&pagesize=10`,
			{
				headers: {
					authorization: `Bearer ${accessToken}`,
				},
			},
		);

		expect(listResponse.status).toBe(200);
		const listBody = await listResponse.json<{
			page: number;
			pageSize: number;
			total: number;
			list: Array<{ id: number; phone: string; name: string; company: string }>;
		}>();

		expect(listBody.page).toBe(0);
		expect(listBody.pageSize).toBe(10);
		expect(listBody.total).toBeGreaterThanOrEqual(1);
		expect(listBody.list.some((item) => item.phone === phone)).toBe(true);

		const customer = await env.DB.prepare("SELECT id FROM customers WHERE phone = ?")
			.bind(phone)
			.first<{ id: number }>();

		expect(customer?.id).toBeTypeOf("number");

		const assignResponse = await SELF.fetch(
			"https://example.com/api/customers/assign",
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					customerIds: [customer?.id],
					targetUserId: agent.id,
					reason: "首次分配",
				}),
			},
		);

		expect(assignResponse.status).toBe(200);
		expect(await assignResponse.json()).toEqual({
			updatedCount: 1,
			loggedCount: 1,
		});

		const agentAccessToken = await createAccessToken(
			{
				user_id: agent.id,
				username: agent.username,
				role: agent.role,
			},
			env.JWT_SECRET,
		);
		const myCustomersResponse = await SELF.fetch(
			"https://example.com/api/my-customers?page=0&pagesize=10",
			{
				headers: {
					authorization: `Bearer ${agentAccessToken}`,
				},
			},
		);

		expect(myCustomersResponse.status).toBe(200);
		const myCustomersBody = await myCustomersResponse.json<{
			total: number;
			list: Array<{ id: number; ownerId: number; status: number }>;
		}>();

		expect(myCustomersBody.total).toBeGreaterThanOrEqual(1);
		expect(myCustomersBody.list.some((item) => item.id === customer?.id && item.ownerId === agent.id && item.status === 0)).toBe(true);

		const assignmentLog = await env.DB.prepare(
			"SELECT from_user_id, to_user_id, operator_id, remark FROM assignment_logs WHERE customer_id = ?",
		)
			.bind(customer?.id)
			.first<{
				from_user_id: number | null;
				to_user_id: number;
				operator_id: number;
				remark: string;
			}>();

		expect(assignmentLog).toEqual({
			from_user_id: null,
			to_user_id: agent.id,
			operator_id: admin.id,
			remark: "首次分配",
		});

		const reportResponse = await SELF.fetch(
			"https://example.com/api/calls/report",
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${agentAccessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					customerId: customer?.id,
					duration: 66,
					callResult: 1,
					callRemark: "客户已接听，意向明确",
				}),
			},
		);

		expect(reportResponse.status).toBe(200);
		expect(await reportResponse.json()).toMatchObject({
			ok: true,
			customerId: customer?.id,
			userId: agent.id,
		});

		const updatedCustomer = await env.DB.prepare(
			"SELECT status, type, remark FROM customers WHERE id = ?",
		)
			.bind(customer?.id)
			.first<{ status: number; type: number; remark: string }>();

		expect(updatedCustomer).toEqual({
			status: 1,
			type: 1,
			remark: "客户已接听，意向明确",
		});

		const callLog = await env.DB.prepare(
			"SELECT customer_id, user_id, duration, call_result, call_remark FROM call_logs WHERE customer_id = ?",
		)
			.bind(customer?.id)
			.first<{
				customer_id: number;
				user_id: number;
				duration: number;
				call_result: number;
				call_remark: string;
			}>();

		expect(callLog).toEqual({
			customer_id: customer?.id,
			user_id: agent.id,
			duration: 66,
			call_result: 1,
			call_remark: "客户已接听，意向明确",
		});

		const summary = await env.DB.prepare(
			"SELECT total_calls, connected_calls, total_duration FROM agent_daily_summaries WHERE user_id = ?",
		)
			.bind(agent.id)
			.first<{
				total_calls: number;
				connected_calls: number;
				total_duration: number;
			}>();

		expect(summary).toEqual({
			total_calls: 1,
			connected_calls: 1,
			total_duration: 66,
		});
	});
});

async function ensureUsersTable(): Promise<void> {
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, real_name TEXT NOT NULL, phone TEXT, role INTEGER NOT NULL DEFAULT 3, status INTEGER NOT NULL DEFAULT 1, remark TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);",
	);
}

async function ensureCrmTables(): Promise<void> {
	await runSqlStatements([
		"CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, real_name TEXT NOT NULL, phone TEXT, role INTEGER NOT NULL DEFAULT 3, status INTEGER NOT NULL DEFAULT 1, remark TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
		"CREATE TABLE IF NOT EXISTS batches (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, source TEXT, cost INTEGER NOT NULL DEFAULT 0, total_count INTEGER NOT NULL DEFAULT 0, creator_id INTEGER NOT NULL, remark TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(creator_id) REFERENCES users(id))",
		"CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL UNIQUE, name TEXT, company TEXT, type INTEGER NOT NULL DEFAULT 0, status INTEGER NOT NULL DEFAULT 0, remark TEXT, owner_id INTEGER, batch_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(owner_id) REFERENCES users(id), FOREIGN KEY(batch_id) REFERENCES batches(id))",
		"CREATE TABLE IF NOT EXISTS assignment_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, from_user_id INTEGER, to_user_id INTEGER, operator_id INTEGER NOT NULL, action INTEGER NOT NULL, remark TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(from_user_id) REFERENCES users(id), FOREIGN KEY(to_user_id) REFERENCES users(id), FOREIGN KEY(operator_id) REFERENCES users(id))",
		"CREATE TABLE IF NOT EXISTS call_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, user_id INTEGER NOT NULL, call_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, duration INTEGER NOT NULL DEFAULT 0, call_result INTEGER NOT NULL, call_remark TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(user_id) REFERENCES users(id))",
		"CREATE TABLE IF NOT EXISTS agent_daily_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL, first_call_time TEXT, last_call_time TEXT, total_calls INTEGER NOT NULL DEFAULT 0, connected_calls INTEGER NOT NULL DEFAULT 0, total_duration INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))",
		"CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_daily_summaries_user_id_date ON agent_daily_summaries(user_id, date)",
	]);
}

async function runSqlStatements(statements: string[]): Promise<void> {
	for (const statement of statements) {
		await env.DB.prepare(statement).run();
	}
}

async function createTestUser(
	usernamePrefix: string,
	role: number,
): Promise<{ id: number; username: string; role: number }> {
	const username = `${usernamePrefix}_${crypto.randomUUID()}`;
	const result = await env.DB.prepare(
		"INSERT INTO users (username, password_hash, salt, real_name, role, status) VALUES (?, ?, ?, ?, ?, 1) RETURNING id, username, role",
	)
		.bind(username, "hash", "salt", username, role)
		.first<{ id: number; username: string; role: number }>();

	if (!result) {
		throw new Error("创建测试用户失败");
	}

	return result;
}

async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(input),
	);

	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
