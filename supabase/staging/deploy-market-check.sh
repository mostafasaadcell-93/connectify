#!/bin/bash
# Deploy market-check to the Connectify staging project only.
# Sign in first with: npx supabase login
# Do not pass a project ref. Do not set a scheduler secret.
set -euo pipefail
cd "$(dirname "$0")/../.."
REF="akgilfixljswqljmedmg"
PROD="yxkzjwcmmtiljakttyfh"
if [ "$#" -ne 0 ]; then
  echo "refusing extra arguments; this script deploys only ${REF}" >&2
  exit 1
fi
if printf '%s\n' "${SUPABASE_PROJECT_REF:-}" "${SUPABASE_URL:-}" "${SUPABASE_DB_URL:-}" | grep -q "${PROD}"; then
  echo "refusing production project" >&2
  exit 1
fi
exec npx --yes supabase functions deploy market-check --project-ref "${REF}"
