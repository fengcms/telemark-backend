#!/bin/bash

# Cloudflare D1 远程数据库备份脚本
# 使用交互式方式完成备份

set -e

DB_NAME="telemark-backend-db"
BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/d1_backup_${TIMESTAMP}.sql"

echo "📦 Cloudflare D1 数据库备份工具"
echo "================================"
echo "数据库名称: ${DB_NAME}"
echo "备份时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "输出文件: ${BACKUP_FILE}"
echo ""

# 创建备份目录
mkdir -p "${BACKUP_DIR}"

# 执行导出（wrangler 会提示确认）
npx wrangler d1 export "${DB_NAME}" --remote --output="${BACKUP_FILE}"

# 检查是否成功
if [ -f "${BACKUP_FILE}" ]; then
    echo ""
    echo "✅ 备份成功！"
    echo "📄 文件位置: ${BACKUP_FILE}"
    echo "📊 文件大小: $(du -h "${BACKUP_FILE}" | cut -f1)"
    
    # 显示文件前几行
    echo ""
    echo "📝 文件预览（前 10 行）："
    head -10 "${BACKUP_FILE}"
else
    echo ""
    echo "❌ 备份失败：未找到输出文件"
    exit 1
fi
