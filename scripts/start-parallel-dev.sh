#!/usr/bin/env bash
# Start a parallel Agentic Builder dev server (project B) using
# overrides from .env.parallel. See .env.parallel.example for setup.
#
# Project A keeps using .env.local on its own terminal — start it
# normally with `pnpm dev`. This script does NOT touch .env.local.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.parallel"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found"
  echo "  Run: cp .env.parallel.example .env.parallel"
  echo "  Then edit values if you want different paths / DB."
  exit 1
fi

# Strict scope so .env.parallel keys reach `next dev` but don't leak
# back to the parent shell after the script exits.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${PORT:=3001}"
: "${CODE_OUTPUT_DIR:=generated-code-b}"

echo "── Parallel Agentic Builder ──"
echo "  PORT                              = $PORT"
echo "  CODE_OUTPUT_DIR                   = $CODE_OUTPUT_DIR"
echo "  BLUEPRINT_GENERATED_DATABASE_URL  = ${BLUEPRINT_GENERATED_DATABASE_URL:-(unset; falls back to .env.local)}"
echo ""
echo "  → Next.js will start at http://localhost:$PORT"
echo "  → Generated code will land in $REPO_ROOT/$CODE_OUTPUT_DIR"
echo ""

cd "$REPO_ROOT"
exec pnpm dev
