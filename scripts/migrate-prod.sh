#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# scripts/migrate-prod.sh
#
# Apply pending Supabase migrations to the production database.
#
# Usage:
#   ./scripts/migrate-prod.sh            # push all pending migrations
#   ./scripts/migrate-prod.sh --dry-run  # list pending without applying
#
# Requirements:
#   - supabase CLI  (brew install supabase/tap/supabase)
#   - .env in repo root with SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD,
#     and SUPABASE_ACCESS_TOKEN set  (see .env.example)
# -----------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

# Load .env
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env not found at $ENV_FILE"
  echo "       Copy .env.example -> .env and fill in the credentials."
  exit 1
fi

SUPABASE_PROJECT_REF="$(grep -m1 '^SUPABASE_PROJECT_REF=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r\n')"
SUPABASE_DB_PASSWORD="$(grep -m1 '^SUPABASE_DB_PASSWORD='  "$ENV_FILE" | cut -d= -f2- | tr -d '\r\n')"
SUPABASE_ACCESS_TOKEN="$(grep -m1 '^SUPABASE_ACCESS_TOKEN=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r\n')"

if [ -z "$SUPABASE_PROJECT_REF"  ]; then echo "ERROR: SUPABASE_PROJECT_REF not set in .env";  exit 1; fi
if [ -z "$SUPABASE_DB_PASSWORD"  ]; then echo "ERROR: SUPABASE_DB_PASSWORD not set in .env";   exit 1; fi
if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then echo "ERROR: SUPABASE_ACCESS_TOKEN not set in .env";  exit 1; fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: supabase CLI not found."
  echo "       Install with: brew install supabase/tap/supabase"
  exit 1
fi

echo "supabase CLI $(supabase --version)"

echo "Logging in to Supabase..."
supabase login --token "$SUPABASE_ACCESS_TOKEN"

echo "Linking project $SUPABASE_PROJECT_REF..."
supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"

cd "$REPO_ROOT"

if [ "${1:-}" = "--dry-run" ]; then
  echo "Dry run - migrations that would be applied:"
  supabase db push --dry-run 2>&1 || true
else
  echo "Pushing migrations to $SUPABASE_PROJECT_REF..."
  supabase db push
  echo "Done. Migrations applied successfully."
fi
