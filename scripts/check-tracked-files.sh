#!/usr/bin/env bash
set -euo pipefail

# Check names only: never read credentials, databases, or legacy booking files.
failed=0
while IFS= read -r -d '' file; do
  name=${file##*/}
  case "$file" in
    node_modules/*|*/node_modules/*)
      printf 'Forbidden tracked dependency: %s\n' "$file"
      failed=1
      continue
      ;;
  esac
  case "$name" in
    .env.example) continue ;;
    .env|.env.*|*.key|*.pem|*.db|*.db-*|*.sqlite|*.sqlite-*|*.sqlite3|*.sqlite3-*|*-wal|*-shm|bookings.json|bookings.json.*|stripe-products.json|*.log|credentials.json|*-credentials.json|token.json|tokens.json)
      printf 'Forbidden tracked runtime file: %s\n' "$file"
      failed=1
      ;;
  esac
done < <(git ls-files -z)
exit "$failed"
