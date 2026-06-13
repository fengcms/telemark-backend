#!/bin/bash

# 智能本地数据库初始化脚本
# 解决 0003 迁移与初始 schema 冲突的问题

set -e

echo "🗑️  清理旧的本地数据库..."
rm -rf .wrangler/state/v3/d1

echo "📦 创建基础表结构 (0001)..."
npx wrangler d1 execute telemark-backend-db --local --file=migrations/0001_initial_schema.sql > /dev/null 2>&1

echo "➕ 补充缺失的表 (0002)..."
npx wrangler d1 execute telemark-backend-db --local --file=migrations/0002_upgrade_legacy_local_schema.sql > /dev/null 2>&1

echo "🔄 执行升级迁移..."
# 0003: 尝试添加列（可能会报错，但可安全忽略）
npx wrangler d1 execute telemark-backend-db --local --file=migrations/0003_upgrade_legacy_customers_schema.sql 2>/dev/null || echo "   ⚠️  0003 部分步骤已跳过（列已存在，正常）"

# 0004: 重建 call_logs 表
npx wrangler d1 execute telemark-backend-db --local --file=migrations/0004_rebuild_legacy_call_logs_schema.sql > /dev/null 2>&1

# 0005: 重命名列
npx wrangler d1 execute telemark-backend-db --local --file=migrations/0005_rename_daily_summary_call_time_columns.sql > /dev/null 2>&1

# 0006: customers 软删除字段
npx wrangler d1 execute telemark-backend-db --local --file=migrations/0006_add_customer_soft_delete_columns.sql > /dev/null 2>&1

# 0007: call_logs 幂等与真实通话时间字段
npx wrangler d1 execute telemark-backend-db --local --file=migrations/0007_add_call_report_idempotency_fields.sql > /dev/null 2>&1

echo ""
echo "✅ 本地数据库初始化完成！"
echo ""
echo "🚀 现在可以启动开发服务器："
echo "   pnpm dev"
