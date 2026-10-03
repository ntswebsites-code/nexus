#!/usr/bin/env bash
# Runs the backend/api/scripts flow scripts ON the UAT host against a THROWAWAY schema (nexus_wp1_test) and a temporary
# API container on the compose network. The live schema and the live api container are never touched; no secret is printed.
# Usage (as root, in /opt/matanho-nexus): [SCRIPTS="test-nav test-risk"] [KEEP_DB=1] bash tools/uat/server-flows.sh
# Optional: unpack modified backend/api/{scripts,src,prisma} into /root/wp1-src to test code before it is built into an image.
# Results: /root/wp1-run/summary.txt, per-script logs /root/wp1-run/<script>.log
set -u
cd /opt/matanho-nexus
OUT=/root/wp1-run; mkdir -p $OUT/api
NET=matanho-nexus_default
IMG=matanho-nexus-api:latest
TDB=nexus_wp1_test
LIVEURL=$(grep -E '^DATABASE_URL=' .env.production | head -1 | cut -d= -f2-)
TESTURL=$(printf '%s' "$LIVEURL" | sed -E "s#/[^/?]+(\?.*)?\$#/$TDB\1#")
MYSQLC=$(docker compose -p matanho-nexus -f deploy/docker-compose.prod.yml ps -q mysql)
APPUSER=$(grep -E '^MYSQL_USER=' .env.production | cut -d= -f2-)
USERS=/root/wp1-uat-users.json
node -e 'const fs=require("fs");const u=JSON.parse(fs.readFileSync("/opt/matanho-nexus/secrets/users.json","utf8"));fs.writeFileSync(process.argv[1],JSON.stringify(u.filter(x=>x.persona).map(x=>({...x,email:x.persona+"@uat.matanho.test"}))),{mode:0o600})' $USERS
# SRC_OVERRIDE: dirs under /root/wp1-src (scripts, src, prisma) mounted over the image copies when present
MNT=""
for d in scripts src prisma; do [ -d /root/wp1-src/$d ] && MNT="$MNT -v /root/wp1-src/$d:/app/backend/api/$d:ro"; done
docker volume create wp1-storage >/dev/null
COMMON="--network $NET --env-file .env.production -e NODE_ENV=development -e COOKIE_DOMAIN= -e DATABASE_URL=$TESTURL -e STORAGE_DIR=/tmp/st -e PUBLIC_API_URL=http://nexus-wp1-api:4100 -v wp1-storage:/tmp/st"
resetdb() {
  docker exec $MYSQLC sh -c "mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -e \"DROP DATABASE IF EXISTS $TDB; CREATE DATABASE $TDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON $TDB.* TO '$APPUSER'@'%';\"" 2>&1 | grep -v Warning
  docker run --rm $COMMON $MNT $IMG sh -c "npx prisma migrate deploy --schema prisma/schema.prisma && npx tsx prisma/seed.ts" > $OUT/migrate.log 2>&1; echo "migrate rc=$?"
}
startapi() {
  docker rm -f nexus-wp1-api >/dev/null 2>&1
  if [ -d /root/wp1-src/src ]; then
    docker run -d --name nexus-wp1-api $COMMON $MNT $IMG npx tsx src/server.ts >/dev/null
  else
    docker run -d --name nexus-wp1-api $COMMON $IMG >/dev/null
  fi
  for i in $(seq 1 40); do docker exec nexus-wp1-api node -e "fetch('http://127.0.0.1:4100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break; sleep 2; done
}
SCRIPTS=${SCRIPTS:-"test-accounting test-admin-core test-cash test-clients-onboarding test-corporate-actions test-ibor-performance test-investee-workspace test-local-gaps test-nav test-orders test-portfolio test-recon test-reports test-research-privates test-risk test-wiring test-ws1 test-ws2 test-ws3 test-ws4 smoke-ws0 e2e-phase1"}
: > $OUT/summary.txt
for s in $SCRIPTS; do
  resetdb >> $OUT/summary.txt
  CONF=throwaway-db; EXTRA=""
  case $s in test-investee-workspace|test-local-gaps)
    CONF=local; EXTRA="-v $USERS:/app/secrets/uat-users.json:ro -v $USERS:/run/secrets/users.json:ro -e SEED_USERS_FILE=/run/secrets/users.json -e SEED_UAT_CONFIRM=1"
    docker run --rm $COMMON $EXTRA $MNT $IMG npx tsx prisma/seed-uat.ts > $OUT/seed-uat.log 2>&1; echo "seed-uat rc=$?" >> $OUT/summary.txt;;
  esac
  startapi
  timeout 900 docker run --rm $COMMON $EXTRA $MNT -e E2E_CONFIRM=$CONF -e E2E_API=http://nexus-wp1-api:4100 $IMG npx tsx scripts/$s.ts > $OUT/$s.log 2>&1; rc=$?
  p=$(grep -c "^  PASS" $OUT/$s.log); f=$(grep -c "^  FAIL" $OUT/$s.log)
  docker logs nexus-wp1-api > $OUT/api/$s.log 2>&1
  echo "$s rc=$rc pass=$p fail=$f" | tee -a $OUT/summary.txt
done
docker rm -f nexus-wp1-api >/dev/null 2>&1
[ "${KEEP_DB:-0}" = 1 ] || { docker exec $MYSQLC sh -c "mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -e \"DROP DATABASE IF EXISTS $TDB;\"" 2>&1 | grep -v Warning; docker volume rm wp1-storage >/dev/null 2>&1; }
echo DONE | tee -a $OUT/summary.txt
