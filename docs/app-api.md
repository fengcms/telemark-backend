# 员工外呼 APP — API 接口文档

本文档从完整 API 中提取出员工 APP 所需的全部接口，供 APP 开发 AI 直接使用，无需阅读管理后台相关接口。

## APP 角色定位

APP 的使用者是 **经理（role=2）** 和 **普通员工（role=3）**。管理员（role=1）不使用 APP。

APP 的核心目标：消灭一切不必要的操作，让销售只专注于打电话和反馈结果。

## 基础约定

- 本地开发地址：`http://localhost:8787`
- JSON 请求头：`Content-Type: application/json`
- 认证请求头：`Authorization: Bearer <accessToken>`
- AccessToken 有效期：12 小时
- RefreshToken 有效期：14 天
- 客户状态枚举：`0` 未拨打，`1` 已接听，`2` 无人接听，`3` 拒接，`4` 空号停机
- 客户类型枚举：`-1` 废线索，`0` 普通线索，`1` 意向客户，`2` 高意向客户

密码规则：前端提交的 `password` 不是明文，而是 `SHA-256(明文密码)`。后端再执行 `SHA-256(前端哈希 + salt)` 与数据库比对。

常见错误响应：

```json
{ "message": "错误说明" }
```

## 认证机制

```
┌──────────┐     password = SHA-256(明文)     ┌──────────┐
│  APP     │ ───────────────────────────────► │  后端    │
│          │                                  │          │
│          │     SHA-256(password + salt)     │          │
│          │     ═══════════════════════►     │ 比对DB   │
│          │                                  │          │
│          │  ◄─── accessToken (12h) ──────   │          │
│          │  ◄─── refreshToken (14d) ─────   │  KV存储  │
└──────────┘                                  └──────────┘
```

### Token 无感续期流程

1. APP 登录后同时存储 `accessToken` 和 `refreshToken`
2. 每次请求携带 `accessToken`
3. 当请求返回 `401` 时，APP 自动调用 `POST /api/auth/refresh` 续期
4. 续期成功后用新 `accessToken` 重试原请求
5. 续期也返回 `403` 时，跳转登录页

---

## 接口列表

| 方法 | 路径 | 说明 | 需要登录 |
|------|------|------|----------|
| POST | /api/auth/login | 登录 | 否 |
| POST | /api/auth/refresh | 续期 Token | 否 |
| POST | /api/auth/logout | 退出登录 | 是 |
| POST | /api/auth/change-password | 修改密码 | 是 |
| GET | /api/my-customers | 我的待拨客户 | 是 |
| GET | /api/my-customers/history | 我的已拨客户 | 是 |
| GET | /api/call-remarks/common | 常用客户反馈备注 | 是 |
| POST | /api/calls/report | 回传通话结果 | 是 |
| GET | /api/my-summary | 今日战报 | 是 |
| GET | /api/dashboard/agent-monthly | 月度统计 | 是 |

---

## 1. 登录

### POST /api/auth/login

请求：

```json
{
  "username": "sales01",
  "password": "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9"
}
```

响应：

```json
{
  "accessToken": "jwt-access-token",
  "refreshToken": "random-refresh-token",
  "user": {
    "id": 3,
    "username": "sales01",
    "realName": "销售一号",
    "role": 3
  }
}
```

业务规则：

- `password` 为 `SHA-256(明文密码)`，不是明文
- 用户被禁用（status=0）时返回 `401`，提示"用户名或密码错误"
- 登录成功后 APP 应同时存储 `accessToken` 和 `refreshToken`

错误响应：

| 状态码 | 场景 |
|--------|------|
| 401 | 用户名或密码错误 |

curl：

```bash
curl -X POST http://localhost:8787/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"sales01","password":"240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9"}'
```

---

## 2. 续期 Token

### POST /api/auth/refresh

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

业务规则：

- 用 `refreshToken` 换取新的 `accessToken`，`refreshToken` 本身不变
- `refreshToken` 已过期或已销毁时返回 `403`，APP 必须跳转登录页

错误响应：

| 状态码 | 场景 |
|--------|------|
| 403 | RefreshToken 无效或已过期，需重新登录 |

---

## 3. 退出登录

### POST /api/auth/logout

需要 `Authorization: Bearer <accessToken>`。

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

---

## 4. 修改密码

### POST /api/auth/change-password

需要 `Authorization: Bearer <accessToken>`。

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
- 修改成功后，当前 `accessToken` 仍有效（12 小时内），`refreshToken` 不受影响

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

---

## 5. 我的待拨客户

### GET /api/my-customers

需要 `Authorization: Bearer <accessToken>`。仅 `role=2` 或 `role=3` 可调用。

这是 APP 的**主界面接口**，返回分配给当前登录员工且尚未拨打的客户列表。

后端强制条件（不可覆盖）：

- `owner_id = 当前用户 ID`
- `status = 0`（未拨打）
- `is_deleted = 0`（未作废）

查询参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| `page` | 否 | 从 `0` 开始，默认 `0` |
| `pagesize` | 否 | 默认 `10`，最大 `100` |
| `sort` | 否 | 默认 `-id`（降序）；`sort=id` 升序，`sort=-id` 降序 |
| `name-like` | 否 | 客户名称模糊查询 |
| `phone-like` | 否 | 手机号模糊查询 |
| `company-like` | 否 | 公司名称模糊查询 |

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
  -H "Authorization: Bearer <accessToken>"
```

---

## 6. 我的已拨客户

### GET /api/my-customers/history

需要 `Authorization: Bearer <accessToken>`。仅 `role=2` 或 `role=3` 可调用。

返回当前登录员工名下已经拨打过的历史客户（`status != 0`）。

本接口是员工 APP 个人接口，只能查询当前登录用户自己的历史客户。

后端强制条件（不可覆盖）：

- `owner_id = 当前登录用户 ID`
- `status != 0`（已拨打）
- `is_deleted = 0`（未作废）

查询参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| `page` | 否 | 从 `0` 开始，默认 `0`；非法值返回 `400` |
| `pagesize` | 否 | 默认 `10`，最大 `100`，超过时截断为 `100`；非法值返回 `400` |
| `sort` | 否 | 默认 `-updatedAt`；`sort=updatedAt` 升序，`sort=-updatedAt` 降序 |
| `status` | 否 | 客户状态：`1` 已接听 / `2` 无人接听 / `3` 拒接 / `4` 空号停机 |
| `status-in` | 否 | 多状态筛选，如 `status-in=1,2` |
| `type` | 否 | 客户类型：`-1` 废线索 / `0` 普通线索 / `1` 意向客户 / `2` 高意向客户 |
| `type-in` | 否 | 多类型筛选 |
| `name-like` | 否 | 客户名称模糊查询 |
| `phone-like` | 否 | 手机号模糊查询 |
| `company-like` | 否 | 公司名称模糊查询 |

排序字段白名单：

```txt
id
status
type
createdAt
updatedAt
```

禁止参数：

```txt
ownerId
owner_id
userId
```

传入上述禁止参数会返回 `400`，避免前端尝试查询其他人的客户。

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
      "type": 1,
      "status": 1,
      "remark": "客户有意向，下周一回电",
      "ownerId": 3,
      "batchId": 1,
      "createdAt": "2026-06-13T00:00:00.000Z",
      "updatedAt": "2026-06-13T02:00:00.000Z"
    }
  ]
}
```

业务规则：

- `role=2` 经理也只能查看自己名下的历史客户
- `role=3` 普通员工只能查看自己名下的历史客户
- 不返回 `status=0` 的未拨打客户；未拨打客户继续由 `GET /api/my-customers` 返回
- 不返回已作废客户
- 不返回 `isDeleted`、`deletedAt`、`deletedBy`、`deleteReason`
- 非法 `status`、`type`、`page`、`pagesize` 或 `sort` 返回 `400`

错误响应：

| 状态码 | 场景 |
|--------|------|
| 400 | 查询参数非法，或传入 `ownerId` / `owner_id` / `userId` |
| 401 | 未登录、AccessToken 无效或用户已禁用 |
| 403 | 角色不是经理或普通员工 |

curl：

```bash
curl 'http://localhost:8787/api/my-customers/history?page=0&pagesize=10&sort=-updatedAt&type=1&status=1' \
  -H "Authorization: Bearer <accessToken>"
```

---

## 7. 常用客户反馈备注

### GET /api/call-remarks/common

需要 `Authorization: Bearer <accessToken>`。仅 `role=2` 或 `role=3` 可调用。

这是 APP 通话反馈弹窗的快捷输入数据源。接口只返回启用中的备注字符串数组，按管理后台配置的排序返回。

响应：

```json
[
  "客户已接听，有明确意向",
  "客户有意向，稍后回访",
  "客户需要先看案例",
  "无人接听，稍后再拨"
]
```

业务规则：

- 只返回管理后台启用中的备注
- 返回值是字符串数组，不包裹 `list`
- APP 可在打开反馈弹窗时请求，也可以登录后缓存到本地

curl：

```bash
curl 'http://localhost:8787/api/call-remarks/common' \
  -H "Authorization: Bearer <accessToken>"
```

---

## 8. 回传通话结果

### POST /api/calls/report

需要 `Authorization: Bearer <accessToken>`。仅 `role=2` 或 `role=3` 可调用。

这是 APP 最核心的写入接口。电话挂断后，APP 弹出反馈弹窗，用户选择结果后调用此接口。

请求：

```json
{
  "customerId": 1,
  "duration": 66,
  "callResult": 1,
  "callRemark": "客户已接听，有明确意向",
  "customerType": 1,
  "clientRequestId": "uuid-from-app",
  "startedAt": "2026-06-13T01:15:30.000Z",
  "endedAt": "2026-06-13T01:16:36.000Z"
}
```

字段说明：

| 字段 | 必填 | 说明 |
|------|------|------|
| `customerId` | 是 | 客户 ID |
| `duration` | 是 | 通话时长（秒），非负整数 |
| `callResult` | 是 | 通话结果：`1` 已接听 / `2` 无人接听 / `3` 拒接 / `4` 空号停机 |
| `callRemark` | 条件必填 | 仅 `callResult=1`（已接听）时必填；其他结果不要传，后端会忽略并保存为空 |
| `customerType` | 是 | 员工手动选择的线索类型：`-1` 废线索 / `0` 普通线索 / `1` 意向客户 / `2` 高意向客户 |
| `clientRequestId` | 否 | 幂等键，防止网络重试导致重复提交，建议每次上报都传 |
| `startedAt` | 否 | 通话开始时间（ISO 8601） |
| `endedAt` | 否 | 通话结束时间（ISO 8601） |

响应：

```json
{
  "ok": true,
  "customerId": 1,
  "userId": 3,
  "date": "2026-06-13",
  "idempotent": false
}
```

重复提交同一 `clientRequestId` 时：

```json
{
  "ok": true,
  "customerId": 1,
  "userId": 3,
  "date": "2026-06-13",
  "idempotent": true
}
```

后端自动副作用（APP 无需额外请求）：

- 更新客户状态为 `callResult`
- 当 `callResult=1`（已接听）时，更新客户备注为 `callRemark`
- 当 `callResult!=1` 时，本次通话日志备注为空，且不会更新客户已有备注
- 更新客户类型为 `customerType`
- 后端不会根据"已接听"自动把客户标记为意向客户，必须由员工手动选择线索类型
- 自动累加今日战报数据（总拨打数、接通数、通话时长等）
- 该客户从"待拨列表"自动消失，进入"已拨历史"

APP 表单规则：

- 用户选择"已接听"时，展示备注输入框，并要求填写非空备注
- 用户选择"无人接听"、"拒接"、"空号停机"等其他结果时，隐藏备注输入框并清空本地备注
- 提交其他结果时不要传 `callRemark`
- 每次提交都必须让员工选择线索类型并传 `customerType`

幂等规则：

- 同一 `userId + clientRequestId` 重复提交时，直接返回 `idempotent=true`
- 不会重复插入通话记录，不会重复更新客户，不会重复累加日报
- 建议每次上报都传 `clientRequestId`，用 UUID 即可

离线补传规则：

- `startedAt` / `endedAt` 保存真实拨打时间
- 日报日期、`firstCallTime`、`lastCallTime` 优先使用 `endedAt`
- 离线补传较早通话时，`firstCallTime` 会更新为更早的真实时间
- 延迟补传较晚通话时，`lastCallTime` 会更新为更晚的真实时间

校验规则：

- 当 `callResult=1`（已接听）时，`callRemark` 必填，且去除首尾空格后不能为空
- 当 `callResult!=1` 时，`callRemark` 不需要传；即使传入，后端也会忽略并保存为空
- `customerType` 必填，只能是 `-1`、`0`、`1`、`2`
- `clientRequestId` 如传入，必须是非空字符串，最长 `128`
- `startedAt` / `endedAt` 如传入，必须是合法 ISO 字符串
- `endedAt` 不能早于 `startedAt`
- `duration` 必须是非负整数
- 只能上报归属于当前用户的未作废客户
- 已作废客户返回 `404`

错误响应：

| 状态码 | 场景 |
|--------|------|
| 400 | 参数校验失败 |
| 401 | 未登录或用户已禁用 |
| 404 | 客户不存在、已作废或不属于当前用户 |

curl：

已接听，必须传 `callRemark`：

```bash
curl -X POST http://localhost:8787/api/calls/report \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"customerId":1,"duration":66,"callResult":1,"callRemark":"客户已接听，有明确意向","customerType":1,"clientRequestId":"uuid-from-app","startedAt":"2026-06-13T01:15:30.000Z","endedAt":"2026-06-13T01:16:36.000Z"}'
```

非已接听，不需要传 `callRemark`：

```bash
curl -X POST http://localhost:8787/api/calls/report \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"customerId":1,"duration":0,"callResult":2,"customerType":0,"clientRequestId":"uuid-from-app-no-answer","startedAt":"2026-06-13T01:15:30.000Z","endedAt":"2026-06-13T01:15:30.000Z"}'
```

重复提交同一个 `clientRequestId`（幂等测试）：

```bash
curl -X POST http://localhost:8787/api/calls/report \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <accessToken>" \
  -d '{"customerId":1,"duration":66,"callResult":1,"callRemark":"重复提交测试","customerType":1,"clientRequestId":"uuid-from-app","startedAt":"2026-06-13T01:15:30.000Z","endedAt":"2026-06-13T01:16:36.000Z"}'
```

---

## 9. 今日战报

### GET /api/my-summary

需要 `Authorization: Bearer <accessToken>`。仅 `role=2` 或 `role=3` 可调用。

返回当前登录员工今日的战报数据。日期基准为 `Asia/Shanghai` 时区。

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
| `connectedCalls` | number | 今日接通次数 |
| `totalDuration` | number | 今日总通话时长（秒） |
| `firstCallTime` | string \| null | 今日首次拨打时间 |
| `lastCallTime` | string \| null | 今日最后拨打时间 |

curl：

```bash
curl 'http://localhost:8787/api/my-summary' \
  -H "Authorization: Bearer <accessToken>"
```

---

## 10. 月度统计

### GET /api/dashboard/agent-monthly

需要 `Authorization: Bearer <accessToken>`。`role=1` / `role=2` 可查看员工月度列表；**`role=3` 普通员工也可调用，但只能读取自己的月度数据**。

返回当前登录员工的月度呼叫统计信息。

查询参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| `month` | 否 | 统计月份，格式 `YYYY-MM`；不传时使用 `Asia/Shanghai` 当前业务月份 |
| `page` | 否 | 从 `0` 开始，默认 `0` |
| `pagesize` | 否 | 默认 `10`，最大 `100`，超过时截断为 `100` |
| `sort` | 否 | 默认 `-totalCalls`；`sort=totalCalls` 为升序，`sort=-totalCalls` 为降序 |
| `userId` | 否 | 按员工 ID 精确筛选；**`role=3` 传入该参数也会被强制改为当前登录用户 ID** |
| `username-like` | 否 | 按用户名模糊筛选 |
| `realName-like` | 否 | 按真实姓名模糊筛选 |

排序白名单：

```txt
userId
totalCalls
calledCustomers
connectedCalls
connectedCustomers
totalDuration
avgDuration
connectRate
customerConnectRate
firstCallTime
lastCallTime
```

响应：

```json
{
  "month": "2026-06",
  "page": 0,
  "pageSize": 20,
  "total": 1,
  "list": [
    {
      "userId": 3,
      "username": "sales01",
      "realName": "销售一号",
      "role": 3,
      "totalCalls": 188,
      "calledCustomers": 120,
      "connectedCalls": 56,
      "connectedCustomers": 45,
      "totalDuration": 3600,
      "avgDuration": 64.29,
      "connectRate": 0.2979,
      "customerConnectRate": 0.375,
      "firstCallTime": "2026-06-01T01:15:30.000Z",
      "lastCallTime": "2026-06-17T09:42:18.000Z"
    }
  ]
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `totalCalls` | 本月总拨打次数，来自 `agent_daily_summaries.total_calls` 月度汇总 |
| `calledCustomers` | 本月去重拨打客户/号码数，来自 `call_logs.customer_id` 去重统计 |
| `connectedCalls` | 本月接通次数，来自 `agent_daily_summaries.connected_calls` 月度汇总 |
| `connectedCustomers` | 本月去重接通客户/号码数，按 `call_logs.call_result = 1` 去重统计 |
| `connectRate` | 次数口径接通率，`connectedCalls / totalCalls`；无拨打时为 `0` |
| `customerConnectRate` | 号码口径接通率，`connectedCustomers / calledCustomers`；无拨打号码时为 `0` |
| `avgDuration` | 平均接通通话时长，`totalDuration / connectedCalls`；无接通时为 `0` |

业务规则：

- 月度次数指标来自 `agent_daily_summaries`，适合快速汇总员工工作量
- 月度号码数指标来自 `call_logs`，按 `Asia/Shanghai` 月初到下月月初范围统计
- **`role=3` 普通员工只能看到自己的月度数据**，不能通过 `userId` 查询他人
- 默认只返回当月有日报记录的用户
- 用户已禁用时，历史月度数据仍继续显示
- 不返回 `password_hash`
- 不返回 `salt`

错误响应：

| 状态码 | 场景 |
|--------|------|
| 400 | `month`、`userId` 或 `sort` 参数不合法 |
| 401 | 未登录、AccessToken 无效或用户已禁用 |
| 403 | 角色不在 `1`、`2`、`3` 范围内 |

curl：

经理或管理员查看所有员工月度统计：

```bash
curl 'http://localhost:8787/api/dashboard/agent-monthly?month=2026-06&page=0&pagesize=20&sort=-totalCalls' \
  -H "Authorization: Bearer <adminOrManagerAccessToken>"
```

普通员工查看自己的月度统计：

```bash
curl 'http://localhost:8787/api/dashboard/agent-monthly?month=2026-06' \
  -H "Authorization: Bearer <employeeAccessToken>"
```

---

## APP 核心交互流程

```
┌─────────────────────────────────────────────────────────────────┐
│  1. 登录                                                        │
│     POST /api/auth/login                                        │
│     存储 accessToken + refreshToken                             │
├─────────────────────────────────────────────────────────────────┤
│  2. 加载待拨列表                                                 │
│     GET /api/my-customers?page=0&pagesize=50                    │
│     展示：客户名称、手机号、公司                                  │
├─────────────────────────────────────────────────────────────────┤
│  3. 点击拨打                                                    │
│     APP 调用系统拨号盘 tel:手机号                                │
│     记录 startedAt = 当前时间                                    │
├─────────────────────────────────────────────────────────────────┤
│  4. 通话结束 → 弹出反馈弹窗                                     │
│     用户选择：已接听 / 无人接听 / 拒接 / 空号停机                │
│     已接听时填写备注，并手动选择线索类型                         │
├─────────────────────────────────────────────────────────────────┤
│  5. 提交通话结果                                                │
│     POST /api/calls/report                                      │
│     { customerId, duration, callResult, callRemark,             │
│       customerType, clientRequestId, startedAt, endedAt }       │
│     → 该客户自动从待拨列表消失                                   │
│     → 今日战报自动更新                                          │
├─────────────────────────────────────────────────────────────────┤
│  6. 查看战报（可选）                                            │
│     GET /api/my-summary                                         │
│     展示：总拨打、接通数、通话时长、首末次通话时间               │
├─────────────────────────────────────────────────────────────────┤
│  7. 查看历史（可选）                                            │
│     GET /api/my-customers/history                               │
│     展示：已拨打的客户记录，可按状态/类型筛选                    │
└─────────────────────────────────────────────────────────────────┘
```

## Token 过期处理

```
请求返回 401
    │
    ▼
调用 POST /api/auth/refresh（用 refreshToken 换新 accessToken）
    │
    ├── 成功 → 用新 accessToken 重试原请求
    │
    └── 失败（403）→ refreshToken 也过期了，跳转登录页
```

## 安全要点

- 员工只能看到分配给自己的客户，无法查看他人客户
- 员工无法修改客户归属、无法导出号码
- 通话记录不可篡改，上报后不可删除
- `clientRequestId` 建议每次上报都传，防止网络抖动导致重复提交
- 密码修改后当前 Token 仍有效，无需重新登录
