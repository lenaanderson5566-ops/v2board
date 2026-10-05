#!/usr/bin/env bash
set -euo pipefail
SOURCE=$(realpath "${1:-update.sh}")
TEMP=$(mktemp -d)
PIDS=()
trap 'for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done; rm -rf "$TEMP"' EXIT
source <(sed -n '/^snapshot_site_jobs() {/,/^cleanup() {/p' "$SOURCE" | sed '$d')
die() { echo "$*" >&2; exit 1; }
mkdir "$TEMP/site" "$TEMP/other"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TEMP/php"
chmod +x "$TEMP/php"
PHP_BIN="$TEMP/php"
PROJECT="$TEMP/site"
AUTO_HORIZON=0
AUTO_QUEUE=0
AUTO_SCHEDULER=0
(cd "$PROJECT"; exec bash -c 'trap "exit 0" TERM; while :; do sleep 0.1; done' test artisan queue:work) &
site=$!; PIDS+=("$site")
(cd "$TEMP/other"; exec bash -c 'trap "exit 0" TERM; while :; do sleep 0.1; done' test artisan queue:work) &
other=$!; PIDS+=("$other")
sleep 0.2
drain_site_jobs
! kill -0 "$site" 2>/dev/null
kill -0 "$other"
(cd "$PROJECT"; exec bash -c 'trap "exit 0" TERM; while :; do sleep 0.1; done' test artisan queue:work --force) &
forced=$!; PIDS+=("$forced")
sleep 0.2
if (drain_site_jobs) > "$TEMP/output" 2>&1; then echo 'Forced worker accepted'; exit 1; fi
kill -0 "$forced"
grep -q 'bypasses maintenance' "$TEMP/output"
echo 'Updater drain: site worker stopped, other site untouched, forced worker rejected'
