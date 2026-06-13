# Telemark Backend API

本文档描述当前后端 API 服务的稳定接口契约，适用于管理后台、员工外呼 APP 和后续 AI 辅助开发。

## 基础约定

- 本地开发地址：`http://localhost:8787`
- JSON 请求头：`Content-Type: application/json`
- 认证请求头：`Authorization: Bearer <accessToken>`
- AccessToken 有效期：12 小时
- RefreshToken 有效期：14 天，存储在 Cloudflare KV 绑定 `c_kv`
- 角色枚举：`1` 超级管理员，`2` 经理，`3` 普通员工
- 客户状态枚举：`0` 未拨打，`1` 已接听，`2` 无人接听，`3` 拒接，`4` 空号停机
- 客户类型枚举：`0` 普通线索，`1` 意向客户

密码规则：前端提交的 `password` 不是明文，而是 `SHA-256(明文密码)`。后端会再执行 `SHA-256(前端密码哈希 + 用户 salt)` 与数据库 `password_hash` 比对。

常见错误响应：

```json
{ "message": "错误说明" }
```

## 健康检查

### GET /health

用于确认 Worker 和 D1 绑定是否可用。

响应：

```json
{
  "ok": true,
  "database": true
}
```

## 认证接口

### POST /api/auth/init-admin

初始化第一位超级管理员。仅本地开发环境允许调用，并且当系统已存在任意用户或超级管理员时会返回 `409`，禁止重复初始化。

请求：

```json
{
  "username": "admin",
  "password": "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9",
  "realName": "超级管理员",
  "phone": "13800000000",
  "remark": "初始化超级管理员"
}
```

响应：

```json
{
  "id": 1,
  "username": "admin",
  "salt": "random-salt"
}
```

curl：

```bash
curl -X POST http://localhost:8787/api/auth/init-admin \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9","realName":"超级管理员","phone":"13800000000","remark":"初始化超级管理员"}'
```

### POST /api/auth/login

用户登录。成功后返回短 AccessToken、长 RefreshToken 和用户基础信息。

请求：

```json
{
  "username": "admin",
  "password": "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9"
}
```

响应：

```json
{
  "accessToken": "jwt-access-token",
  "refreshToken": "random-refresh-token",
  "user": {
    "id": 1,
    "username": "admin",
    "realName": "超级管理员",
    "role": 1
  }
}
```

curl：

```bash
curl -X POST http://localhost:8787/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9"}'
```

### POST /api/auth/refresh

使用 RefreshToken 无感续期 AccessToken。若 KV 中不存在该 RefreshToken，返回 `403`，前端必须重新登录。

请求：

```json
{
  "refreshToken": "random-refresh-token"
}
```

响应：

```json
{
  "accessToken": "new-jwt-access-token"
}
```

curl：

```bash
curl -X POST http://localhost:8787/api/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refreshToken>"}'
```

### POST /api/auth/logout

退出登录。需要携带有效的 AccessToken，同时传入当前用户的 RefreshToken，后端将销毁该 RefreshToken 使其无法再用于续期。

权限：需要有效的短 Token。

请求：

```json
{
  "refreshToken": "random-refresh-token"
}
```

响应：

```json
{
  "ok": true
}
```

业务规则：

- 验证 AccessToken 有效后，从请求体中取出 `refreshToken`
- 在 KV 中查找该 `refreshToken`，若不存在则返回 `403`
- 存在则调用 `kv.delete` 彻底销毁，此后该 RefreshToken 无法再用于 `/api/auth/refresh`
- AccessToken 本身不会立即失效（仍在其 12 小时有效期内），前端应同时清除本地存储的 AccessToken

错误响应：

| 状态码 | 场景 |
|--------|------|
| 400 | `refreshToken` 为空 |
| 401 | AccessToken 缺失或无效 |
| 403 | RefreshToken 无效或已过期 |

curl：

```bash
curl -X POST http://localhost:8787/api/auth/logout \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"refreshToken":"<refreshToken>"}'
```

### POST /api/auth/change-password

修改当前登录用户的密码。需要携带有效的 AccessToken，用户只能修改自己的密码。

权限：所有已登录用户（任何角色均可调用）。

请求：

```json
{
  "oldPassword": "SHA-256(旧明文密码)",
  "newPassword": "SHA-256(新明文密码)"
}
```

响应：

```json
{
  "ok": true
}
```

业务规则：

- 从 AccessToken 中解析当前用户 ID，不接受外部传入的 userId，确保只能修改自己的密码
- 验证旧密码：取出该用户的 `salt`，计算 `SHA-256(oldPassword + salt)` 与数据库中的 `password_hash` 做常量时间比对
- 旧密码验证通过后，生成新的 `salt`，计算新密码哈希，同时更新 `password_hash` 和 `salt`
- 密码规则与创建员工一致：前端提交的必须是 `SHA-256(明文密码)`，后端再执行 `SHA-256(前端哈希 + salt)`

错误响应：

| 状态码 | 场景 |
|--------|------|
| 400 | `oldPassword` 或 `newPassword` 为空 |
| 401 | AccessToken 缺失或无效 |
| 401 | 旧密码错误 |
| 401 | 用户不存在或已被禁用 |

curl：

```bash
curl -X POST http://localhost:8787/api/auth/change-password \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"oldPassword":"<SHA-256-of-old-plaintext>","newPassword":"<SHA-256-of-new-plaintext>"}'
```

## 线索与批次接口

### POST /api/batches/import

批量导入客户线索。仅 `role=1` 或 `role=2` 可调用。

请求：

```json
{
  "name": "2026-06 测试批次",
  "source": "本地测试",
  "cost": 1000,
  "customers": [
    { "phone": "13900020001", "name": "客户A", "company": "测试公司A" },
    { "phone": "13900020002", "name": "客户B", "company": "测试公司B" }
  ]
}
```

响应：

```json
{
  "batchId": 1,
  "importedCount": 2,
  "skippedDuplicateCount": 0
}
```

业务规则：

- 插入批次记录到 `batches`，记录 `creator_id`
- 导入前按 `phone` 查重，重复号码跳过
- 新线索写入 `customers`，并绑定 `batch_id`

curl：

```bash
curl -X POST http://localhost:8787/api/batches/import \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"name":"2026-06 测试批次","source":"本地测试","cost":1000,"customers":[{"phone":"13900020001","name":"客户A","company":"测试公司A"},{"phone":"13900020002","name":"客户B","company":"测试公司B"},{"phone":"13900020001","name":"重复客户","company":"重复公司"}]}'
```

### GET /api/customers

客户列表查询。仅 `role=1` 或 `role=2` 可调用。

支持分页、排序和动态查询：

- `page`：从 `0` 开始，默认 `0`
- `pagesize`：默认 `10`
- `sort=id`：按 `id` 降序
- `sort=-id`：按 `id` 升序
- `name-like=张`：模糊查询
- `status=1` 或 `status-eq=1`：等值查询
- `role-in=1,2`：集合查询
- `duration-gt=30`：大于查询
- 支持 `lt`、`lteq`、`gteq`
- `is_assigned=0`：仅查询公海未分配客户（`owner_id IS NULL`）
- `is_assigned=1`：仅查询已分配客户（`owner_id IS NOT NULL`）

响应：

```json
{
  "page": 0,
  "pageSize": 10,
  "total": 1,
  "list": [
    {
      "id": 1,
      "phone": "13900020001",
      "name": "客户A",
      "company": "测试公司A",
      "type": 0,
      "status": 0,
      "remark": null,
      "ownerId": null,
      "batchId": 1,
      "createdAt": "2026-06-12T00:00:00.000Z",
      "updatedAt": "2026-06-12T00:00:00.000Z"
    }
  ]
}
```

curl：

```bash
curl 'http://localhost:8787/api/customers?page=0&pagesize=10&sort=id&name-like=客户' \
  -H "Authorization: Bearer <accessToken>"
```

查询公海未分配客户：

```bash
curl 'http://localhost:8787/api/customers?is_assigned=0&page=0&pagesize=10' \
  -H "Authorization: Bearer <accessToken>"
```

### GET /api/my-customers

拉取当前登录员工被分配且尚未拨打的客户。仅 `role=2` 或 `role=3` 可调用。

后端会从 AccessToken 中读取当前用户 ID，并强制追加：

- `owner_id = 当前用户 ID`
- `status = 0`

前端仍可传 `page`、`pagesize`、`sort` 以及安全白名单内的动态查询参数，但不能覆盖上述强制条件。

响应：

```json
{
  "page": 0,
  "pageSize": 10,
  "total": 1,
  "list": [
    {
      "id": 1,
      "phone": "13900020001",
      "name": "客户A",
      "company": "测试公司A",
      "type": 0,
      "status": 0,
      "remark": null,
      "ownerId": 3,
      "batchId": 1,
      "createdAt": "2026-06-12T00:00:00.000Z",
      "updatedAt": "2026-06-12T00:00:00.000Z"
    }
  ]
}
```

curl：

```bash
curl 'http://localhost:8787/api/my-customers?page=0&pagesize=10&sort=-id' \
  -H "Authorization: Bearer <employeeOrManagerAccessToken>"
```

### POST /api/customers/assign

批量分配或回收线索。仅 `role=1` 或 `role=2` 可调用。

请求：

```json
{
  "customerIds": [1, 2],
  "targetUserId": 3,
  "reason": "测试分配"
}
```

回收到公海时，`targetUserId` 传 `null`：

```json
{
  "customerIds": [1, 2],
  "targetUserId": null,
  "reason": "回收到公海"
}
```

响应：

```json
{
  "updatedCount": 2,
  "loggedCount": 2
}
```

业务规则：

- 更新 `customers.owner_id`
- 写入 `assignment_logs`，记录原销售、新销售、操作者、动作和原因
- 当前 D1 实现使用 `db.batch()` 承载多语句批量写入

curl：

```bash
curl -X POST http://localhost:8787/api/customers/assign \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"customerIds":[1,2],"targetUserId":null,"reason":"本地测试回收"}'
```

## 员工接口

### GET /api/users

获取员工列表。仅 `role=1` 或 `role=2` 可调用。

安全规则：

- 默认仅返回在职员工（`status = 1`）
- 返回字段白名单不包含 `passwordHash`
- 返回字段白名单不包含 `salt`

快捷参数：

- `is_disable=0`：仅查询在职员工（`status = 1`），默认行为
- `is_disable=1`：仅查询已禁用员工（`status = 0`）

响应：

```json
{
  "page": 0,
  "pageSize": 10,
  "total": 1,
  "list": [
    {
      "id": 3,
      "username": "sales01",
      "realName": "销售一号",
      "phone": "13900001111",
      "role": 3,
      "status": 1,
      "remark": "华东组",
      "createdAt": "2026-06-12T00:00:00.000Z",
      "updatedAt": "2026-06-12T00:00:00.000Z"
    }
  ]
}
```

curl：

```bash
curl 'http://localhost:8787/api/users?page=0&pagesize=10&role=3' \
  -H "Authorization: Bearer <adminOrManagerAccessToken>"
```

查询已禁用员工：

```bash
curl 'http://localhost:8787/api/users?is_disable=1&page=0&pagesize=10' \
  -H "Authorization: Bearer <adminOrManagerAccessToken>"
```

### POST /api/users

创建/邀请员工。仅 `role=1` 管理员可调用。`password` 必须是前端预哈希后的 `SHA-256(明文密码)`。

请求：

```json
{
  "username": "sales01",
  "password": "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9",
  "realName": "销售一号",
  "phone": "13900001111",
  "role": 3,
  "remark": "华东组"
}
```

响应不会包含密码哈希和 salt：

```json
{
  "id": 3,
  "username": "sales01",
  "realName": "销售一号",
  "phone": "13900001111",
  "role": 3,
  "status": 1,
  "remark": "华东组",
  "createdAt": "2026-06-12T00:00:00.000Z",
  "updatedAt": "2026-06-12T00:00:00.000Z"
}
```

curl：

```bash
curl -X POST http://localhost:8787/api/users \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <adminAccessToken>" \
  -d '{"username":"sales01","password":"240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9","realName":"销售一号","phone":"13900001111","role":3,"remark":"华东组"}'
```

### PATCH /api/users/:id

修改员工资料、角色、状态或重置密码。仅 `role=1` 管理员可调用。

请求字段均为可选；如果包含 `password`，后端会重新生成 salt 并计算新的最终密码哈希。

```json
{
  "realName": "销售一号",
  "phone": "13900002222",
  "role": 2,
  "status": 1,
  "remark": "升为经理",
  "password": "new-frontend-sha256-password"
}
```

密码空值保护：

- 当 `password` 为 `undefined`、空字符串 `""` 或全空格字符串时，后端**不会**触发密码重置逻辑，也不会更新 `password_hash` 和 `salt` 字段，仅更新其他传入的资料字段
- 只有当 `password` 是一个非空的有效哈希字符串时，才会重新生成 salt 并计算新的密码哈希进行更新
- 前端在仅修改资料（不重置密码）的场景下，可以不传 `password` 字段，或传空值

curl：

```bash
curl -X PATCH http://localhost:8787/api/users/3 \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <adminAccessToken>" \
  -d '{"realName":"销售一号","phone":"13900002222","role":2,"status":1,"remark":"升为经理"}'
```

### DELETE /api/users/:id

软删除/禁用员工账号。仅 `role=1` 管理员可调用。实际行为是将 `status` 更新为 `0`，不会物理删除历史通话、分配审计关联数据。

curl：

```bash
curl -X DELETE http://localhost:8787/api/users/3 \
  -H "Authorization: Bearer <adminAccessToken>"
```

## 通话接口

### POST /api/calls/report

员工 APP 回传通话结果。仅 `role=2` 或 `role=3` 可调用。

请求：

```json
{
  "customerId": 1,
  "duration": 66,
  "callResult": 1,
  "callRemark": "客户已接听，有明确意向"
}
```

响应：

```json
{
  "ok": true,
  "customerId": 1,
  "userId": 3,
  "date": "2026-06-12"
}
```

业务副作用：

- 插入一条不可变 `call_logs` 通话记录
- 更新 `customers.status` 为 `callResult`
- 更新 `customers.remark` 为 `callRemark`
- 当 `callResult=1` 时，自动将 `customers.type` 改为 `1`
- 按 `(user_id, date)` upsert `agent_daily_summaries`
- 新日报：`first_call_time` 与 `last_call_time` 均为当前时间，`total_calls=1`
- 已有日报：`last_call_time` 更新为当前时间，`total_calls` 自增
- 当 `duration > 0` 且 `callResult=1` 时，`connected_calls` 自增，`total_duration` 累加

curl：

```bash
curl -X POST http://localhost:8787/api/calls/report \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"customerId":1,"duration":66,"callResult":1,"callRemark":"客户已接听，有明确意向"}'
```

### GET /api/my-summary

获取当前登录员工今日战报数据。仅 `role=2` 或 `role=3` 可调用。

后端从 AccessToken 中解析出当前用户 ID，查询 `agent_daily_summaries` 表中该用户今天的统计记录。日期基准为 `Asia/Shanghai` 时区，与通话回传的日报生成逻辑一致。

响应（有通话记录时）：

```json
{
  "totalCalls": 12,
  "connectedCalls": 5,
  "totalDuration": 396,
  "firstCallTime": "2026-06-12T09:15:30.000Z",
  "lastCallTime": "2026-06-12T17:42:18.000Z"
}
```

响应（今日无通话记录时）：

```json
{
  "totalCalls": 0,
  "connectedCalls": 0,
  "totalDuration": 0,
  "firstCallTime": null,
  "lastCallTime": null
}
```

字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `totalCalls` | number | 今日总拨打次数 |
| `connectedCalls` | number | 今日接通次数（`duration > 0` 且 `callResult=1`） |
| `totalDuration` | number | 今日总通话时长（秒） |
| `firstCallTime` | string \| null | 今日首次拨打时间（ISO 8601） |
| `lastCallTime` | string \| null | 今日最后拨打时间（ISO 8601） |

curl：

```bash
curl 'http://localhost:8787/api/my-summary' \
  -H "Authorization: Bearer <employeeOrManagerAccessToken>"
```

## 本地联调建议顺序

1. 启动本地 Worker：`pnpm exec wrangler dev`
2. 初始化管理员：`POST /api/auth/init-admin`
3. 登录获取 `accessToken` 和 `refreshToken`：`POST /api/auth/login`
4. 导入测试线索：`POST /api/batches/import`
5. 查询线索列表：`GET /api/customers`
6. 分配或回收线索：`POST /api/customers/assign`
7. 回传通话记录：`POST /api/calls/report`
8. AccessToken 过期后，用 `POST /api/auth/refresh` 获取新的 AccessToken
