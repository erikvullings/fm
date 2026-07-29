#!/usr/bin/env bash
# Generates the Fetch-based TypeScript client from frontend/openapi/openapi.json
# via Orval. Fails loudly until task 0010 adds frontend/orval.config.ts.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f frontend/orval.config.ts ]]; then
  echo "error: orval client generation is not implemented until task 0010; see TASKS/0010-orval-client-generation.md" >&2
  exit 1
fi

pnpm --dir frontend exec orval --config orval.config.ts
