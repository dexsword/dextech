#!/usr/bin/env bash
set -euo pipefail

# Reject tracked dependencies, credentials, and runtime data
bash scripts/check-tracked-files.sh

# Install dependencies
npm ci

# Run project tests
npm test

# Check JavaScript syntax
while IFS= read -r -d '' file; do
  case "$file" in
    node_modules/*|*/node_modules/*) continue ;;
    *.js|*.cjs|*.mjs) node --check "./$file" ;;
  esac
done < <(git ls-files -z)


# Check temporary server health
smoke_dir=$(mktemp -d "$RUNNER_TEMP/dextech-health.XXXXXX")
server_log="$smoke_dir/server.log"
server_pid=''

# Invoked by the EXIT trap.
# shellcheck disable=SC2329
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if (( status != 0 )) && [[ -f "$server_log" ]]; then
    echo 'Synthetic server check failed; output suppressed.'
  fi
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    for _attempt in {1..5}; do
      if ! kill -0 "$server_pid" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    kill -KILL "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Keep dotenv loading and legacy bookings.json migration away from checkout data.
cp server.js "$smoke_dir/server.js"
ln -s "$GITHUB_WORKSPACE/node_modules" "$smoke_dir/node_modules"
release_sha=$(git rev-parse HEAD)
cd "$smoke_dir"
env -i PATH="$PATH" NODE_ENV=test HOST=127.0.0.1 PORT=3100 \
  APP_RELEASE_SHA="$release_sha" \
  DB_PATH="$smoke_dir/bookings.db" \
  node server.js > "$server_log" 2>&1 &
server_pid=$!

for _attempt in {1..30}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo 'Temporary server exited before becoming healthy.'
    exit 1
  fi
  if curl --fail --silent --show-error --max-time 2 \
    http://127.0.0.1:3100/health > "$smoke_dir/health.json" &&
    node -e 'const h = require(process.argv[1]); process.exit(h.status === "ok" && h.release_sha === process.argv[2] && h.confirmed_bookings === 0 && h.email_enabled === false && h.gcal_enabled === false ? 0 : 1)' "$smoke_dir/health.json" "$release_sha" &&
    kill -0 "$server_pid" 2>/dev/null; then
    echo 'Temporary server is healthy; integrations are disabled.'
    exit 0
  fi
  sleep 1
done
echo 'Timed out waiting for temporary server health.'
exit 1
