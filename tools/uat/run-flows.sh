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
PORT=${FLOW_API_PORT:-4190}
rest=${DB_ROOT_URL#mysql://}; cred=${rest%@*}; hostport=${rest#*@}
MU=${cred%%:*}; MP=${cred#*:}; MH=${hostport%%:*}; MPORT=${hostport#*:}
export DATABASE_URL="${DB_ROOT_URL}/${DB}" SHADOW_DATABASE_URL="${DB_ROOT_URL}/${DB}_shadow"
export NODE_ENV=development API_PORT=$PORT E2E_API="http://127.0.0.1:$PORT" E2E_CONFIRM=throwaway-db
export FILE_ENCRYPTION_KEY=${FILE_ENCRYPTION_KEY:-$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')}
export PUBLIC_API_URL="http://127.0.0.1:$PORT" STORAGE_DIR=${STORAGE_DIR:-/tmp/nexus-flow-storage}
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
  npx tsx prisma/seed.ts > /tmp/flow-seed.log 2>&1 || { echo "seed failed"; tail -20 /tmp/flow-seed.log; exit 2; }
  npx tsx src/server.ts > /tmp/flow-api.log 2>&1 &
  APIPID=$!
  for _ in $(seq 1 60); do curl -fs "http://127.0.0.1:$PORT/api/health" > /dev/null && break; sleep 1; done
  echo "=== $s"
  if npx tsx "scripts/$s.ts" > "/tmp/flow-$s.log" 2>&1; then echo "PASS $s ($(grep -c '^  PASS' "/tmp/flow-$s.log") checks)"; else echo "FAIL $s"; grep '^  FAIL' "/tmp/flow-$s.log" | head -20; fail=1; fi
  stopapi
done
exit $fail
