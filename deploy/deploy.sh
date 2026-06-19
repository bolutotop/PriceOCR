#!/usr/bin/env bash
# =============================================================================
# PriceOCR 自动部署脚本
#
# 由 deploy/webhook.js 在收到 GitHub push 事件后调用：
#   bash deploy/deploy.sh <commit_sha>
#
# 行为：
#   1. 拉取最新代码 (git fetch + reset --hard origin/main)
#   2. 智能依赖：package-lock 变了才 npm ci，否则跳过
#   3. 智能 Prisma：schema/migrations 变了才 prisma generate / migrate deploy
#   4. 智能构建：src/ 或 next.config 变了才 npm run build
#   5. PM2 reload 实现零停机
#   6. 失败时回滚代码 + 上一个可用 .next
#
# 环境变量（可在 PM2 ecosystem 里覆盖）：
#   APP_NAME           PM2 中 Next.js 进程名，默认 priceocr
#   DEPLOY_BRANCH      默认 main
#   NPM_INSTALL        设 0 跳过 npm ci
#   NPM_BUILD          设 0 跳过 npm run build
#   PRISMA_DEPLOY      设 0 跳过 prisma 相关命令
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

APP_NAME="${APP_NAME:-priceocr}"
BRANCH="${DEPLOY_BRANCH:-main}"
TARGET_SHA="${1:-}"

cd "$(dirname "$0")/.."     # 切到仓库根
ROOT="$(pwd)"

log() { printf '[deploy %s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

log "=== START ==="
log "repo=$ROOT branch=$BRANCH target=$TARGET_SHA"
log "node=$(node -v 2>/dev/null || echo NOT_FOUND) npm=$(npm -v 2>/dev/null || echo NOT_FOUND)"

# ---------- 1. 备份当前 .next，便于失败回滚 ----------
if [ -d ".next" ]; then
  rm -rf .next.bak 2>/dev/null || true
  cp -a .next .next.bak
  log "backed up .next -> .next.bak"
fi

# ---------- 2. 拉取代码 ----------
PREV_SHA="$(git rev-parse HEAD)"
log "current HEAD=$PREV_SHA"

git fetch origin "$BRANCH" --prune
git reset --hard "origin/$BRANCH"
NEW_SHA="$(git rev-parse HEAD)"
log "fetched, new HEAD=$NEW_SHA"

if [ "$PREV_SHA" = "$NEW_SHA" ]; then
  log "no new commits, nothing to do"
  rm -rf .next.bak 2>/dev/null || true
  exit 0
fi

# 列出变更文件
CHANGED_FILES="$(git diff --name-only "$PREV_SHA" "$NEW_SHA")"
log "changed files:"
echo "$CHANGED_FILES" | sed 's/^/    /'

changed() { echo "$CHANGED_FILES" | grep -q -E "$1"; }

rollback_code() {
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
# 注意：prisma 目录变化（schema / migrations）需要重新生成客户端 + 部署迁移。
#       package-lock 变了一般也需要 generate（@prisma/client 可能升级）。
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
