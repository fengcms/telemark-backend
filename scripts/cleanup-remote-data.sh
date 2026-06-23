#!/bin/bash

# ============================================================
# 线上测试数据清理工具
# ⚠️ 危险操作：会删除线上所有测试数据！
# ============================================================

set -e

DB_NAME="telemark-backend-db"
BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/pre-cleanup-backup_${TIMESTAMP}.sql"

echo "🧹 线上测试数据清理工具"
echo "================================"
echo "⚠️  警告：此操作将删除以下所有数据："
echo "   - 所有非超管员工账号"
echo "   - 所有批次和客户线索"
echo "   - 所有通话记录"
echo "   - 所有分配日志"
echo "   - 所有日报统计"
echo ""
echo "数据库: ${DB_NAME}"
echo "时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# 确认操作
read -p "❓ 是否继续？(输入 YES 确认): " confirm
if [ "$confirm" != "YES" ]; then
    echo "❌ 已取消操作"
    exit 1
fi

echo ""
echo "📦 步骤 1/4: 备份当前数据库..."
mkdir -p "${BACKUP_DIR}"
npx wrangler d1 export "${DB_NAME}" --remote --output="${BACKUP_FILE}" <<< "Y"
echo "✅ 备份完成: ${BACKUP_FILE}"
echo ""

echo "🗑️  步骤 2/4: 执行数据清理..."
npx wrangler d1 execute "${DB_NAME}" --remote --file="scripts/cleanup-test-data.sql" <<< "Y"
echo "✅ 数据库表清理完成"
echo ""

echo "🗑️  步骤 3/4: 清理 KV 数据 (RefreshTokens)..."
echo "⚠️  KV 数据需要通过 Cloudflare Dashboard 或 API 手动清理"
echo "   访问: https://dash.cloudflare.com → Workers → KV"
echo "   命名空间: telemark-backend-cache"
echo "   操作: 删除所有 key (或保留超管的)"
echo ""

echo "✅ 步骤 4/4: 验证清理结果..."
echo "当前用户列表（应该只有超管）："
npx wrangler d1 execute "${DB_NAME}" --remote --command="SELECT id, username, role, status FROM users;" <<< "Y"

echo ""
echo "各表记录数统计："
npx wrangler d1 execute "${DB_NAME}" --remote --command="
SELECT 'users' as table_name, COUNT(*) as count FROM users
UNION ALL SELECT 'batches', COUNT(*) FROM batches
UNION ALL SELECT 'customers', COUNT(*) FROM customers
UNION ALL SELECT 'call_logs', COUNT(*) FROM call_logs
UNION ALL SELECT 'assignment_logs', COUNT(*) FROM assignment_logs
UNION ALL SELECT 'agent_daily_summaries', COUNT(*) FROM agent_daily_summaries;
" <<< "Y"

echo ""
echo "================================"
echo "✅ 清理完成！"
echo ""
echo "📄 备份文件位置: ${BACKUP_FILE}"
echo "💡 如需恢复数据，执行:"
echo "   npx wrangler d1 execute ${DB_NAME} --remote --file=${BACKUP_FILE}"
