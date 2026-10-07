#!/usr/bin/env sh
set -eu

: "${API_URL:?API_URL is required}"
: "${WEB_URL:?WEB_URL is required}"

API_URL="${API_URL%/}"
WEB_URL="${WEB_URL%/}"

echo "[smoke] API health"
api_health="$(curl -fsS "$API_URL/health")"
printf '%s' "$api_health" | grep -q '"status":"ok"'

echo "[smoke] Web health"
curl -fsS "$WEB_URL/health" | grep -q "ok"

echo "[smoke] Metrics endpoint must not be public in production"
metrics_code="$(curl -sS -o /tmp/handoff-metrics-response -w '%{http_code}' "$API_URL/internal/metrics")"
case "$metrics_code" in
  401|403) ;;
  *)
    echo "expected metrics endpoint to reject anonymous access; got HTTP $metrics_code" >&2
    exit 1
    ;;
esac

if [ -n "${SMOKE_SUBDOMAIN:-}" ]; then
  echo "[smoke] Resolve tenant"
  tenant_json="$(curl -fsS --get     --data-urlencode "subdomain=$SMOKE_SUBDOMAIN"     "$API_URL/v1/public/tenants/resolve")"

  tenant_id="$(printf '%s' "$tenant_json" | jq -r '.id // empty')"
  test -n "$tenant_id"

  if [ -n "${SMOKE_EMAIL:-}" ] && [ -n "${SMOKE_PASSWORD:-}" ]; then
    echo "[smoke] Authenticate test user"
    login_payload="$(jq -n       --arg tenantId "$tenant_id"       --arg email "$SMOKE_EMAIL"       --arg password "$SMOKE_PASSWORD"       --arg otp "${SMOKE_OTP:-}"       '{
        tenantId: $tenantId,
        email: $email,
        password: $password
      } + (if $otp == "" then {} else {otp: $otp} end)')"

    login_json="$(curl -fsS       -H "content-type: application/json"       -d "$login_payload"       "$API_URL/v1/auth/login")"

    token="$(printf '%s' "$login_json" | jq -r '.accessToken // empty')"
    test -n "$token"

    echo "[smoke] Read inbox"
    curl -fsS       -H "authorization: Bearer $token"       "$API_URL/v1/inbox?view=assigned&limit=1&offset=0"       | jq -e '.data != null and .pagination.limit == 1' >/dev/null
  fi
fi

echo "[smoke] success"
