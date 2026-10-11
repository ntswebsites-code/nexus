#!/usr/bin/env bash
# Matanho Nexus - roll a DEV deploy back. Runs ON the host as root.
#
#   bash rollback-dev.sh [--flags-off] [--restore-code] <release> <service...>
#   e.g. bash /root/nexus-backups-dev/uat-rc1/rollback-dev.sh --flags-off uat-rc1 api worker investor
#
# Retags the :pre-<release> images as :latest and recreates only the named services with
# `up -d --no-deps`. The schema is additive, so no down-migration is needed.
#   --flags-off     also blank LP_LIVE_DOMAINS / INVESTEE_LIVE_ACTIONS and set CUSTODIAN_LIVE /
#                   ONBOARDING_LIVE to false in .env.dev (a copy is kept in the backup dir,
#                   chmod 600) and recreate api, worker and every portal so they pick it up
#   --restore-code  put the pre-release source directories back (from <backup>/code) so the next
#                   build starts from the previous code
# Database restore is deliberately manual and guarded:
#   RESTORE_DB=1 RESTORE_DB_CONFIRM=<release>  load <backup>/db.sql.gz back into MySQL
# Only the compose project `matanho-nexus-dev` is touched; host nginx is never reloaded.
set -euo pipefail

# GUARD: Abort if not using dev configuration
if [ "${PROJECT:-}" != "matanho-nexus-dev" ] || [ "${APP_DIR:-}" != "/opt/matanho-nexus-dev" ]; then
  echo "ERROR: This is the DEV rollback script. It must only run with PROJECT=matanho-nexus-dev and APP_DIR=/opt/matanho-nexus-dev" >&2
  exit 1
fi

APP_DIR="${APP_DIR:-/opt/matanho-nexus-dev}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/nexus-backups-dev}"
PROJECT=matanho-nexus-dev
COMPOSE_FILE=deploy/docker-compose.dev.yml
ALLOWED_SERVICES=(api worker admin investor onboarding company custodian mailpit)

FLAGS_OFF=0
RESTORE_CODE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --flags-off) FLAGS_OFF=1; shift ;;
    --restore-code) RESTORE_CODE=1; shift ;;
    --) shift; break ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) break ;;
  esac
done
[ "$#" -ge 2 ] || { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
REL="$1"; shift
if ! [[ "$REL" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$ ]] || [ "$REL" = latest ]; then
  echo "Refusing: '$REL' is not a valid release tag." >&2
  exit 2
fi
SERVICES=()
for s in "$@"; do
  ok=0
  for a in "${ALLOWED_SERVICES[@]}"; do [ "$s" = "$a" ] && ok=1; done
  [ "$ok" = 1 ] || { echo "Refusing: unknown or protected service '$s'." >&2; exit 2; }
  SERVICES+=("$s")
done

BK="$BACKUP_ROOT/$REL"
mkdir -p "$BK"
chmod 700 "$BK"
LOG="$BK/rollback.log"

exec 9>/var/lock/matanho-nexus-dev-deploy.lock
flock -n 9 || { echo "Another matanho-nexus-dev deploy/rollback is running." >&2; exit 1; }

exec > >(tee -a "$LOG") 2>&1
log() { printf '%s [rollback-dev %s] %s\n' "$(date -u +%FT%TZ)" "$REL" "$*"; }
die() { trap - ERR; log "FAILED: $*"; exit 1; }
trap 'die "error on line $LINENO (exit $?)"' ERR

cd "$APP_DIR" || die "no app dir $APP_DIR"
compose() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"; }
image_of() {
  case "$1" in
    api|worker) echo "matanho-nexus-dev-api" ;;
    mailpit) echo "" ;;
    *) echo "matanho-nexus-dev-$1" ;;
  esac
}

log "=== rollback-dev $REL: ${SERVICES[*]} (flags-off=$FLAGS_OFF restore-code=$RESTORE_CODE) ==="

# 1. retag images
declare -A seen=()
for s in "${SERVICES[@]}"; do
  img="$(image_of "$s")"
  [ -n "$img" ] || continue
  [ -z "${seen[$img]:-}" ] || continue
  seen[$img]=1
  if docker image inspect "$img:pre-$REL" >/dev/null 2>&1; then
    docker image inspect "$img:latest" >/dev/null 2>&1 && docker tag "$img:latest" "$img:failed-$REL"
    docker tag "$img:pre-$REL" "$img:latest"
    log "    $img:pre-$REL -> $img:latest (the rejected build is kept as $img:failed-$REL)"
  else
    log "    WARNING: $img:pre-$REL does not exist (service was new in $REL?) - left as is"
  fi
done

# 2. source directories
if [ "$RESTORE_CODE" = 1 ]; then
  [ -d "$BK/code" ] || die "no saved code in $BK/code"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$BK/code-rejected-$ts"
  for d in "$BK/code"/* "$BK/code"/.[!.]*; do
    [ -e "$d" ] || continue
    name="$(basename "$d")"
    case "$name" in .env|.env.*|secrets) continue ;; esac
    [ -e "$APP_DIR/$name" ] && mv "$APP_DIR/$name" "$BK/code-rejected-$ts/$name"
    cp -a "$d" "$APP_DIR/$name"
  done
  log "    previous source restored; rejected source kept in $BK/code-rejected-$ts"
fi

# 3. runtime flags off
if [ "$FLAGS_OFF" = 1 ]; then
  ENV_FILE="$APP_DIR/.env.dev"
  [ -f "$ENV_FILE" ] || die "missing $ENV_FILE"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  install -m 600 "$ENV_FILE" "$BK/env.dev.before-flags-off.$ts"
  for k in LP_LIVE_DOMAINS INVESTEE_LIVE_ACTIONS CUSTODIAN_LIVE ONBOARDING_LIVE; do
    v=""
    case "$k" in CUSTODIAN_LIVE|ONBOARDING_LIVE) v=false ;; esac
    if grep -q "^$k=" "$ENV_FILE"; then
      sed -i -E "s|^$k=.*|$k=$v|" "$ENV_FILE"
    else
      printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
    fi
  done
  log "    runtime flags switched off in .env.dev (copy: env.dev.before-flags-off.$ts)"
  for s in api worker admin investor onboarding company custodian; do
    case " ${SERVICES[*]} " in *" $s "*) ;; *) [ -n "$(compose ps -q "$s" 2>/dev/null)" ] && SERVICES+=("$s") ;; esac
  done
fi

# 4. database (manual, guarded)
if [ "${RESTORE_DB:-0}" = 1 ]; then
  [ "${RESTORE_DB_CONFIRM:-}" = "$REL" ] || die "RESTORE_DB=1 needs RESTORE_DB_CONFIRM=$REL"
  [ -s "$BK/db.sql.gz" ] || die "no dump at $BK/db.sql.gz"
  log "    restoring database from $BK/db.sql.gz (api and worker stopped first)"
  compose stop api worker
  gzip -dc "$BK/db.sql.gz" | compose exec -T mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
  case " ${SERVICES[*]} " in *" api "*) ;; *) SERVICES+=(api) ;; esac
  case " ${SERVICES[*]} " in *" worker "*) ;; *) SERVICES+=(worker) ;; esac
  log "    database restored"
fi

# 5. recreate
UP_ARGS=(-d --no-deps --force-recreate)
case " ${SERVICES[*]} " in *" worker "*) UP_ARGS+=(--scale worker=1) ;; esac
log "    up ${UP_ARGS[*]} ${SERVICES[*]}"
compose up "${UP_ARGS[@]}" "${SERVICES[@]}"

case " ${SERVICES[*]} " in
  *" api "*)
    cid="$(compose ps -q api)"
    st=missing
    for _ in $(seq 1 60); do
      st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo missing)"
      [ "$st" = healthy ] && break
      sleep 3
    done
    [ "$st" = healthy ] || die "api not healthy after rollback ($st)"
    log "    api healthy"
    ;;
esac

trap - ERR
log "=== rollback-dev $REL done: ${SERVICES[*]} ==="
[ "$FLAGS_OFF" = 1 ] || log "Runtime flags unchanged. To switch domains back to demo data re-run with --flags-off."
[ "${RESTORE_DB:-0}" = 1 ] || log "Database untouched (additive schema). Dump if ever needed: $BK/db.sql.gz"