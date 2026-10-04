#!/usr/bin/env bash
# Matanho Nexus - nightly UAT data reset (docs/BUILD-PLAN.md 12.6, "Data reset"). Runs ON the host as root.
# Provided as a script only: nothing installs or schedules it. Run it by hand, or add the cron line below once the
# owner has agreed that testers want a clean start every night.
#
#   RESET_UAT_CONFIRM=matanho-nexus bash reset-uat.sh [reseed|restore]
#
#   reseed   (default) stop worker and api, wipe the UAT-created business data with the idempotent re-seed:
#            prisma migrate deploy, seed.ts, then seed-uat.ts (SEED_UAT_CONFIRM=1), then start api and worker.
#            The DB is NOT dropped; rows the seeds own are restored to their seeded state and testers' extra rows
#            stay unless they are covered by a restore.
#   restore  put back a pre-UAT database dump: BASELINE_DUMP (default /root/nexus-backups/uat-baseline/db.sql.gz),
#            then migrate deploy so a newer schema is brought forward, then start api and worker. This is the
#            true clean slate. Needs RESET_UAT_RESTORE_CONFIRM=<dump file name without path>.
#
# Always: refuses without RESET_UAT_CONFIRM=matanho-nexus, takes a mysqldump of the current state first
# (/root/nexus-backups/reset-<UTC stamp>/db.sql.gz), holds the deploy lock so it cannot overlap a deploy or rollback,
# and logs to the same directory. The file store, host nginx and other compose projects are never touched.
#
# Optional cron (root crontab, 02:30 Harare = 00:30 UTC), only after sign-off:
#   30 0 * * *  RESET_UAT_CONFIRM=matanho-nexus /opt/matanho-nexus/deploy/reset-uat.sh reseed >> /var/log/nexus-reset.log 2>&1
#
# Knobs: APP_DIR, BACKUP_ROOT, BASELINE_DUMP, KEEP_RESET_BACKUPS (default 7), SKIP_DUMP=1 (not recommended).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/matanho-nexus}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/nexus-backups}"
BASELINE_DUMP="${BASELINE_DUMP:-$BACKUP_ROOT/uat-baseline/db.sql.gz}"
KEEP="${KEEP_RESET_BACKUPS:-7}"
PROJECT=matanho-nexus
COMPOSE_FILE=deploy/docker-compose.prod.yml
MODE="${1:-reseed}"

case "$MODE" in reseed|restore) ;; *) echo "Usage: RESET_UAT_CONFIRM=$PROJECT bash $0 [reseed|restore]" >&2; exit 2 ;; esac
[ "${RESET_UAT_CONFIRM:-}" = "$PROJECT" ] || { echo "Refusing: set RESET_UAT_CONFIRM=$PROJECT (this wipes UAT data)." >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "Refusing: run as root on the UAT host." >&2; exit 2; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BK="$BACKUP_ROOT/reset-$STAMP"
mkdir -p "$BK"
chmod 700 "$BK"
LOG="$BK/reset.log"

exec 9>/var/lock/matanho-nexus-deploy.lock
flock -n 9 || { echo "Another matanho-nexus deploy, rollback or reset is running." >&2; exit 1; }

exec > >(tee -a "$LOG") 2>&1
log() { printf '%s [reset-uat %s] %s\n' "$(date -u +%FT%TZ)" "$MODE" "$*"; }
die() { trap - ERR; log "FAILED: $*"; log "api and worker may be stopped: bring them back with 'docker compose -p $PROJECT -f $COMPOSE_FILE up -d --no-deps api worker' from $APP_DIR"; exit 1; }
trap 'die "command failed at line $LINENO"' ERR

cd "$APP_DIR"
compose() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"; }
[ -f .env.production ] || die ".env.production not found in $APP_DIR"
[ -f secrets/users.json ] || log "warning: secrets/users.json missing, seed-uat will fail without SEED_USERS_FILE"

log "=== reset $STAMP ($MODE) ==="

# 1. safety dump of whatever is there now
if [ "${SKIP_DUMP:-0}" != 1 ]; then
  log "1/5 dump current database -> $BK/db.sql.gz"
  compose exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines "$MYSQL_DATABASE"' | gzip -9 > "$BK/db.sql.gz"
  [ -s "$BK/db.sql.gz" ] || die "the safety dump is empty"
else
  log "1/5 safety dump skipped (SKIP_DUMP=1)"
fi

# 2. stop writers (mysql, mailpit and the portals keep running; the portals show their own error state meanwhile)
log "2/5 stop worker and api"
compose stop worker api

# 3. data
if [ "$MODE" = restore ]; then
  [ -s "$BASELINE_DUMP" ] || die "no baseline dump at $BASELINE_DUMP"
  [ "${RESET_UAT_RESTORE_CONFIRM:-}" = "$(basename "$BASELINE_DUMP")" ] || die "restore needs RESET_UAT_RESTORE_CONFIRM=$(basename "$BASELINE_DUMP")"
  log "3/5 restore $BASELINE_DUMP"
  gzip -dc "$BASELINE_DUMP" | compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
  log "3/5 migrate deploy (brings an older dump up to the current schema; also runs seed.ts)"
  compose run --rm --no-deps migrate
else
  log "3/5 migrate deploy and seed.ts"
  compose run --rm --no-deps migrate
  log "3/5 re-seed UAT personas and data (seed-uat.ts, idempotent)"
  compose run --rm --no-deps -e SEED_UAT_CONFIRM=1 migrate npx tsx prisma/seed-uat.ts
fi

# 4. start
log "4/5 start api and worker (one worker instance)"
compose up -d --no-deps api
compose up -d --no-deps --scale worker=1 worker

# 5. verify and prune
log "5/5 wait for api health"
cid="$(compose ps -q api)"
ok=0
for _ in $(seq 1 40); do
  st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo none)"
  [ "$st" = healthy ] && { ok=1; break; }
  sleep 3
done
[ "$ok" = 1 ] || die "api did not become healthy within 2 minutes"
curl -fsS "http://127.0.0.1:4100/api/health?deep=1" > "$BK/health.json" || die "deep health check failed"
log "    health: $(cat "$BK/health.json")"

# keep the most recent KEEP reset backups only
ls -1dt "$BACKUP_ROOT"/reset-* 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  [ -n "$old" ] && [ "$old" != "$BK" ] && { log "    prune $old"; rm -rf -- "$old"; }
done

log "=== reset $STAMP done; safety dump: $BK/db.sql.gz ==="
