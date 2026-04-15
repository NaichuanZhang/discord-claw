#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Discordclaw startup script — deploy + launch watchdog daemon
#
# 1. Kill existing daemon/bot processes
# 2. Run deployment pipeline (deploy.sh)
# 3. Start the watchdog daemon (which manages the bot process)
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env if present (for DISCORD_WEBHOOK_URL)
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

DISCORD_WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-}"

# ---------------------------------------------------------------------------
# Notification helper (best-effort, never blocks)
# ---------------------------------------------------------------------------
notify() {
  if [ -n "$DISCORD_WEBHOOK_URL" ]; then
    curl -sf -X POST "$DISCORD_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"content\":\"$1\"}" > /dev/null 2>&1 || true
  fi
}

# ---------------------------------------------------------------------------
# 0. Kill any existing daemon/bot instances
# ---------------------------------------------------------------------------
MY_PID=$$
echo "[start] Checking for existing instances..."
PIDS=$(ps aux | grep -E 'tsx.*src/(index|daemon/index)\.ts|node.*dist/index\.js' | grep -v grep | awk '{print $2}' || true)

if [ -n "$PIDS" ]; then
  for PID in $PIDS; do
    if [ "$PID" != "$MY_PID" ]; then
      echo "[start] Killing existing instance (PID $PID)..."
      kill "$PID" 2>/dev/null || true
    fi
  done
  # Give them a moment to shut down gracefully
  sleep 2
  # Force kill any that survived
  for PID in $PIDS; do
    if [ "$PID" != "$MY_PID" ] && kill -0 "$PID" 2>/dev/null; then
      echo "[start] Force killing PID $PID..."
      kill -9 "$PID" 2>/dev/null || true
    fi
  done
fi

# ---------------------------------------------------------------------------
# 1. Deploy (git pull, deps, migrations, build)
# ---------------------------------------------------------------------------
echo "[start] Running deployment pipeline..."
if ! bash "$SCRIPT_DIR/deploy.sh"; then
  notify "❌ discordclaw: deployment pipeline failed on $(hostname)"
  echo "[start] ERROR: deployment pipeline failed"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Start watchdog daemon (replaces this shell process)
# ---------------------------------------------------------------------------
CURRENT_COMMIT=$(git log --oneline -1)
echo "[start] Starting watchdog daemon ($CURRENT_COMMIT)..."
notify "🚀 discordclaw deploying: $CURRENT_COMMIT"
exec npx tsx src/daemon/index.ts
