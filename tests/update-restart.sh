#!/usr/bin/env bash
# Isolated process snapshots: no real workers are stopped or started.
set -euo pipefail
SOURCE=$(realpath "${1:-update.sh}")
TEMP=$(mktemp -d)
trap 'rm -rf -- "$TEMP"' EXIT
source <(sed -n '/^wait_site_jobs() {/,/^cleanup() {/p' "$SOURCE" | sed '$d')
PHP_BIN=/test/php
AUTO_HORIZON=1; AUTO_QUEUE=0; AUTO_SCHEDULER=0
JOBS_RESTART_TIMEOUT=2
calls=0; mode=stable
snapshot_site_jobs() {
    calls=$((calls+1))
    JOB_COMMANDS=(horizon); JOB_PIDS=(100); JOB_STARTS=(1)
    case "$mode" in
        delayed) if (( calls < 3 )); then JOB_COMMANDS=(); JOB_PIDS=(); JOB_STARTS=(); fi;;
        crash) JOB_STARTS=("$calls");;
        missing) JOB_COMMANDS=(); JOB_PIDS=(); JOB_STARTS=();;
    esac
}
sleep() { command sleep 0.25; }
wait_site_jobs
[[ "$calls" == 2 ]]
calls=0; mode=delayed
wait_site_jobs
[[ "$calls" == 4 ]]
mode=crash
if wait_site_jobs > "$TEMP/crash" 2>&1; then echo 'Crash loop accepted'; exit 1; fi
grep -q 'Expected background services' "$TEMP/crash"
grep -q 'artisan up' "$TEMP/crash"
mode=missing
if wait_site_jobs > "$TEMP/missing" 2>&1; then echo 'Missing worker accepted'; exit 1; fi
grep -q 'Observed background services: horizon=0' "$TEMP/missing"
echo 'Updater restart: stable, delayed, crash-loop and missing-worker checks passed'
