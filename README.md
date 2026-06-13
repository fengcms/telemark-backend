# Telemark Backend

海格装修电销管理后台后端服务，基于 Cloudflare Workers + Hono + D1 + Drizzle ORM 构建，为管理后台和员工外呼 APP 提供 RESTful API。

## 技术栈

| 类别 | 技术 | 说明 |
|------|------|------|
| 运行时 | Cloudflare Workers | Edge Serverless，全球部署 |
| Web 框架 | Hono | 轻量高性能，原生支持 Workers |
| 数据库 | Cloudflare D1 | Serverless SQLite |
| ORM | Drizzle ORM | 类型安全的 SQL 查询构建器 |
| 缓存/会话 | Cloudflare KV | 存储 RefreshToken 会话 |
| 语言 | TypeScript | 严格模式，ES2024 |
| 代码检查 | Biome | 格式化 + Lint 一体化 |
| 测试 | Vitest | Workers Pool 集成 |

## 项目结构

```
src/
├── controllers/       请求处理层，参数校验与响应
│   ├── auth.controller.ts
│   ├── call.controller.ts
│   ├── customer.controller.ts
│   └── user.controller.ts
├── db/                数据库定义
│   ├── index.ts       Drizzle 实例创建
│   └── schema.ts      表结构 & 关系定义
├── lib/               基础设施
│   └── KVManager.ts   KV 封装
├── repositories/      数据访问层，SQL 查询封装
│   ├── call.repository.ts
│   └── customer.repository.ts
├── routes/            路由注册
│   ├── auth.routes.ts
│   ├── auth.ts        认证核心（JWT、密码哈希、Token 刷新）
│   ├── call.routes.ts
│   ├── customer.routes.ts
│   └── user.routes.ts
├── services/          业务逻辑层
│   ├── auth.service.ts
│   ├── call.service.ts
│   ├── customer.service.ts
│   └── user.service.ts
├── utils/             工具函数
│   ├── crypto.ts      SHA-256、HMAC-SHA256、JWT 签发
│   └── query-builder.ts  动态查询参数构建
└── index.ts           应用入口，路由挂载
```

## 数据模型

```
┌──────────┐     ┌──────────┐     ┌───────────┐
│  users   │     │ batches  │     │ customers │
│──────────│     │──────────│     │───────────│
│ id (PK)  │◄────│creator_id│     │ id (PK)   │
│ username │     │ id (PK)  │◄────│ batch_id  │
│ role     │     │ name     │     │ owner_id  │────► users.id
│ status   │     │ source   │     │ phone     │
│ ...      │     │ cost     │     │ type      │
└──────────┘     └──────────┘     │ status    │
     ▲                            └───────────┘
     │                                 │
     │          ┌──────────────────────┤
     │          ▼                      ▼
     │   ┌──────────────┐    ┌────────────────┐
     │   │  call_logs   │    │assignment_logs │
     │   │──────────────│    │────────────────│
     │   │ user_id (FK) │    │ from_user_id   │
     │   │customer_id   │    │ to_user_id     │
     │   │ duration     │    │ operator_id    │
     │   │ call_result  │    │ action         │
     │   └──────────────┘    └────────────────┘
     │
     └─────────────────────────────────────────┐
                                                 ▼
                                    ┌────────────────────────┐
                                    │agent_daily_summaries   │
                                    │────────────────────────│
                                    │ user_id (FK)           │
                                    │ date                   │
                                    │ total_calls            │
                                    │ connected_calls        │
                                    │ total_duration         │
                                    └────────────────────────┘
```

角色枚举：`1` 超级管理员，`2` 经理，`3` 普通员工

客户状态：`0` 未拨打，`1` 已接听，`2` 无人接听，`3` 拒接，`4` 空号停机

客户类型：`0` 普通线索，`1` 意向客户

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm

### 安装依赖

```bash
pnpm install
```

### 本地数据库迁移

```bash
pnpm db:migrations:apply:local
```

### 启动开发服务器

```bash
pnpm dev
```

服务运行在 `http://localhost:8787`。

### 初始化管理员

首次使用需要初始化超级管理员（仅本地开发环境可用）：

```bash
curl -X POST http://localhost:8787/api/auth/init-admin \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9","realName":"超级管理员","phone":"13800000000"}'
```

> `password` 字段为 `SHA-256(明文密码)`，上述值对应明文 `password`。

### 登录获取 Token

```bash
curl -X POST http://localhost:8787/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9"}'
```

## API 概览

完整接口文档见 [docs/api.md](docs/api.md)。

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | /health | 健康检查 | 公开 |
| POST | /api/auth/init-admin | 初始化管理员 | 仅本地开发 |
| POST | /api/auth/login | 登录 | 公开 |
| POST | /api/auth/refresh | 刷新 Token | 公开 |
| POST | /api/auth/logout | 退出登录 | 已登录用户 |
| POST | /api/auth/change-password | 修改密码 | 已登录用户 |
| POST | /api/batches/import | 批量导入线索 | 管理员/经理 |
| GET | /api/customers | 客户列表 | 管理员/经理 |
| GET | /api/my-customers | 我的客户 | 经理/员工 |
| POST | /api/customers/assign | 分配/回收线索 | 管理员/经理 |
| GET | /api/users | 员工列表 | 管理员/经理 |
| POST | /api/users | 创建员工 | 管理员 |
| PATCH | /api/users/:id | 修改员工 | 管理员 |
| DELETE | /api/users/:id | 禁用员工 | 管理员 |
| POST | /api/calls/report | 回传通话结果 | 经理/员工 |
| GET | /api/my-summary | 今日战报 | 经理/员工 |

## 认证机制

```
┌──────────┐     password = SHA-256(明文)     ┌──────────┐
│  前端    │ ───────────────────────────────► │  后端    │
│          │                                  │          │
│          │     SHA-256(password + salt)     │          │
│          │     ═══════════════════════►     │ 比对DB   │
│          │                                  │          │
│          │  ◄─── accessToken (12h) ──────    │          │
│          │  ◄─── refreshToken (14d) ────    │  KV存储  │
└──────────┘                                  └──────────┘
```

- **AccessToken**：JWT (HS256)，12 小时有效期，通过 `Authorization: Bearer <token>` 传递
- **RefreshToken**：随机字符串，14 天有效期，存储在 Cloudflare KV，用于无感续期

## 开发命令

```bash
pnpm dev              # 启动本地开发服务器
pnpm deploy           # 部署到 Cloudflare
pnpm test             # 运行测试
pnpm lint             # 代码检查
pnpm lint:fix         # 自动修复代码问题
pnpm format           # 检查格式
pnpm format:fix       # 自动格式化
pnpm cf-typegen       # 生成 Workers 类型定义
pnpm db:migrations:apply:local  # 本地数据库迁移
```

## 部署

### 生产环境密钥

部署前务必通过 Wrangler 设置生产环境的 JWT 密钥：

```bash
npx wrangler secret put JWT_SECRET
```

### 部署命令

```bash
pnpm deploy
```

### 数据库迁移（生产）

```bash
npx wrangler d1 migrations apply telemark-backend-db
```

## Cloudflare 绑定

| 绑定 | 类型 | 用途 |
|------|------|------|
| `DB` | D1 Database | 主数据库 |
| `c_kv` | KV Namespace | RefreshToken 会话存储 |
| `JWT_SECRET` | 环境变量 | JWT 签名密钥 |

修改绑定后需运行 `pnpm cf-typegen` 更新类型定义。
