#!/usr/bin/env bash
# Start a parallel Agentic Builder dev server (project B) using
# overrides from .env.parallel. See .env.parallel.example for setup.
#
# Project A keeps using .env.local on its own terminal — start it
# normally with `pnpm dev` (or `pnpm electron:dev`). This script does
# NOT touch .env.local.
#
# Usage:
#   ./scripts/start-parallel-dev.sh             # browser mode (next dev only)
#   ./scripts/start-parallel-dev.sh --electron  # next dev + Electron window

set -euo pipefail

MODE="browser"
if [ "${1:-}" = "--electron" ]; then
  MODE="electron"
elif [ -n "${1:-}" ]; then
  echo "✗ unknown flag: $1"
  echo "  usage: $0 [--electron]"
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.parallel"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found"
  echo "  Run: cp .env.parallel.example .env.parallel"
  echo "  Then edit values if you want different paths / DB."
  exit 1
fi

# Strict scope so .env.parallel keys reach `next dev` (and electron)
# but don't leak back to the parent shell after the script exits.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${PORT:=3001}"
: "${CODE_OUTPUT_DIR:=generated-code-b}"

echo "── Parallel Agentic Builder (mode=$MODE) ──"
echo "  PORT                              = $PORT"
echo "  CODE_OUTPUT_DIR                   = $CODE_OUTPUT_DIR"
echo "  BLUEPRINT_GENERATED_DATABASE_URL  = ${BLUEPRINT_GENERATED_DATABASE_URL:-(unset; falls back to .env.local)}"
echo ""
echo "  → Next.js will start at http://localhost:$PORT"
echo "  → Generated code will land in $REPO_ROOT/$CODE_OUTPUT_DIR"
if [ "$MODE" = "electron" ]; then
  echo "  → Electron window will load that URL with"
  echo "    --user-data-dir=$HOME/.agentic-builder-electron-b"
fi
echo ""

cd "$REPO_ROOT"
if [ "$MODE" = "electron" ]; then
  exec pnpm electron:dev:b
else
  exec pnpm dev
fi
