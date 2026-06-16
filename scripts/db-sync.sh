#!/bin/bash

set -e

DB_NAME="telemark-backend-db"
SYNC_DIR=".wrangler/sync"
BACKUP_DIR="backups"

TABLE_ORDER=("users" "batches" "customers" "common_call_remarks" "call_logs" "assignment_logs" "agent_daily_summaries")

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

confirm() {
	local msg="$1"
	echo -e "${YELLOW}⚠️  $msg${NC}"
	read -r -p "   确认继续？(y/N) " reply
	case "$reply" in
		y|Y|yes|YES) true ;;
		*) echo "已取消"; exit 0 ;;
	esac
}

ensure_dir() {
	mkdir -p "$1"
}

cmd_push() {
	info "准备将本地数据库同步到远程..."

	confirm "此操作将覆盖远程 D1 数据库 [${DB_NAME}] 的全部数据"

	info "备份远程数据库（以防万一）..."
	local backup_file="$BACKUP_DIR/remote-before-push-$(date +%Y%m%d%H%M%S).sql"
	ensure_dir "$BACKUP_DIR"
	npx wrangler d1 export "$DB_NAME" --remote --output="$backup_file" 2>/dev/null || warn "远程备份失败（可能远程库为空，可忽略）"

	info "应用远程数据库迁移（确保 schema 一致）..."
	npx wrangler d1 migrations apply "$DB_NAME" --remote 2>/dev/null || warn "远程迁移应用失败，继续尝试..."

	info "清空远程数据库所有表数据..."
	local clear_file="$SYNC_DIR/clear-remote-$(date +%Y%m%d%H%M%S).sql"
	ensure_dir "$SYNC_DIR"
	{
		for table in call_logs assignment_logs agent_daily_summaries common_call_remarks customers batches users; do
			echo "DELETE FROM ${table};"
		done
		echo "DELETE FROM sqlite_sequence;"
	} > "$clear_file"
	npx wrangler d1 execute "$DB_NAME" --remote --file="$clear_file"

	info "按依赖顺序逐表导出并导入本地数据..."
	ensure_dir "$SYNC_DIR"

	for table in "${TABLE_ORDER[@]}"; do
		info "  导出表: ${table}..."
		local table_file="$SYNC_DIR/push-${table}-$(date +%Y%m%d%H%M%S).sql"
		npx wrangler d1 export "$DB_NAME" --local --no-schema --table="$table" --output="$table_file" 2>/dev/null

		local size
		size=$(wc -c < "$table_file" | tr -d ' ')

		if [ "$size" -gt 5 ]; then
			info "  导入表: ${table} (${size} bytes)..."
			npx wrangler d1 execute "$DB_NAME" --remote --file="$table_file"
		else
			info "  跳过空表: ${table}"
		fi
	done

	success "本地数据已同步到远程！"
	echo ""
	info "下一步："
	echo "   pnpm deploy:full    # 部署代码到 Cloudflare"
}

cmd_pull() {
	info "准备将远程数据库同步到本地..."

	confirm "此操作将覆盖本地 D1 数据库的全部数据"

	info "备份本地数据库（以防万一）..."
	local backup_file="$BACKUP_DIR/local-before-pull-$(date +%Y%m%d%H%M%S).sql"
	ensure_dir "$BACKUP_DIR"
	npx wrangler d1 export "$DB_NAME" --local --output="$backup_file" 2>/dev/null || warn "本地备份失败（可能本地库为空，可忽略）"

	info "重建本地数据库（清空 + 重新迁移）..."
	rm -rf .wrangler/state/v3/d1
	npx wrangler d1 migrations apply "$DB_NAME" --local 2>/dev/null || true

	local clear_file="$SYNC_DIR/clear-local-$(date +%Y%m%d%H%M%S).sql"
	ensure_dir "$SYNC_DIR"
	{
		for table in call_logs assignment_logs agent_daily_summaries common_call_remarks customers batches users d1_migrations; do
			echo "DELETE FROM ${table};"
		done
		echo "DELETE FROM sqlite_sequence;"
	} > "$clear_file"
	npx wrangler d1 execute "$DB_NAME" --local --file="$clear_file"

	info "按依赖顺序逐表从远程导出并导入..."
	ensure_dir "$SYNC_DIR"

	for table in "${TABLE_ORDER[@]}"; do
		info "  导出表: ${table}..."
		local table_file="$SYNC_DIR/pull-${table}-$(date +%Y%m%d%H%M%S).sql"
		npx wrangler d1 export "$DB_NAME" --remote --no-schema --table="$table" --output="$table_file" 2>/dev/null

		local size
		size=$(wc -c < "$table_file" | tr -d ' ')

		if [ "$size" -gt 5 ]; then
			info "  导入表: ${table} (${size} bytes)..."
			npx wrangler d1 execute "$DB_NAME" --local --file="$table_file"
		else
			info "  跳过空表: ${table}"
		fi
	done

	success "远程数据已同步到本地！"
	echo ""
	info "下一步："
	echo "   pnpm dev    # 启动本地开发服务器"
}

cmd_backup() {
	local target="${1:-remote}"
	local backup_file="$BACKUP_DIR/${target}-$(date +%Y%m%d%H%M%S).sql"
	ensure_dir "$BACKUP_DIR"

	if [ "$target" = "remote" ]; then
		info "备份远程数据库..."
		npx wrangler d1 export "$DB_NAME" --remote --output="$backup_file"
	elif [ "$target" = "local" ]; then
		info "备份本地数据库..."
		npx wrangler d1 export "$DB_NAME" --local --output="$backup_file"
	else
		error "未知备份目标: $target (可选: remote / local)"
	fi

	local size
	size=$(wc -c < "$backup_file" | tr -d ' ')
	success "备份完成: $backup_file (${size} bytes)"
}

cmd_reset_local() {
	confirm "此操作将清空本地数据库并重新执行迁移，本地数据将全部丢失"

	info "清空本地数据库..."
	rm -rf .wrangler/state/v3/d1

	info "重新执行迁移..."
	npx wrangler d1 migrations apply "$DB_NAME" --local

	success "本地数据库已重置！"
	echo ""
	info "下一步："
	echo "   pnpm db:init:local    # 初始化基础数据"
	echo "   pnpm dev              # 启动开发服务器"
}

cmd_deploy() {
	info "应用远程数据库迁移..."
	npx wrangler d1 migrations apply "$DB_NAME" --remote

	info "部署 Worker 到 Cloudflare..."
	npx wrangler deploy

	success "部署完成！"
}

usage() {
	cat <<EOF
数据库同步工具

用法: $0 <命令>

命令:
  push          本地 → 远程：将本地数据库同步到远程 D1
  pull          远程 → 本地：将远程数据库同步到本地 D1
  backup [目标] 备份数据库（默认 remote，可选 local）
  reset-local   重置本地数据库（清空 + 重新迁移）
  deploy        一键部署：应用远程迁移 + 部署 Worker

示例:
  $0 push              # 在 A 电脑做完开发后，推到远程
  $0 pull              # 在 B 电脑开始开发前，从远程拉取
  $0 backup remote     # 备份远程数据库
  $0 backup local      # 备份本地数据库
  $0 reset-local       # 重置本地库
  $0 deploy            # 迁移 + 部署
EOF
}

case "${1:-}" in
	push)   cmd_push ;;
	pull)   cmd_pull ;;
	backup) cmd_backup "${2:-remote}" ;;
	reset-local) cmd_reset_local ;;
	deploy) cmd_deploy ;;
	*)      usage ;;
esac
