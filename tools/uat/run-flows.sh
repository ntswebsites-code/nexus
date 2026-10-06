#!/usr/bin/env bash
# Runs the API flow scripts (backend/api/scripts/test-*.ts) against a DISPOSABLE MySQL database, one fresh
# schema per script (some scripts assume no rows left behind by another). Used by CI (.github/workflows/ci.yml)
# and locally:
#   DB_ROOT_URL=mysql://root:pw@127.0.0.1:3306 bash tools/uat/run-flows.sh [script ...]
# Needs: node 22, npm ci done, the `mysql` client. Never point DB_ROOT_URL at a database you care about.
set -u
cd "$(dirname "$0")/../../backend/api"
: "${DB_ROOT_URL:?set DB_ROOT_URL=mysql://user:password@host:port (a server whose databases may be dropped)}"
DB=${FLOW_DB:-nexus_flow_test}
# 4190 is in Node's blocked-port list on some Windows hosts (undici reports "bad port"); 4181 is safe.
PORT=${FLOW_API_PORT:-4181}
rest=${DB_ROOT_URL#mysql://}; cred=${rest%@*}; hostport=${rest#*@}
MU=${cred%%:*}; MP=${cred#*:}; MH=${hostport%%:*}; MPORT=${hostport#*:}
export DATABASE_URL="${DB_ROOT_URL}/${DB}" SHADOW_DATABASE_URL="${DB_ROOT_URL}/${DB}_shadow"
export NODE_ENV=development API_PORT=$PORT E2E_API="http://localhost:$PORT" E2E_CONFIRM=throwaway-db
# UAT/prod example flags (GAP-001); flow scripts such as test-ws4 assert custodian/onboarding live.
export LP_LIVE_DOMAINS=${LP_LIVE_DOMAINS:-all} INVESTEE_LIVE_ACTIONS=${INVESTEE_LIVE_ACTIONS:-all}
export CUSTODIAN_LIVE=${CUSTODIAN_LIVE:-true} ONBOARDING_LIVE=${ONBOARDING_LIVE:-true}
export SEED_DEMO=${SEED_DEMO:-1}
export FILE_ENCRYPTION_KEY=${FILE_ENCRYPTION_KEY:-$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')}
# Use a repo-local path so Node on Windows resolves the same directory as the seed and download handlers.
export PUBLIC_API_URL="http://localhost:$PORT" STORAGE_DIR=${STORAGE_DIR:-$(pwd)/.flow-storage}
# Windows Git Bash: npx.cmd may not inherit exports; write a disposable env file for tsx children.
FLOW_ENV_FILE=/tmp/nexus-flow.env
write_flow_env() {
  cat >"$FLOW_ENV_FILE" <<EOF
E2E_API=$E2E_API
E2E_CONFIRM=$E2E_CONFIRM
API_PORT=$PORT
DATABASE_URL=$DATABASE_URL
PUBLIC_API_URL=$PUBLIC_API_URL
STORAGE_DIR=$STORAGE_DIR
FILE_ENCRYPTION_KEY=$FILE_ENCRYPTION_KEY
NODE_ENV=$NODE_ENV
LP_LIVE_DOMAINS=$LP_LIVE_DOMAINS
INVESTEE_LIVE_ACTIONS=$INVESTEE_LIVE_ACTIONS
CUSTODIAN_LIVE=$CUSTODIAN_LIVE
ONBOARDING_LIVE=$ONBOARDING_LIVE
SEED_DEMO=$SEED_DEMO
EOF
}
write_flow_env
TSX_ENV=(npx tsx --env-file="$FLOW_ENV_FILE")
# Scripts that need the seeded UAT personas (local gaps, investee workspace) are skipped here: they read
# secrets/uat-users.json, see docs/VERIFY.md.
SCRIPTS=("$@")
[ ${#SCRIPTS[@]} -gt 0 ] || SCRIPTS=(test-accounting test-cash test-clients-onboarding test-admin-core test-corporate-actions test-ibor-performance test-nav test-orders test-portfolio test-recon test-reports test-research-privates test-risk test-wiring test-ws1 test-ws2 test-ws3 test-ws4 smoke-ws0 e2e-phase1)
fail=0
APIPID=
stopapi() { [ -n "$APIPID" ] && kill "$APIPID" 2>/dev/null; wait "$APIPID" 2>/dev/null; APIPID=; }
trap stopapi EXIT
for s in "${SCRIPTS[@]}"; do
  MYSQL_PWD=$MP mysql -h "$MH" -P "$MPORT" -u "$MU" -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" || exit 2
  npx prisma migrate deploy --schema prisma/schema.prisma > /tmp/flow-migrate.log 2>&1 || { echo "migrate failed"; tail -20 /tmp/flow-migrate.log; exit 2; }
  "${TSX_ENV[@]}" prisma/seed.ts > /tmp/flow-seed.log 2>&1 || { echo "seed failed"; tail -20 /tmp/flow-seed.log; exit 2; }
  "${TSX_ENV[@]}" src/server.ts > /tmp/flow-api.log 2>&1 &
  APIPID=$!
  ready=0
  for _ in $(seq 1 90); do curl -fs "http://localhost:$PORT/api/health" > /dev/null && ready=1 && break; sleep 1; done
  if [ "$ready" != 1 ]; then echo "API not ready on port $PORT"; tail -15 /tmp/flow-api.log; exit 2; fi
  sleep 2
  echo "=== $s"
  if "${TSX_ENV[@]}" "scripts/$s.ts" > "/tmp/flow-$s.log" 2>&1; then echo "PASS $s ($(grep -c '^  PASS' "/tmp/flow-$s.log") checks)"; else echo "FAIL $s"; grep '^  FAIL' "/tmp/flow-$s.log" | head -20; tail -8 "/tmp/flow-$s.log"; fail=1; fi
  stopapi
done
exit $fail
