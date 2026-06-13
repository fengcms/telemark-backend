import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { createAccessToken, createSalt, hashPasswordWithSalt } from "../src/utils/crypto";

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

	it("rejects disabled users for login, old access tokens, and refresh tokens", async () => {
		await ensureCrmTables();

		const account = await createLoginUser("disable_flow", 3);

		const loginResponse = await SELF.fetch("https://example.com/api/auth/login", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: account.username, password: account.frontendPasswordHash }),
		});

		expect(loginResponse.status).toBe(200);
		const loginBody = await loginResponse.json<{ accessToken: string; refreshToken: string }>();

		await setUserStatus(account.id, 0);

		const disabledLoginResponse = await SELF.fetch("https://example.com/api/auth/login", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: account.username, password: account.frontendPasswordHash }),
		});

		expect(disabledLoginResponse.status).toBe(401);

		const oldAccessResponse = await SELF.fetch("https://example.com/api/my-summary", {
			headers: { authorization: `Bearer ${loginBody.accessToken}` },
		});

		expect(oldAccessResponse.status).toBe(401);

		const disabledRefreshResponse = await SELF.fetch("https://example.com/api/auth/refresh", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ refreshToken: loginBody.refreshToken }),
		});

		expect(disabledRefreshResponse.status).toBe(403);

		await setUserStatus(account.id, 1);

		const restoredLoginResponse = await SELF.fetch("https://example.com/api/auth/login", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ username: account.username, password: account.frontendPasswordHash }),
		});

		expect(restoredLoginResponse.status).toBe(200);

		const oldRefreshAfterRestoreResponse = await SELF.fetch("https://example.com/api/auth/refresh", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ refreshToken: loginBody.refreshToken }),
		});

		expect(oldRefreshAfterRestoreResponse.status).toBe(403);
	});

	it("enforces role permissions through protected routes", async () => {
		await ensureCrmTables();

		const admin = await createTestUser("role_admin", 1);
		const manager = await createTestUser("role_manager", 2);
		const employee = await createTestUser("role_employee", 3);
		const adminToken = await tokenFor(admin);
		const managerToken = await tokenFor(manager);
		const employeeToken = await tokenFor(employee);

		const adminUsersResponse = await SELF.fetch("https://example.com/api/users", {
			headers: { authorization: `Bearer ${adminToken}` },
		});

		expect(adminUsersResponse.status).toBe(200);

		const managerCreateUserResponse = await SELF.fetch("https://example.com/api/users", {
			method: "POST",
			headers: {
				authorization: `Bearer ${managerToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				username: `blocked_${crypto.randomUUID()}`,
				password: await sha256Hex("blocked-password"),
				realName: "越权创建",
				role: 3,
			}),
		});

		expect(managerCreateUserResponse.status).toBe(403);

		const employeeCustomersResponse = await SELF.fetch("https://example.com/api/customers", {
			headers: { authorization: `Bearer ${employeeToken}` },
		});
		const employeeUsersResponse = await SELF.fetch("https://example.com/api/users", {
			headers: { authorization: `Bearer ${employeeToken}` },
		});

		expect(employeeCustomersResponse.status).toBe(403);
		expect(employeeUsersResponse.status).toBe(403);
	});

	it("validates assignment target status and role", async () => {
		await ensureCrmTables();

		const admin = await createTestUser("assign_admin", 1);
		const manager = await createTestUser("assign_manager", 2);
		const employee = await createTestUser("assign_employee", 3);
		const disabledEmployee = await createTestUser("assign_disabled", 3);
		const superAdminTarget = await createTestUser("assign_super", 1);
		const adminToken = await tokenFor(admin);
		const customer = await createCustomer(admin.id, null);

		await setUserStatus(disabledEmployee.id, 0);

		await expectAssign(adminToken, customer.id, manager.id, 200);
		await expectAssign(adminToken, customer.id, employee.id, 200);
		await expectAssign(adminToken, customer.id, disabledEmployee.id, 400);
		await expectAssign(adminToken, customer.id, superAdminTarget.id, 400);
		await expectAssign(adminToken, customer.id, null, 200);
	});

	it("enforces customer ownership for call reporting", async () => {
		await ensureCrmTables();

		const admin = await createTestUser("call_admin", 1);
		const manager = await createTestUser("call_manager", 2);
		const employee = await createTestUser("call_employee", 3);
		const otherEmployee = await createTestUser("call_other", 3);
		const employeeToken = await tokenFor(employee);
		const managerToken = await tokenFor(manager);
		const adminToken = await tokenFor(admin);
		const ownedCustomer = await createCustomer(admin.id, employee.id);
		const otherCustomer = await createCustomer(admin.id, otherEmployee.id);
		const publicCustomer = await createCustomer(admin.id, null);
		const managerCustomer = await createCustomer(admin.id, manager.id);

		expect(await reportCallStatus(employeeToken, ownedCustomer.id)).toBe(200);
		expect(await reportCallStatus(employeeToken, otherCustomer.id)).toBe(403);
		expect(await reportCallStatus(employeeToken, publicCustomer.id)).toBe(403);
		expect(await reportCallStatus(managerToken, managerCustomer.id)).toBe(200);
		expect(await reportCallStatus(managerToken, ownedCustomer.id)).toBe(403);
		expect(await reportCallStatus(adminToken, ownedCustomer.id)).toBe(403);
	});

	it("serves dashboard overview only to admins and managers with correct metrics", async () => {
		await ensureCrmTables();

		const date = "2026-06-13";
		const emptyDate = "2099-01-01";
		const admin = await createTestUser("dashboard_overview_admin", 1);
		const manager = await createTestUser("dashboard_overview_manager", 2);
		const employee = await createTestUser("dashboard_overview_employee", 3);
		const adminToken = await tokenFor(admin);
		const managerToken = await tokenFor(manager);
		const employeeToken = await tokenFor(employee);
		const calledCustomer = await createCustomer(admin.id, employee.id);
		const secondCalledCustomer = await createCustomer(admin.id, manager.id);
		const intentCustomer = await createCustomer(admin.id, manager.id);

		await setCustomerType(intentCustomer.id, 1);
		await insertDailySummary(employee.id, date, {
			totalCalls: 10,
			connectedCalls: 5,
			totalDuration: 100,
			firstCallTime: "2026-06-13T01:00:00.000Z",
			lastCallTime: "2026-06-13T02:00:00.000Z",
		});
		await insertDailySummary(manager.id, date, {
			totalCalls: 0,
			connectedCalls: 0,
			totalDuration: 0,
			firstCallTime: null,
			lastCallTime: null,
		});
		await insertCallLog(calledCustomer.id, employee.id, "2026-06-12T16:30:00.000Z");
		await insertCallLog(calledCustomer.id, employee.id, "2026-06-12T17:30:00.000Z");
		await insertCallLog(secondCalledCustomer.id, manager.id, "2026-06-13T15:59:59.000Z");
		await insertCallLog(secondCalledCustomer.id, manager.id, "2026-06-13T16:00:00.000Z");

		const unauthenticatedResponse = await SELF.fetch(`https://example.com/api/dashboard/overview?date=${date}`);
		const employeeResponse = await SELF.fetch(`https://example.com/api/dashboard/overview?date=${date}`, {
			headers: { authorization: `Bearer ${employeeToken}` },
		});
		const adminResponse = await SELF.fetch(`https://example.com/api/dashboard/overview?date=${date}`, {
			headers: { authorization: `Bearer ${adminToken}` },
		});
		const managerResponse = await SELF.fetch(`https://example.com/api/dashboard/overview?date=${date}`, {
			headers: { authorization: `Bearer ${managerToken}` },
		});
		const emptyResponse = await SELF.fetch(`https://example.com/api/dashboard/overview?date=${emptyDate}`, {
			headers: { authorization: `Bearer ${adminToken}` },
		});
		const invalidDateResponse = await SELF.fetch("https://example.com/api/dashboard/overview?date=2026-99-99", {
			headers: { authorization: `Bearer ${adminToken}` },
		});

		expect(unauthenticatedResponse.status).toBe(401);
		expect(employeeResponse.status).toBe(403);
		expect(adminResponse.status).toBe(200);
		expect(managerResponse.status).toBe(200);
		expect(await adminResponse.json()).toMatchObject({
			date,
			totalCalls: 10,
			connectedCalls: 5,
			totalDuration: 100,
			avgDuration: 20,
			connectRate: 0.5,
			activeAgents: 1,
			newCalledCustomers: 2,
		});

		const managerBody = await managerResponse.json<{ intentCustomers: number }>();
		expect(managerBody.intentCustomers).toBeGreaterThanOrEqual(1);
		expect(await emptyResponse.json()).toEqual({
			date: emptyDate,
			totalCalls: 0,
			connectedCalls: 0,
			totalDuration: 0,
			avgDuration: 0,
			connectRate: 0,
			activeAgents: 0,
			intentCustomers: 0,
			newCalledCustomers: 0,
		});
		expect(invalidDateResponse.status).toBe(400);
	});

	it("serves dashboard agent daily ranking with pagination and safe sorting", async () => {
		await ensureCrmTables();

		const date = "2026-06-14";
		const admin = await createTestUser("dashboard_daily_admin", 1);
		const manager = await createTestUser("dashboard_daily_manager", 2);
		const employee = await createTestUser("dashboard_daily_employee", 3);
		const highCaller = await createTestUser("dashboard_daily_high", 3);
		const zeroConnected = await createTestUser("dashboard_daily_zero", 3);
		const adminToken = await tokenFor(admin);
		const managerToken = await tokenFor(manager);
		const employeeToken = await tokenFor(employee);

		await insertDailySummary(highCaller.id, date, {
			totalCalls: 20,
			connectedCalls: 10,
			totalDuration: 300,
			firstCallTime: "2026-06-14T01:00:00.000Z",
			lastCallTime: "2026-06-14T03:00:00.000Z",
		});
		await insertDailySummary(zeroConnected.id, date, {
			totalCalls: 5,
			connectedCalls: 0,
			totalDuration: 0,
			firstCallTime: null,
			lastCallTime: null,
		});
		await insertDailySummary(manager.id, date, {
			totalCalls: 0,
			connectedCalls: 0,
			totalDuration: 0,
			firstCallTime: null,
			lastCallTime: null,
		});

		const unauthenticatedResponse = await SELF.fetch(`https://example.com/api/dashboard/agent-daily?date=${date}`);
		const employeeResponse = await SELF.fetch(`https://example.com/api/dashboard/agent-daily?date=${date}`, {
			headers: { authorization: `Bearer ${employeeToken}` },
		});
		const adminResponse = await SELF.fetch(`https://example.com/api/dashboard/agent-daily?date=${date}&page=0&pagesize=2`, {
			headers: { authorization: `Bearer ${adminToken}` },
		});
		const managerResponse = await SELF.fetch(
			`https://example.com/api/dashboard/agent-daily?date=${date}&userId=${zeroConnected.id}&sort=-totalCalls`,
			{
				headers: { authorization: `Bearer ${managerToken}` },
			},
		);
		const invalidSortResponse = await SELF.fetch(`https://example.com/api/dashboard/agent-daily?date=${date}&sort=-passwordHash`, {
			headers: { authorization: `Bearer ${adminToken}` },
		});

		expect(unauthenticatedResponse.status).toBe(401);
		expect(employeeResponse.status).toBe(403);
		expect(adminResponse.status).toBe(200);
		expect(managerResponse.status).toBe(200);
		expect(invalidSortResponse.status).toBe(400);

		const adminBody = await adminResponse.json<{
			page: number;
			pageSize: number;
			total: number;
			list: Array<{ userId: number; totalCalls: number; avgDuration: number; connectRate: number; passwordHash?: string; salt?: string }>;
		}>();
		expect(adminBody.page).toBe(0);
		expect(adminBody.pageSize).toBe(2);
		expect(adminBody.total).toBe(3);
		expect(adminBody.list).toHaveLength(2);
		expect(adminBody.list[0].userId).toBe(highCaller.id);
		expect(adminBody.list[0]).toMatchObject({
			totalCalls: 20,
			avgDuration: 30,
			connectRate: 0.5,
		});
		expect(adminBody.list.every((item) => item.passwordHash === undefined && item.salt === undefined)).toBe(true);

		const managerBody = await managerResponse.json<{
			list: Array<{ userId: number; avgDuration: number; connectRate: number; passwordHash?: string; salt?: string }>;
		}>();
		expect(managerBody.list).toHaveLength(1);
		expect(managerBody.list[0]).toMatchObject({
			userId: zeroConnected.id,
			avgDuration: 0,
			connectRate: 0,
		});
		expect(managerBody.list[0].passwordHash).toBeUndefined();
		expect(managerBody.list[0].salt).toBeUndefined();
	});

	it("lists batches with filters, pagination, and safe sorting", async () => {
		await ensureCrmTables();

		const admin = await createTestUser("batch_list_admin", 1);
		const manager = await createTestUser("batch_list_manager", 2);
		const employee = await createTestUser("batch_list_employee", 3);
		const adminToken = await tokenFor(admin);
		const managerToken = await tokenFor(manager);
		const employeeToken = await tokenFor(employee);
		const uniqueName = `六月渠道_${crypto.randomUUID()}`;
		const source = `渠道A_${crypto.randomUUID()}`;
		const olderBatch = await createBatchRecord({
			name: `${uniqueName}_旧`,
			source,
			cost: 100,
			creatorId: admin.id,
		});
		const newerBatch = await createBatchRecord({
			name: `${uniqueName}_新`,
			source,
			cost: 200,
			creatorId: admin.id,
		});

		const unauthenticatedResponse = await SELF.fetch(`https://example.com/api/batches?source-like=${source}`);
		const employeeResponse = await SELF.fetch(`https://example.com/api/batches?source-like=${source}`, {
			headers: { authorization: `Bearer ${employeeToken}` },
		});
		const adminResponse = await SELF.fetch(`https://example.com/api/batches?source-like=${source}&page=0&pagesize=1`, {
			headers: { authorization: `Bearer ${adminToken}` },
		});
		const managerResponse = await SELF.fetch(`https://example.com/api/batches?name-like=${uniqueName}&creatorId=${admin.id}`, {
			headers: { authorization: `Bearer ${managerToken}` },
		});
		const invalidSortResponse = await SELF.fetch(`https://example.com/api/batches?sort=-passwordHash`, {
			headers: { authorization: `Bearer ${adminToken}` },
		});

		expect(unauthenticatedResponse.status).toBe(401);
		expect(employeeResponse.status).toBe(403);
		expect(adminResponse.status).toBe(200);
		expect(managerResponse.status).toBe(200);
		expect(invalidSortResponse.status).toBe(400);

		const adminBody = await adminResponse.json<{
			page: number;
			pageSize: number;
			total: number;
			list: Array<{ id: number; source: string; passwordHash?: string; salt?: string }>;
		}>();
		expect(adminBody.page).toBe(0);
		expect(adminBody.pageSize).toBe(1);
		expect(adminBody.total).toBe(2);
		expect(adminBody.list).toHaveLength(1);
		expect(adminBody.list[0].id).toBe(newerBatch.id);
		expect(adminBody.list[0].passwordHash).toBeUndefined();
		expect(adminBody.list[0].salt).toBeUndefined();

		const managerBody = await managerResponse.json<{
			total: number;
			list: Array<{ id: number; creatorId: number; source: string; passwordHash?: string; salt?: string }>;
		}>();
		expect(managerBody.total).toBe(2);
		expect(managerBody.list.map((item) => item.id)).toEqual([newerBatch.id, olderBatch.id]);
		expect(managerBody.list.every((item) => item.creatorId === admin.id && item.source === source)).toBe(true);
		expect(managerBody.list.every((item) => item.passwordHash === undefined && item.salt === undefined)).toBe(true);
	});

	it("returns batch summary metrics and handles empty or missing batches", async () => {
		await ensureCrmTables();

		const admin = await createTestUser("batch_summary_admin", 1);
		const manager = await createTestUser("batch_summary_manager", 2);
		const employee = await createTestUser("batch_summary_employee", 3);
		const adminToken = await tokenFor(admin);
		const managerToken = await tokenFor(manager);
		const employeeToken = await tokenFor(employee);
		const emptyBatch = await createBatchRecord({
			name: `空批次_${crypto.randomUUID()}`,
			source: "empty",
			cost: 1000,
			creatorId: admin.id,
		});
		const batch = await createBatchRecord({
			name: `质量批次_${crypto.randomUUID()}`,
			source: "quality",
			cost: 1000,
			creatorId: admin.id,
		});

		await createBatchCustomer(batch.id, employee.id, 0, 0);
		await createBatchCustomer(batch.id, null, 0, 0);
		await createBatchCustomer(batch.id, employee.id, 1, 1);
		await createBatchCustomer(batch.id, employee.id, 2, 0);
		await createBatchCustomer(batch.id, null, 4, 0);

		const unauthenticatedResponse = await SELF.fetch(`https://example.com/api/batches/${batch.id}/summary`);
		const employeeResponse = await SELF.fetch(`https://example.com/api/batches/${batch.id}/summary`, {
			headers: { authorization: `Bearer ${employeeToken}` },
		});
		const adminResponse = await SELF.fetch(`https://example.com/api/batches/${batch.id}/summary`, {
			headers: { authorization: `Bearer ${adminToken}` },
		});
		const managerResponse = await SELF.fetch(`https://example.com/api/batches/${batch.id}/summary`, {
			headers: { authorization: `Bearer ${managerToken}` },
		});
		const invalidIdResponse = await SELF.fetch("https://example.com/api/batches/not-a-number/summary", {
			headers: { authorization: `Bearer ${adminToken}` },
		});
		const missingResponse = await SELF.fetch("https://example.com/api/batches/999999999/summary", {
			headers: { authorization: `Bearer ${adminToken}` },
		});
		const emptyResponse = await SELF.fetch(`https://example.com/api/batches/${emptyBatch.id}/summary`, {
			headers: { authorization: `Bearer ${adminToken}` },
		});

		expect(unauthenticatedResponse.status).toBe(401);
		expect(employeeResponse.status).toBe(403);
		expect(adminResponse.status).toBe(200);
		expect(managerResponse.status).toBe(200);
		expect(invalidIdResponse.status).toBe(400);
		expect(missingResponse.status).toBe(404);

		expect(await adminResponse.json()).toMatchObject({
			batchId: batch.id,
			name: batch.name,
			source: batch.source,
			cost: 1000,
			totalCustomers: 5,
			assignedCustomers: 3,
			unassignedCustomers: 2,
			calledCustomers: 3,
			uncalledCustomers: 2,
			connectedCustomers: 1,
			intentCustomers: 1,
			invalidCustomers: 1,
			connectRate: 0.3333,
			intentRate: 0.3333,
			costPerIntent: 1000,
		});
		expect(await managerResponse.json()).toMatchObject({
			batchId: batch.id,
			totalCustomers: 5,
		});
		expect(await emptyResponse.json()).toEqual({
			batchId: emptyBatch.id,
			name: emptyBatch.name,
			source: emptyBatch.source,
			cost: emptyBatch.cost,
			totalCustomers: 0,
			assignedCustomers: 0,
			unassignedCustomers: 0,
			calledCustomers: 0,
			uncalledCustomers: 0,
			connectedCustomers: 0,
			intentCustomers: 0,
			invalidCustomers: 0,
			connectRate: 0,
			intentRate: 0,
			costPerIntent: 0,
		});
	});

	it("lists assignment logs with filters, pagination, date range, and safe sorting", async () => {
		await ensureCrmTables();

		const admin = await createTestUser("assignment_log_admin", 1);
		const manager = await createTestUser("assignment_log_manager", 2);
		const employee = await createTestUser("assignment_log_employee", 3);
		const disabledManager = await createTestUser("assignment_log_disabled", 2);
		const adminToken = await tokenFor(admin);
		const managerToken = await tokenFor(manager);
		const employeeToken = await tokenFor(employee);
		const disabledToken = await tokenFor(disabledManager);
		const firstCustomer = await createCustomer(admin.id, null);
		const secondCustomer = await createCustomer(admin.id, manager.id);

		await setUserStatus(disabledManager.id, 0);
		const oldLog = await insertAssignmentLog({
			customerId: firstCustomer.id,
			fromUserId: null,
			toUserId: employee.id,
			operatorId: admin.id,
			action: 1,
			remark: "首次分配",
			createdAt: "2026-06-10T10:00:00.000Z",
		});
		const newLog = await insertAssignmentLog({
			customerId: secondCustomer.id,
			fromUserId: manager.id,
			toUserId: employee.id,
			operatorId: admin.id,
			action: 2,
			remark: "转移分配",
			createdAt: "2026-06-11T10:00:00.000Z",
		});
		await insertAssignmentLog({
			customerId: secondCustomer.id,
			fromUserId: employee.id,
			toUserId: null,
			operatorId: manager.id,
			action: 3,
			remark: "回收公海",
			createdAt: "2026-06-12T10:00:00.000Z",
		});

		const unauthenticatedResponse = await SELF.fetch("https://example.com/api/assignment-logs");
		const disabledResponse = await SELF.fetch("https://example.com/api/assignment-logs", {
			headers: { authorization: `Bearer ${disabledToken}` },
		});
		const employeeResponse = await SELF.fetch("https://example.com/api/assignment-logs", {
			headers: { authorization: `Bearer ${employeeToken}` },
		});
		const adminResponse = await SELF.fetch(
			`https://example.com/api/assignment-logs?page=0&pagesize=2&customerId=${secondCustomer.id}&operatorId=${admin.id}&toUserId=${employee.id}&fromUserId=${manager.id}&action=reassign&startDate=2026-06-11&endDate=2026-06-11`,
			{
				headers: { authorization: `Bearer ${adminToken}` },
			},
		);
		const managerResponse = await SELF.fetch(
			`https://example.com/api/assignment-logs?customerId=${firstCustomer.id}&fromUserId=null&action=assign`,
			{
				headers: { authorization: `Bearer ${managerToken}` },
			},
		);
		const defaultSortResponse = await SELF.fetch("https://example.com/api/assignment-logs?startDate=2026-06-10&endDate=2026-06-11", {
			headers: { authorization: `Bearer ${adminToken}` },
		});
		const invalidSortResponse = await SELF.fetch("https://example.com/api/assignment-logs?sort=-passwordHash", {
			headers: { authorization: `Bearer ${adminToken}` },
		});

		expect(unauthenticatedResponse.status).toBe(401);
		expect(disabledResponse.status).toBe(401);
		expect(employeeResponse.status).toBe(403);
		expect(adminResponse.status).toBe(200);
		expect(managerResponse.status).toBe(200);
		expect(invalidSortResponse.status).toBe(400);

		const adminBody = await adminResponse.json<{
			page: number;
			pageSize: number;
			total: number;
			list: Array<{ id: number; action: string; fromUserId: number | null; toUserId: number | null; passwordHash?: string; salt?: string }>;
		}>();
		expect(adminBody.page).toBe(0);
		expect(adminBody.pageSize).toBe(2);
		expect(adminBody.total).toBe(1);
		expect(adminBody.list[0]).toMatchObject({
			id: newLog.id,
			action: "reassign",
			fromUserId: manager.id,
			toUserId: employee.id,
		});
		expect(adminBody.list[0].passwordHash).toBeUndefined();
		expect(adminBody.list[0].salt).toBeUndefined();

		const managerBody = await managerResponse.json<{
			total: number;
			list: Array<{ id: number; action: string; fromUserId: number | null; fromUserName: string | null; passwordHash?: string; salt?: string }>;
		}>();
		expect(managerBody.total).toBe(1);
		expect(managerBody.list[0]).toMatchObject({
			id: oldLog.id,
			action: "assign",
			fromUserId: null,
			fromUserName: null,
		});
		expect(managerBody.list[0].passwordHash).toBeUndefined();
		expect(managerBody.list[0].salt).toBeUndefined();

		const sortBody = await defaultSortResponse.json<{ list: Array<{ id: number }> }>();
		expect(sortBody.list.map((item) => item.id)).toEqual([newLog.id, oldLog.id]);
	});

	it("lists call logs with filters, pagination, date range, and null started/ended times", async () => {
		await ensureCrmTables();

		const admin = await createTestUser("call_log_admin", 1);
		const manager = await createTestUser("call_log_manager", 2);
		const employee = await createTestUser("call_log_employee", 3);
		const disabledManager = await createTestUser("call_log_disabled", 2);
		const adminToken = await tokenFor(admin);
		const managerToken = await tokenFor(manager);
		const employeeToken = await tokenFor(employee);
		const disabledToken = await tokenFor(disabledManager);
		const firstCustomer = await createCustomer(admin.id, employee.id);
		const secondCustomer = await createCustomer(admin.id, manager.id);

		await setUserStatus(disabledManager.id, 0);
		const oldLog = await insertCallLog(firstCustomer.id, employee.id, "2026-06-13T10:00:00.000Z", {
			createdAt: "2026-06-13T10:00:00.000Z",
			duration: 66,
			callResult: 1,
			callRemark: "已接听",
		});
		const newLog = await insertCallLog(secondCustomer.id, manager.id, "2026-06-14T10:00:00.000Z", {
			createdAt: "2026-06-14T10:00:00.000Z",
			duration: 12,
			callResult: 2,
			callRemark: "无人接听",
		});

		const unauthenticatedResponse = await SELF.fetch("https://example.com/api/call-logs");
		const disabledResponse = await SELF.fetch("https://example.com/api/call-logs", {
			headers: { authorization: `Bearer ${disabledToken}` },
		});
		const employeeResponse = await SELF.fetch("https://example.com/api/call-logs", {
			headers: { authorization: `Bearer ${employeeToken}` },
		});
		const adminResponse = await SELF.fetch(
			`https://example.com/api/call-logs?page=0&pagesize=2&userId=${employee.id}&customerId=${firstCustomer.id}&callResult=1&startDate=2026-06-13&endDate=2026-06-13`,
			{
				headers: { authorization: `Bearer ${adminToken}` },
			},
		);
		const managerResponse = await SELF.fetch(`https://example.com/api/call-logs?userId=${manager.id}&callResult=2`, {
			headers: { authorization: `Bearer ${managerToken}` },
		});
		const defaultSortResponse = await SELF.fetch("https://example.com/api/call-logs?startDate=2026-06-13&endDate=2026-06-14", {
			headers: { authorization: `Bearer ${adminToken}` },
		});
		const invalidSortResponse = await SELF.fetch("https://example.com/api/call-logs?sort=-passwordHash", {
			headers: { authorization: `Bearer ${adminToken}` },
		});

		expect(unauthenticatedResponse.status).toBe(401);
		expect(disabledResponse.status).toBe(401);
		expect(employeeResponse.status).toBe(403);
		expect(adminResponse.status).toBe(200);
		expect(managerResponse.status).toBe(200);
		expect(invalidSortResponse.status).toBe(400);

		const adminBody = await adminResponse.json<{
			page: number;
			pageSize: number;
			total: number;
			list: Array<{
				id: number;
				customerId: number;
				userId: number;
				callResult: number;
				startedAt: null;
				endedAt: null;
				passwordHash?: string;
				salt?: string;
			}>;
		}>();
		expect(adminBody.page).toBe(0);
		expect(adminBody.pageSize).toBe(2);
		expect(adminBody.total).toBe(1);
		expect(adminBody.list[0]).toMatchObject({
			id: oldLog.id,
			customerId: firstCustomer.id,
			userId: employee.id,
			callResult: 1,
			startedAt: null,
			endedAt: null,
		});
		expect(adminBody.list[0].passwordHash).toBeUndefined();
		expect(adminBody.list[0].salt).toBeUndefined();

		const managerBody = await managerResponse.json<{ total: number; list: Array<{ id: number; callResult: number }> }>();
		expect(managerBody.total).toBe(1);
		expect(managerBody.list[0]).toMatchObject({
			id: newLog.id,
			callResult: 2,
		});

		const sortBody = await defaultSortResponse.json<{ list: Array<{ id: number }> }>();
		expect(sortBody.list.map((item) => item.id)).toEqual([newLog.id, oldLog.id]);
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

async function createLoginUser(
	usernamePrefix: string,
	role: number,
): Promise<{ id: number; username: string; role: number; frontendPasswordHash: string }> {
	const username = `${usernamePrefix}_${crypto.randomUUID()}`;
	const frontendPasswordHash = await sha256Hex(`password_${crypto.randomUUID()}`);
	const salt = createSalt();
	const passwordHash = await hashPasswordWithSalt(frontendPasswordHash, salt);
	const result = await env.DB.prepare(
		"INSERT INTO users (username, password_hash, salt, real_name, role, status) VALUES (?, ?, ?, ?, ?, 1) RETURNING id, username, role",
	)
		.bind(username, passwordHash, salt, username, role)
		.first<{ id: number; username: string; role: number }>();

	if (!result) {
		throw new Error("创建登录测试用户失败");
	}

	return {
		...result,
		frontendPasswordHash,
	};
}

async function tokenFor(user: { id: number; username: string; role: number }): Promise<string> {
	return createAccessToken(
		{
			user_id: user.id,
			username: user.username,
			role: user.role,
		},
		env.JWT_SECRET,
	);
}

async function setUserStatus(userId: number, status: 0 | 1): Promise<void> {
	await env.DB.prepare("UPDATE users SET status = ? WHERE id = ?").bind(status, userId).run();
}

async function createCustomer(creatorId: number, ownerId: number | null): Promise<{ id: number; phone: string }> {
	const batch = await env.DB.prepare(
		"INSERT INTO batches (name, source, cost, total_count, creator_id) VALUES (?, ?, 0, 1, ?) RETURNING id",
	)
		.bind(`测试批次_${crypto.randomUUID()}`, "unit-test", creatorId)
		.first<{ id: number }>();

	if (!batch) {
		throw new Error("创建测试批次失败");
	}

	const phone = `139${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
	const customer = await env.DB.prepare(
		"INSERT INTO customers (phone, name, company, owner_id, batch_id) VALUES (?, ?, ?, ?, ?) RETURNING id",
	)
		.bind(phone, "测试客户", "测试公司", ownerId, batch.id)
		.first<{ id: number }>();

	if (!customer) {
		throw new Error("创建测试客户失败");
	}

	return {
		id: customer.id,
		phone,
	};
}

async function createBatchRecord(input: {
	name: string;
	source: string | null;
	cost: number;
	creatorId: number;
}): Promise<{ id: number; name: string; source: string | null; cost: number }> {
	const batch = await env.DB.prepare(
		"INSERT INTO batches (name, source, cost, total_count, creator_id) VALUES (?, ?, ?, 0, ?) RETURNING id, name, source, cost",
	)
		.bind(input.name, input.source, input.cost, input.creatorId)
		.first<{ id: number; name: string; source: string | null; cost: number }>();

	if (!batch) {
		throw new Error("创建测试批次失败");
	}

	return batch;
}

async function createBatchCustomer(
	batchId: number,
	ownerId: number | null,
	status: number,
	type: number,
): Promise<{ id: number }> {
	const phone = `137${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
	const customer = await env.DB.prepare(
		"INSERT INTO customers (phone, name, company, type, status, owner_id, batch_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
	)
		.bind(phone, "批次统计客户", "批次统计公司", type, status, ownerId, batchId)
		.first<{ id: number }>();

	if (!customer) {
		throw new Error("创建批次测试客户失败");
	}

	return customer;
}

async function setCustomerType(customerId: number, type: 0 | 1): Promise<void> {
	await env.DB.prepare("UPDATE customers SET type = ? WHERE id = ?").bind(type, customerId).run();
}

async function insertDailySummary(
	userId: number,
	date: string,
	input: {
		totalCalls: number;
		connectedCalls: number;
		totalDuration: number;
		firstCallTime: string | null;
		lastCallTime: string | null;
	},
): Promise<void> {
	await env.DB.prepare(
		"INSERT INTO agent_daily_summaries (user_id, date, first_call_time, last_call_time, total_calls, connected_calls, total_duration) VALUES (?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(userId, date, input.firstCallTime, input.lastCallTime, input.totalCalls, input.connectedCalls, input.totalDuration)
		.run();
}

async function insertAssignmentLog(input: {
	customerId: number;
	fromUserId: number | null;
	toUserId: number | null;
	operatorId: number;
	action: number;
	remark: string | null;
	createdAt: string;
}): Promise<{ id: number }> {
	const result = await env.DB.prepare(
		"INSERT INTO assignment_logs (customer_id, from_user_id, to_user_id, operator_id, action, remark, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
	)
		.bind(input.customerId, input.fromUserId, input.toUserId, input.operatorId, input.action, input.remark, input.createdAt)
		.first<{ id: number }>();

	if (!result) {
		throw new Error("创建测试分配日志失败");
	}

	return result;
}

async function insertCallLog(
	customerId: number,
	userId: number,
	callTime: string,
	options?: {
		createdAt?: string;
		duration?: number;
		callResult?: number;
		callRemark?: string;
	},
): Promise<{ id: number }> {
	const result = await env.DB.prepare(
		"INSERT INTO call_logs (customer_id, user_id, call_time, duration, call_result, call_remark, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
	)
		.bind(
			customerId,
			userId,
			callTime,
			options?.duration ?? 30,
			options?.callResult ?? 1,
			options?.callRemark ?? "dashboard 测试通话",
			options?.createdAt ?? callTime,
		)
		.first<{ id: number }>();

	if (!result) {
		throw new Error("创建测试通话日志失败");
	}

	return result;
}

async function expectAssign(token: string, customerId: number, targetUserId: number | null, expectedStatus: number): Promise<void> {
	const response = await SELF.fetch("https://example.com/api/customers/assign", {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			customerIds: [customerId],
			targetUserId,
			reason: "安全测试分配",
		}),
	});

	expect(response.status).toBe(expectedStatus);
}

async function reportCallStatus(token: string, customerId: number): Promise<number> {
	const response = await SELF.fetch("https://example.com/api/calls/report", {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			customerId,
			duration: 30,
			callResult: 1,
			callRemark: "安全测试通话",
		}),
	});

	return response.status;
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
