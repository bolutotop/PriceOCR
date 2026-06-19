#!/usr/bin/env bash
# =============================================================================
# PriceOCR 自动部署脚本（轮询模式）
#
# 由 deploy/poller.sh 在检测到远端有新 commit 后调用：
#   bash deploy/deploy.sh <new_sha>
#
# 行为：
#   1. 智能依赖：package-lock 变了才 npm ci，否则跳过
#   2. 智能 Prisma：schema/migrations 变了才 prisma generate / migrate deploy
#   3. 智能构建：src/ 或 next.config 变了才 npm run build
#   4. PM2 reload 实现零停机
#   5. 失败时回滚到上一个 commit + 上一个可用 .next
#
# 注意：
#   本脚本假设 poller.sh 已经做了 git fetch + reset --hard origin/main，
#   即调用本脚本时 HEAD 已经是新 commit。$1 仅用于日志和回滚定位。
#
# 环境变量（可在 PM2 ecosystem 里覆盖）：
#   APP_NAME           PM2 中 Next.js 进程名，默认 priceocr
#   PREV_SHA           回滚目标（poller 会传入）
#   NPM_INSTALL        设 0 跳过 npm ci
#   NPM_BUILD          设 0 跳过 npm run build
#   PRISMA_DEPLOY      设 0 跳过 prisma 相关命令
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

APP_NAME="${APP_NAME:-priceocr}"
NEW_SHA="${1:-$(git rev-parse HEAD)}"
PREV_SHA="${PREV_SHA:-}"

cd "$(dirname "$0")/.."     # 切到仓库根
ROOT="$(pwd)"

log() { printf '[deploy %s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

log "=== START ==="
log "repo=$ROOT new=$NEW_SHA prev=$PREV_SHA"
log "node=$(node -v 2>/dev/null || echo NOT_FOUND) npm=$(npm -v 2>/dev/null || echo NOT_FOUND)"

# ---------- 1. 备份当前 .next，便于失败回滚 ----------
if [ -d ".next" ]; then
  rm -rf .next.bak 2>/dev/null || true
  cp -a .next .next.bak
  log "backed up .next -> .next.bak"
fi

# ---------- 2. 列出变更文件 ----------
if [ -n "$PREV_SHA" ]; then
  CHANGED_FILES="$(git diff --name-only "$PREV_SHA" "$NEW_SHA" 2>/dev/null || echo '')"
else
  # 首次部署或 prev 不可用：当作所有内容都变了
  CHANGED_FILES="$(git ls-files)"
fi
log "changed files:"
echo "$CHANGED_FILES" | head -50 | sed 's/^/    /'

changed() { echo "$CHANGED_FILES" | grep -q -E "$1"; }

rollback_code() {
  if [ -z "$PREV_SHA" ]; then
    log "no PREV_SHA, cannot rollback code"
    return
  fi
  log "ROLLBACK: code $NEW_SHA -> $PREV_SHA"
  git reset --hard "$PREV_SHA" || true
  if [ -d ".next.bak" ]; then
    rm -rf .next
    mv .next.bak .next
    log "ROLLBACK: .next restored"
  fi
}

# ---------- 3. 依赖 ----------
if [ "${NPM_INSTALL:-1}" = "1" ] && changed '^(package\.json|package-lock\.json)$'; then
  log "package-lock changed, running npm ci"
  if ! npm ci --no-audit --no-fund --silent; then
    log "npm ci FAILED"
    rollback_code
    exit 1
  fi
else
  log "skip npm ci"
fi

# ---------- 4. Prisma ----------
if [ "${PRISMA_DEPLOY:-1}" = "1" ]; then
  if changed '^(prisma/|package-lock\.json|package\.json)$'; then
    log "prisma artifact changed, running generate + migrate deploy"
    if ! npx prisma generate; then
      log "prisma generate FAILED"
      rollback_code
      exit 1
    fi
    if ! npx prisma migrate deploy; then
      log "prisma migrate deploy FAILED"
      rollback_code
      exit 1
    fi
  else
    log "skip prisma (no schema/migrations change)"
  fi
else
  log "skip prisma (PRISMA_DEPLOY=0)"
fi

# ---------- 5. 构建 ----------
NEED_BUILD=0
if [ "${NPM_BUILD:-1}" = "1" ]; then
  if changed '^(src/|public/|prisma/schema\.prisma|next\.config\.|tsconfig\.json|postcss\.config\.|eslint\.config\.|components\.json|package\.json|package-lock\.json)'; then
    NEED_BUILD=1
  fi
fi

if [ "$NEED_BUILD" = "1" ]; then
  log "building..."
  if ! npm run build; then
    log "BUILD FAILED, rolling back"
    rollback_code
    exit 1
  fi
  log "build ok"
else
  log "skip build (no relevant changes)"
fi

# ---------- 6. PM2 reload（零停机） ----------
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    log "pm2 reload $APP_NAME"
    pm2 reload "$APP_NAME" --update-env
  else
    log "WARN: pm2 process '$APP_NAME' not found, please pm2 start once first"
  fi
else
  log "WARN: pm2 not installed, skipping reload"
fi

# ---------- 7. 清理备份 ----------
rm -rf .next.bak 2>/dev/null || true

log "=== DONE: $PREV_SHA -> $NEW_SHA ==="
