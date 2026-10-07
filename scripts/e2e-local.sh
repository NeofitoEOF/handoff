#!/usr/bin/env sh
set -eu

API_URL="${API_URL:-http://localhost:3000}"
WEB_URL="${WEB_URL:-http://localhost:8080}"
PLATFORM_ADMIN_KEY="${PLATFORM_ADMIN_KEY:-local-platform-admin-key-000000000000000000}"

ADMIN_EMAIL="admin-e2e@example.test"
ADMIN_PASSWORD="AdminPassword-123!"
REVIEWER_EMAIL="reviewer-e2e@example.test"
REVIEWER_PASSWORD="ReviewerPassword-123!"
MANAGER_EMAIL="manager-e2e@example.test"
MANAGER_PASSWORD="ManagerPassword-123!"
WORKER_EMAIL="worker-e2e@example.test"
WORKER_PASSWORD="WorkerPassword-123!"
SUBDOMAIN="e2e-$(date +%s)"

json_post() {
  url="$1"
  payload="$2"
  token="${3:-}"
  if [ -n "$token" ]; then
    curl -fsS -H "content-type: application/json" -H "authorization: Bearer $token" -d "$payload" "$url"
  else
    curl -fsS -H "content-type: application/json" -d "$payload" "$url"
  fi
}

wait_http() {
  url="$1"
  attempts="${2:-60}"
  i=0
  until curl -fsS "$url" >/dev/null 2>&1; do
    i=$((i+1))
    if [ "$i" -ge "$attempts" ]; then
      echo "timeout waiting for $url" >&2
      exit 1
    fi
    sleep 2
  done
}

login() {
  tenant_id="$1"
  email="$2"
  password="$3"
  json_post "$API_URL/v1/auth/login" "$(jq -n     --arg tenantId "$tenant_id"     --arg email "$email"     --arg password "$password"     '{tenantId:$tenantId,email:$email,password:$password}')"     | jq -r '.accessToken'
}

invite_and_accept() {
  sector_id="$1"
  email="$2"
  role="$3"
  name="$4"
  password="$5"
  admin_token="$6"

  invitation="$(json_post "$API_URL/v1/sectors/$sector_id/invitations" "$(jq -n     --arg email "$email"     --arg role "$role"     '{email:$email,role:$role}')" "$admin_token")"

  token="$(printf '%s' "$invitation" | jq -r '.devInviteToken')"
  test -n "$token"

  json_post "$API_URL/v1/invitations/accept" "$(jq -n     --arg token "$token"     --arg name "$name"     --arg password "$password"     '{token:$token,name:$name,password:$password}')"
}

echo "[e2e] waiting API and web"
wait_http "$API_URL/health"
wait_http "$WEB_URL/health"

echo "[e2e] provision tenant"
provision="$(curl -fsS   -H "content-type: application/json"   -H "x-platform-admin-key: $PLATFORM_ADMIN_KEY"   -d "$(jq -n     --arg name "E2E Company"     --arg subdomain "$SUBDOMAIN"     --arg adminEmail "$ADMIN_EMAIL"     --arg adminName "E2E Admin"     --arg adminPassword "$ADMIN_PASSWORD"     '{name:$name,subdomain:$subdomain,adminEmail:$adminEmail,adminName:$adminName,adminPassword:$adminPassword}')"   "$API_URL/v1/platform/tenants")"

tenant_id="$(printf '%s' "$provision" | jq -r '.tenantId')"
admin_user_id="$(printf '%s' "$provision" | jq -r '.adminUserId')"
test -n "$tenant_id"
test -n "$admin_user_id"

admin_token="$(login "$tenant_id" "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
test -n "$admin_token"

echo "[e2e] create sectors"
origin="$(json_post "$API_URL/v1/sectors" '{"name":"Controladoria E2E"}' "$admin_token")"
destination="$(json_post "$API_URL/v1/sectors" '{"name":"Compras E2E"}' "$admin_token")"
origin_id="$(printf '%s' "$origin" | jq -r '.id')"
destination_id="$(printf '%s' "$destination" | jq -r '.id')"

echo "[e2e] add admin as manager of origin"
json_post "$API_URL/v1/sectors/$origin_id/members" "$(jq -n   --arg userId "$admin_user_id"   '{userId:$userId,role:"MANAGER"}')" "$admin_token" >/dev/null

echo "[e2e] invite reviewer, manager and worker"
reviewer_accept="$(invite_and_accept "$origin_id" "$REVIEWER_EMAIL" "APPROVER" "E2E Reviewer" "$REVIEWER_PASSWORD" "$admin_token")"
manager_accept="$(invite_and_accept "$destination_id" "$MANAGER_EMAIL" "MANAGER" "E2E Manager" "$MANAGER_PASSWORD" "$admin_token")"
worker_accept="$(invite_and_accept "$destination_id" "$WORKER_EMAIL" "MEMBER" "E2E Worker" "$WORKER_PASSWORD" "$admin_token")"

reviewer_id="$(printf '%s' "$reviewer_accept" | jq -r '.userId')"
manager_id="$(printf '%s' "$manager_accept" | jq -r '.userId')"
worker_id="$(printf '%s' "$worker_accept" | jq -r '.userId')"

reviewer_token="$(login "$tenant_id" "$REVIEWER_EMAIL" "$REVIEWER_PASSWORD")"
manager_token="$(login "$tenant_id" "$MANAGER_EMAIL" "$MANAGER_PASSWORD")"
worker_token="$(login "$tenant_id" "$WORKER_EMAIL" "$WORKER_PASSWORD")"

echo "[e2e] create and assign request"
due_at="$(date -u -d '+7 days' '+%Y-%m-%dT%H:%M:%SZ')"
request_json="$(json_post "$API_URL/v1/requests" "$(jq -n   --arg originSectorId "$origin_id"   --arg destinationSectorId "$destination_id"   --arg title "Fechamento E2E"   --arg dueAt "$due_at"   --arg competence "$(date -u '+%Y-%m')"   '{originSectorId:$originSectorId,destinationSectorId:$destinationSectorId,title:$title,dueAt:$dueAt,competence:$competence}')" "$admin_token")"
request_id="$(printf '%s' "$request_json" | jq -r '.id')"

json_post "$API_URL/v1/requests/$request_id/assign" "$(jq -n --arg assigneeUserId "$worker_id" '{assigneeUserId:$assigneeUserId}')" "$manager_token" >/dev/null

echo "[e2e] worker fills and submits two items"
item1="$(curl -fsS -X PUT   -H "content-type: application/json"   -H "authorization: Bearer $worker_token"   -d '{"data":{"documento":"NF-001","valor":1000}}'   "$API_URL/v1/requests/$request_id/items/NF-001")"
item2="$(curl -fsS -X PUT   -H "content-type: application/json"   -H "authorization: Bearer $worker_token"   -d '{"data":{"documento":"NF-002","valor":2000}}'   "$API_URL/v1/requests/$request_id/items/NF-002")"

item1_id="$(printf '%s' "$item1" | jq -r '.id')"
item2_id="$(printf '%s' "$item2" | jq -r '.id')"

json_post "$API_URL/v1/requests/$request_id/submit" '{}' "$worker_token" >/dev/null

echo "[e2e] reviewer partially approves"
json_post "$API_URL/v1/requests/$request_id/items/$item1_id/approve" '{}' "$reviewer_token" >/dev/null

correction_due="$(date -u -d '+2 days' '+%Y-%m-%dT%H:%M:%SZ')"
json_post "$API_URL/v1/requests/$request_id/items/$item2_id/return" "$(jq -n   --arg comment "Valor divergente no E2E"   --arg correctionDueAt "$correction_due"   '{comment:$comment,correctionDueAt:$correctionDueAt}')" "$reviewer_token" >/dev/null

echo "[e2e] worker corrects only returned item"
curl -fsS -X PUT   -H "content-type: application/json"   -H "authorization: Bearer $worker_token"   -d '{"data":{"documento":"NF-002","valor":2200}}'   "$API_URL/v1/requests/$request_id/items/NF-002" >/dev/null

json_post "$API_URL/v1/requests/$request_id/submit" '{}' "$worker_token" >/dev/null
json_post "$API_URL/v1/requests/$request_id/items/$item2_id/approve" '{}' "$reviewer_token" >/dev/null

echo "[e2e] close request"
close_json="$(json_post "$API_URL/v1/requests/$request_id/close" '{}' "$reviewer_token")"
printf '%s' "$close_json" | jq -e '.closed == true' >/dev/null

echo "[e2e] verify final state and audit chain"
detail="$(curl -fsS -H "authorization: Bearer $admin_token" "$API_URL/v1/requests/$request_id")"
printf '%s' "$detail" | jq -e '.request.status == "CLOSED"' >/dev/null

audit="$(curl -fsS -H "authorization: Bearer $admin_token" "$API_URL/v1/audit/verify")"
printf '%s' "$audit" | jq -e '.valid == true' >/dev/null

echo "[e2e] verify inbox endpoint for manager"
curl -fsS -H "authorization: Bearer $manager_token" "$API_URL/v1/inbox?view=sector&limit=10&offset=0"   | jq -e '.data != null' >/dev/null

echo "[e2e] success tenant=$tenant_id request=$request_id reviewer=$reviewer_id manager=$manager_id worker=$worker_id"
