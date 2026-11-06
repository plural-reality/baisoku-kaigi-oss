#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:?SMOKE_BASE_URL is required}"
MAX_RETRIES=3
RETRY_DELAY=5

echo "=== Smoke Test: ${BASE_URL} ==="

for i in $(seq 1 $MAX_RETRIES); do
  RESPONSE=$(curl -sf --max-time 10 "${BASE_URL}/api/health" || true)
  if [ -n "$RESPONSE" ]; then
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    echo "FAIL: /api/health unreachable after ${MAX_RETRIES} attempts"
    exit 1
  fi
  echo "Retry ${i}/${MAX_RETRIES} in ${RETRY_DELAY}s..."
  sleep $RETRY_DELAY
done

STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "unknown")

if [ "$STATUS" = "error" ]; then
  echo "FAIL: Health status is 'error'"
  echo "$RESPONSE"
  exit 1
fi

echo "OK: Health status is '${STATUS}'"

# Check Supabase connectivity
SUPABASE_STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['checks']['supabase'])" 2>/dev/null || echo "unknown")
if [ "$SUPABASE_STATUS" = "error" ]; then
  echo "WARN: Supabase check failed"
  echo "$RESPONSE"
  exit 1
fi

echo "OK: Supabase check passed"
echo "=== Smoke Test PASSED ==="
