#!/usr/bin/env bash
# Exports the backend OpenAPI document to frontend/openapi/openapi.json.
# Fails loudly (instead of silently no-op'ing) until task 0009 wires up the
# `export-openapi` subcommand on fm-server.
set -euo pipefail
cd "$(dirname "$0")/.."

output_path="${1:-frontend/openapi/openapi.json}"

output="$(cargo run --quiet -p fm-server -- export-openapi "$output_path" 2>&1)" || {
  echo "$output" >&2
  exit 1
}

if [[ "$output" == *"not implemented yet"* ]]; then
  echo "error: fm-server export-openapi is not implemented until task 0009; see TASKS/0009-openapi-export-command.md" >&2
  exit 1
fi

echo "$output"
