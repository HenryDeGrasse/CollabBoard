#!/usr/bin/env bash
set -e

# Kill existing instances if running
pkill -f '_dev-server\.mjs' 2>/dev/null && echo "Killed existing dev server" || true
pkill -f 'vite' 2>/dev/null && echo "Killed existing vite" || true

# Brief pause to let ports free up
sleep 0.5

cd "$(dirname "$0")"

# Run both in background, forward output
npx tsx api/_dev-server.mjs &
PID1=$!

npm run dev &
PID2=$!

# Kill both on Ctrl+C
trap 'kill $PID1 $PID2 2>/dev/null; exit' INT TERM

wait
