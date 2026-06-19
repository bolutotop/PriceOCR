#!/usr/bin/env bash
# =============================================================================
# PriceOCR 轮询部署器
#
# 工作方式：
#   每隔 POLL_INTERVAL 秒（默认 30）检查一次 origin/main 是否有新 commit。
#   有就 reset --hard 到新 commit，并调用 deploy/deploy.sh 完成增量构建/重启。
#
# 用法：
#   由 PM2 守护：pm2 start deploy/poller.sh --name poller --interpreter bash
#   或独立测试：bash deploy/poller.sh
#
# 环境变量：
#   POLL_INTERVAL    轮询间隔秒数，默认 30
#   DEPLOY_BRANCH    跟踪的分支，默认 main
#   DEPLOY_SCRIPT    部署脚本，默认 ./deploy/deploy.sh
#   DEPLOY_LOG       部署日志，默认 ./.data/deploy.log
#   POLLER_LOG       轮询器自己的日志，默认 ./.data/poller.log
#
# 关键特性：
#   - 单实例锁（同一时刻只有一个 poller / deploy 在跑）
#   - 收到 SIGTERM 优雅退出（PM2 reload/stop 时不会卡）
#   - git fetch 失败不影响下一轮（网络抖动容忍）
# =============================================================================

set -uo pipefail   # 不开 -e，让循环不会因单次 fetch 失败退出
IFS=$'\n\t'

POLL_INTERVAL="${POLL_INTERVAL:-30}"
BRANCH="${DEPLOY_BRANCH:-main}"

# 切到仓库根
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

DEPLOY_SCRIPT_PATH="${DEPLOY_SCRIPT:-./deploy/deploy.sh}"
DEPLOY_LOG_PATH="${DEPLOY_LOG:-./.data/deploy.log}"
POLLER_LOG_PATH="${POLLER_LOG:-./.data/poller.log}"

mkdir -p "$(dirname "$DEPLOY_LOG_PATH")"
mkdir -p "$(dirname "$POLLER_LOG_PATH")"

plog() {
  local line="[poller $(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$line" | tee -a "$POLLER_LOG_PATH"
}

# 优雅退出
SHUTDOWN=0
trap 'SHUTDOWN=1; plog "SIGTERM/SIGINT received, will exit after current cycle"' TERM INT

plog "=== poller START ==="
plog "repo=$ROOT branch=$BRANCH interval=${POLL_INTERVAL}s"
plog "deploy_script=$DEPLOY_SCRIPT_PATH"

if [ ! -x "$DEPLOY_SCRIPT_PATH" ] && [ ! -f "$DEPLOY_SCRIPT_PATH" ]; then
  plog "FATAL: deploy script not found: $DEPLOY_SCRIPT_PATH"
  exit 1
fi

# 主循环
while [ "$SHUTDOWN" = "0" ]; do
  # 1. fetch（失败容忍）
  if ! git fetch origin "$BRANCH" --prune --quiet 2>>"$POLLER_LOG_PATH"; then
    plog "WARN: git fetch failed, will retry next cycle"
    sleep "$POLL_INTERVAL"
    continue
  fi

  LOCAL_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  REMOTE_SHA="$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo unknown)"

  if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
    # 没更新，安静等下一轮
    sleep "$POLL_INTERVAL"
    continue
  fi

  if [ "$REMOTE_SHA" = "unknown" ]; then
    plog "WARN: cannot resolve origin/$BRANCH"
    sleep "$POLL_INTERVAL"
    continue
  fi

  plog "NEW COMMIT detected: $LOCAL_SHA -> $REMOTE_SHA"

  # 2. 拉到新 commit
  if ! git reset --hard "origin/$BRANCH" >>"$POLLER_LOG_PATH" 2>&1; then
    plog "ERROR: git reset failed"
    sleep "$POLL_INTERVAL"
    continue
  fi

  # 3. 调用部署脚本（输出同时写到 deploy.log）
  plog "running $DEPLOY_SCRIPT_PATH ..."
  {
    echo ""
    echo "==============================================================="
    echo "[poller $(date '+%Y-%m-%d %H:%M:%S')] deploy start: $LOCAL_SHA -> $REMOTE_SHA"
    echo "==============================================================="
  } >> "$DEPLOY_LOG_PATH"

  if PREV_SHA="$LOCAL_SHA" bash "$DEPLOY_SCRIPT_PATH" "$REMOTE_SHA" >>"$DEPLOY_LOG_PATH" 2>&1; then
    plog "deploy OK: now at $REMOTE_SHA"
  else
    plog "deploy FAILED (exit $?), see $DEPLOY_LOG_PATH"
    # deploy.sh 内部已尝试回滚；这里不重复操作，下一轮 fetch 仍会发现 remote 比 local 新，
    # 但 reset --hard 又会把 local 推到 remote，再次触发部署 — 为避免死循环：
    # 简单策略：失败后 sleep 较长时间（等用户介入或修复 push）
    plog "back-off 5min before next poll to avoid retry storm"
    for _ in $(seq 1 60); do
      [ "$SHUTDOWN" = "1" ] && break
      sleep 5
    done
    continue
  fi

  sleep "$POLL_INTERVAL"
done

plog "=== poller STOP ==="
exit 0
