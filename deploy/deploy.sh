#!/usr/bin/env bash
# Matanho Nexus - repeatable UAT deploy (docs/DEV-PLAN-1DAY.md section 8). Runs ON the host as root.
#
#   bash deploy.sh <release> <service...>
#   e.g. bash /root/nexus-releases/uat-rc1/deploy/deploy.sh uat-rc1 api worker admin investor company
#
# Services: api worker admin investor onboarding company custodian mailpit
# (mysql and migrate are never restarted by this script; migrate runs once as a job).
#
# Steps (each logged to /root/nexus-backups/<release>/deploy.log):
#   1. mysqldump --single-transaction + file-store snapshot -> /root/nexus-backups/<release>/
#   2. tag the running images :pre-<release> (first run of a release only, so a re-run never
#      overwrites the rollback point)
#   3. move the directories the tarball replaces into the backup dir, then extract the tarball
#      (.env.production and secrets/ are never touched; the tarball is refused if it holds them)
#   4. docker compose build <services> in the background, logged to build.log
#   5. migrate once (the `migrate` job: prisma migrate deploy + seed.ts), optional UAT seed,
#      then `up -d --no-deps <services>` (one worker instance)
#   6. smoke suite (tools/uat/smoke.ts); on failure roll back with rollback.sh
#
# The tarball is /root/nexus-releases/<release>.tar.gz (tools/uat/pack-release.ps1 builds it).
#
# Knobs (environment):
#   RELEASE_TARBALL=<path>   tarball location (default above)
#   DETACH=1                 re-run under nohup/setsid and return; follow with tail -f deploy.log
#   SKIP_BACKUP=1 SKIP_EXTRACT=1 SKIP_BUILD=1 SKIP_MIGRATE=1   resume a partly finished deploy
#   SEED_UAT=1               run prisma/seed-uat.ts after migrate (needs secrets/users.json)
#   SEED_UAT_MFA_REQUIRED=1  ... and switch the mfa_required policy on
#   SMOKE=0                  skip the smoke suite
#   SMOKE_MODE=readonly|full readonly (default) never writes; full also runs S6-S11 (writes UAT data)
#   AUTO_ROLLBACK=0          on smoke failure stop and print the rollback command instead
#
# Only the compose project `matanho-nexus` and /opt/matanho-nexus are touched. Host nginx is
# never reloaded here: certbot owns the live config, so nginx changes are applied by hand
# (edit, `nginx -t`, `systemctl reload nginx`). The script prints a warning when the release
# changes deploy/nginx/matanho-nexus.conf.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/matanho-nexus}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/nexus-backups}"
RELEASES_DIR="${RELEASES_DIR:-/root/nexus-releases}"
PROJECT=matanho-nexus
COMPOSE_FILE=deploy/docker-compose.prod.yml
ALLOWED_SERVICES=(api worker admin investor onboarding company custodian mailpit)

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

[ "$#" -ge 2 ] || usage
REL="$1"; shift
if ! [[ "$REL" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$ ]] || [ "$REL" = latest ]; then
  echo "Refusing: '$REL' is not a valid release tag (letters, digits, . _ -; not 'latest')." >&2
  exit 2
fi
SERVICES=()
for s in "$@"; do
  ok=0
  for a in "${ALLOWED_SERVICES[@]}"; do [ "$s" = "$a" ] && ok=1; done
  [ "$ok" = 1 ] || { echo "Refusing: unknown or protected service '$s' (allowed: ${ALLOWED_SERVICES[*]})." >&2; exit 2; }
  SERVICES+=("$s")
done

BK="$BACKUP_ROOT/$REL"
LOG="$BK/deploy.log"
mkdir -p "$BK"
chmod 700 "$BACKUP_ROOT" "$BK"

# The app dir (and with it deploy/) is replaced in step 3, so both scripts are kept with the backup.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ "$SCRIPT_DIR" != "$BK" ]; then
  cp "$SCRIPT_DIR/deploy.sh" "$BK/deploy.sh"
  [ -f "$SCRIPT_DIR/rollback.sh" ] && cp "$SCRIPT_DIR/rollback.sh" "$BK/rollback.sh"
fi
ROLLBACK="$BK/rollback.sh"

if [ "${DETACH:-0}" = 1 ]; then
  DETACH=0 setsid nohup bash "$BK/deploy.sh" "$REL" "${SERVICES[@]}" >/dev/null 2>&1 < /dev/null &
  echo "Deploy of $REL started in the background (pid $!). Follow: tail -f $LOG"
  exit 0
fi

exec 9>/var/lock/matanho-nexus-deploy.lock
flock -n 9 || { echo "Another matanho-nexus deploy/rollback is running." >&2; exit 1; }

exec > >(tee -a "$LOG") 2>&1
log() { printf '%s [deploy %s] %s\n' "$(date -u +%FT%TZ)" "$REL" "$*"; }
die() { trap - ERR; log "FAILED: $*"; log "Rollback: bash $ROLLBACK $REL ${SERVICES[*]}"; exit 1; }
trap 'die "error on line $LINENO (exit $?)"' ERR

cd "$APP_DIR" || die "no app dir $APP_DIR"
compose() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"; }

# Image per service; api, worker and migrate share one image that the migrate service builds.
image_of() {
  case "$1" in
    api|worker) echo "matanho-nexus-api" ;;
    mailpit) echo "" ;;
    *) echo "matanho-nexus-$1" ;;
  esac
}
build_target() {
  case "$1" in
    api|worker) echo "migrate" ;;
    mailpit) echo "" ;;
    *) echo "$1" ;;
  esac
}
has_service() { local x; for x in "${SERVICES[@]}"; do [ "$x" = "$1" ] && return 0; done; return 1; }

log "=== deploy $REL: services ${SERVICES[*]} (app $APP_DIR, backups $BK) ==="

# ---------------------------------------------------------------- 1. backup
if [ "${SKIP_BACKUP:-0}" != 1 ]; then
  log "1/6 database dump"
  compose exec -T mysql sh -c 'exec mysqldump --single-transaction --quick --routines --triggers --no-tablespaces -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' 2>>"$BK/mysqldump.err" | gzip > "$BK/db.sql.gz"
  gzip -t "$BK/db.sql.gz" || die "database dump is not a valid gzip"
  gzip -dc "$BK/db.sql.gz" | tail -n 1 | grep -q 'Dump completed' || die "database dump incomplete (see $BK/mysqldump.err)"
  log "    db.sql.gz $(du -h "$BK/db.sql.gz" | cut -f1)"
  compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at" "$MYSQL_DATABASE"' 2>/dev/null > "$BK/migrations-before.txt" || true

  log "1/6 file-store snapshot"
  compose run --rm --no-deps -T --entrypoint tar api -czf - -C /data/storage . > "$BK/file-storage.tgz" 2>>"$BK/file-storage.err"
  gzip -t "$BK/file-storage.tgz" || die "file-store snapshot is not a valid gzip"
  log "    file-storage.tgz $(du -h "$BK/file-storage.tgz" | cut -f1)"
  compose ps --format '{{.Service}} {{.Image}} {{.Status}}' > "$BK/ps-before.txt" 2>/dev/null || compose ps > "$BK/ps-before.txt"
else
  log "1/6 backup skipped (SKIP_BACKUP=1)"
fi

# ---------------------------------------------------------------- 2. tag images
log "2/6 tag running images :pre-$REL"
declare -A seen=()
for s in "${SERVICES[@]}"; do
  img="$(image_of "$s")"
  [ -n "$img" ] || continue
  [ -z "${seen[$img]:-}" ] || continue
  seen[$img]=1
  if docker image inspect "$img:pre-$REL" >/dev/null 2>&1; then
    log "    $img:pre-$REL already exists - kept (first deploy of this release is the rollback point)"
  elif docker image inspect "$img:latest" >/dev/null 2>&1; then
    docker tag "$img:latest" "$img:pre-$REL"
    echo "$img $(docker image inspect -f '{{.Id}}' "$img:latest")" >> "$BK/images-pre.txt"
    log "    $img:latest -> $img:pre-$REL"
  else
    log "    $img:latest not present (new service) - nothing to tag"
  fi
done

# ---------------------------------------------------------------- 3. upload / extract
if [ "${SKIP_EXTRACT:-0}" != 1 ]; then
  TARBALL="${RELEASE_TARBALL:-$RELEASES_DIR/$REL.tar.gz}"
  log "3/6 extract $TARBALL"
  [ -f "$TARBALL" ] || die "tarball not found: $TARBALL"
  gzip -t "$TARBALL" || die "tarball is corrupt"
  tar -tzf "$TARBALL" | sed 's#^\./##' > "$BK/tarball-files.txt"
  if grep -Ev '\.example$' "$BK/tarball-files.txt" | grep -Eq '(^|/)\.env(\.[^/]*)?$|(^|/)secrets(/|$)|(^|/)node_modules/|(^|/)\.next/|(^|/)dist/|\.tsbuildinfo$'; then
    grep -Ev '\.example$' "$BK/tarball-files.txt" | grep -E '(^|/)\.env(\.[^/]*)?$|(^|/)secrets(/|$)|(^|/)node_modules/|(^|/)\.next/|(^|/)dist/|\.tsbuildinfo$' | head -n 20
    die "tarball contains env files, secrets, node_modules, .next or dist - rebuild it with tools/uat/pack-release.ps1"
  fi
  [ -s "$TARBALL.sha256" ] && { (cd "$(dirname "$TARBALL")" && sha256sum -c "$(basename "$TARBALL").sha256") || die "tarball checksum mismatch"; }

  mkdir -p "$BK/code"
  OLD_NGINX=""
  [ -f deploy/nginx/matanho-nexus.conf ] && OLD_NGINX="$(sha256sum deploy/nginx/matanho-nexus.conf | cut -d' ' -f1)"
  # Extracting never deletes files, so every top-level directory the release ships is moved out first.
  while IFS= read -r top; do
    case "$top" in
      ''|.|..|.env|.env.*|secrets|node_modules) continue ;;
    esac
    if [ -e "$APP_DIR/$top" ]; then
      if [ -e "$BK/code/$top" ]; then
        rm -rf "${APP_DIR:?}/$top"            # re-run: the pre-release copy is already saved
      else
        mv "$APP_DIR/$top" "$BK/code/$top"
      fi
    fi
  done < <(cut -d/ -f1 "$BK/tarball-files.txt" | sort -u)
  tar -xzf "$TARBALL" -C "$APP_DIR" --no-same-owner
  printf '%s\n%s\n' "$REL" "$(date -u +%FT%TZ)" > "$APP_DIR/RELEASE"
  log "    extracted $(wc -l < "$BK/tarball-files.txt") entries; previous code in $BK/code"
  NEW_NGINX="$(sha256sum deploy/nginx/matanho-nexus.conf 2>/dev/null | cut -d' ' -f1 || true)"
  if [ -n "$OLD_NGINX" ] && [ "$OLD_NGINX" != "$NEW_NGINX" ]; then
    log "    WARNING: deploy/nginx/matanho-nexus.conf changed in this release. Host nginx was NOT touched."
    log "             Apply by hand (certbot owns the live file), then: nginx -t && systemctl reload nginx"
  fi
else
  log "3/6 extract skipped (SKIP_EXTRACT=1)"
fi

# ---------------------------------------------------------------- 4. build
BUILD=()
for s in "${SERVICES[@]}"; do
  t="$(build_target "$s")"
  [ -n "$t" ] || continue
  case " ${BUILD[*]} " in *" $t "*) ;; *) BUILD+=("$t") ;; esac
done
if [ "${SKIP_BUILD:-0}" != 1 ] && [ "${#BUILD[@]}" -gt 0 ]; then
  log "4/6 build ${BUILD[*]} (log: $BK/build.log)"
  export BUILDKIT_PROGRESS=plain
  compose build "${BUILD[@]}" >> "$BK/build.log" 2>&1 &
  bpid=$!
  while kill -0 "$bpid" 2>/dev/null; do
    sleep 30
    log "    building... $(tail -n 1 "$BK/build.log" 2>/dev/null | cut -c1-150)"
  done
  wait "$bpid" || die "image build failed - see $BK/build.log"
  log "    build finished"
else
  log "4/6 build skipped"
fi
if has_service mailpit || [ -z "$(compose ps -q mailpit 2>/dev/null)" ]; then
  log "4/6 pull mailpit"
  compose pull mailpit
fi

# ---------------------------------------------------------------- 5. migrate + restart
if [ "${SKIP_MIGRATE:-0}" != 1 ]; then
  log "5/6 migrate (prisma migrate deploy + seed.ts) - once"
  compose run --rm --no-deps migrate 2>&1 | tee -a "$BK/migrate.log"
  compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at" "$MYSQL_DATABASE"' 2>/dev/null > "$BK/migrations-after.txt" || true
  log "    migrations applied: $(wc -l < "$BK/migrations-after.txt" 2>/dev/null || echo '?') (latest: $(tail -n 1 "$BK/migrations-after.txt" 2>/dev/null))"
else
  log "5/6 migrate skipped (SKIP_MIGRATE=1)"
fi
if [ "${SEED_UAT:-0}" = 1 ]; then
  log "5/6 UAT seed (prisma/seed-uat.ts)"
  SEED_ARGS=(-e SEED_UAT_CONFIRM=1)
  [ "${SEED_UAT_MFA_REQUIRED:-0}" = 1 ] && SEED_ARGS+=(-e SEED_UAT_MFA_REQUIRED=1)
  compose run --rm --no-deps "${SEED_ARGS[@]}" migrate npx tsx prisma/seed-uat.ts 2>&1 | tee -a "$BK/seed-uat.log"
fi

log "5/6 up -d --no-deps mailpit ${SERVICES[*]}"
compose up -d --no-deps mailpit
UP_ARGS=(-d --no-deps)
has_service worker && UP_ARGS+=(--scale worker=1)
compose up "${UP_ARGS[@]}" "${SERVICES[@]}"

if has_service api; then
  log "    waiting for api health"
  cid="$(compose ps -q api)"
  for _ in $(seq 1 60); do
    st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo missing)"
    [ "$st" = healthy ] && break
    sleep 3
  done
  [ "$st" = healthy ] || die "api is not healthy ($st) - docker compose -p $PROJECT -f $COMPOSE_FILE logs --tail 200 api"
  log "    api healthy"
fi
compose ps --format '{{.Service}} {{.Image}} {{.Status}}' > "$BK/ps-after.txt" 2>/dev/null || compose ps > "$BK/ps-after.txt"

# ---------------------------------------------------------------- 6. smoke
if [ "${SMOKE:-1}" = 1 ]; then
  log "6/6 smoke suite (mode ${SMOKE_MODE:-readonly})"
  trap - ERR
  set +e
  compose run --rm --no-deps \
    -e SMOKE_API=http://api:4100 \
    -e SMOKE_MODE="${SMOKE_MODE:-readonly}" \
    -e SMOKE_USERS_FILE=/run/secrets/users.json \
    -e SMOKE_MAILPIT=http://mailpit:8025 \
    -e SMOKE_PORTAL_ADMIN=http://admin:3100 \
    -e SMOKE_PORTAL_INVESTOR=http://investor:3101 \
    -e SMOKE_PORTAL_ONBOARDING=http://onboarding:3102 \
    -e SMOKE_PORTAL_COMPANY=http://company:3103 \
    -e SMOKE_PORTAL_CUSTODIAN=http://custodian:3104 \
    -e SMOKE_REPORT=/tmp/smoke-report.json \
    migrate npx tsx ../../tools/uat/smoke.ts 2>&1 | tee "$BK/smoke.log"
  rc=${PIPESTATUS[0]}
  set -e
  if [ "$rc" != 0 ]; then
    if [ "${AUTO_ROLLBACK:-1}" = 1 ]; then
      log "SMOKE FAILED (exit $rc) - rolling back"
      flock -u 9
      bash "$ROLLBACK" "$REL" "${SERVICES[@]}" || log "rollback reported an error - check $BK/rollback.log"
      exit 1
    fi
    die "smoke suite failed (exit $rc); AUTO_ROLLBACK=0 so nothing was rolled back"
  fi
else
  log "6/6 smoke skipped (SMOKE=0)"
fi

trap - ERR
log "=== deploy $REL OK: ${SERVICES[*]} ==="
log "Backups: $BK   Rollback: bash $ROLLBACK $REL ${SERVICES[*]}"
