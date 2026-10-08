#!/usr/bin/env bash
# For an old-branch upgrade, run a copy of this script OUTSIDE the checkout.
set -Eeuo pipefail
umask 077
ORIGINAL_ARGS=("$@")
INVOCATION_DIR=$PWD
SCRIPT_PATH=$(realpath "${BASH_SOURCE[0]}")
PHASE=preflight
CURRENT_MIGRATION=
BRANCH=codex/react-typescript-console
PROJECT=$PWD
PHP_BIN=php
COMPOSER_BIN=
LOCK_FILE=
DATABASE_BACKUP=
BACKUP_DIR=
WEB_USER=www
JOBS_STOPPED=0
CHECK_ONLY=0
RESOLVE_DEPENDENCIES=0
LOCAL_GEOIP=()
WORK_DIR=
BACKUP=
MAINTENANCE=0
OPEN_ON_SUCCESS=0
AUTO_HORIZON=0
AUTO_QUEUE=0
AUTO_SCHEDULER=0
JOB_PIDS=()
JOB_STARTS=()
JOB_COMMANDS=()
MIGRATION=database/migrations/2026_10_01_000001_add_trusted_x_forwarded_for_to_v2node.php
INVITATION_MIGRATION=database/migrations/2026_10_02_000001_create_email_invitations.php
CREDIT_MIGRATION=database/migrations/2026_10_02_000005_create_traffic_credits.php
BANNER_MIGRATION=database/migrations/2026_10_03_000002_create_banners.php
CONTENT_MIGRATION=database/migrations/2026_10_03_000001_add_notice_translations.php
NOTICE_MIGRATION=database/migrations/2026_10_02_000004_create_notice_reads.php
CURRENCY_MIGRATION=database/migrations/2026_10_05_000003_add_order_currency.php
EXPIRY_MIGRATION=database/migrations/2026_10_05_000002_create_credit_batches.php
REWARD_MIGRATION=database/migrations/2026_10_05_000001_create_invitation_rewards.php
RESET_MIGRATION=database/migrations/2026_10_02_000003_create_usage_resets.php
LANGUAGE_MIGRATION=database/migrations/2026_10_02_000002_add_language_to_users.php
NODE_DISPLAY_MIGRATION=database/migrations/2026_10_06_000001_add_node_display_metadata.php
SERVICE_MAIL_MIGRATION=database/migrations/2026_10_08_000001_add_service_notifications.php
usage() {
    cat <<'HELP'
Usage: bash update.sh [options]
  --project PATH          Existing Git checkout (default: current directory)
  --branch NAME           Default: codex/react-typescript-console
  --php PATH              PHP matching the website PHP-FPM
  --composer PATH         Existing Composer executable or phar
  --lock-file PATH        Tested target composer.lock (existing lock otherwise)
  --resolve-dependencies Resolve merged dependencies in an isolated temp directory
  --database-backup PATH  Optional: copy an existing database backup into file backup
  --backup-dir PATH       Private backup parent OUTSIDE the website
  --web-user NAME         Runtime user (default: www)
  --jobs-stopped          Manual mode: jobs already stopped; leave maintenance ON
  --check                 Preflight only; no checkout/install/migration
  --help
Database backups are operator-managed; no backup path is required.
Default: maintenance, drain site workers, migrate, verify, restart workers, reopen.
An existing maintenance state is preserved. Failed updates remain in maintenance.
Local additive Composer requirements and the three GeoLite2 databases are backed up.
Other tracked edits stop.
No historical update.sql replay, cache flush, or DB rollback.
HELP
}
die() { printf 'ERROR [%s]: %s\n' "$PHASE" "$*" >&2; exit 1; }
report_failure() {
    printf 'Command failed during %s at line %s.\n' "$PHASE" "$1" >&2
    if [[ -n "$CURRENT_MIGRATION" ]]; then
        printf 'Failed migration: %s\nFix the reported database error, then rerun the full updater with the same options.\nCompleted migrations are skipped; do not run unrestricted artisan migrate.\n' "$CURRENT_MIGRATION" >&2
    fi
}
run_migration() {
    CURRENT_MIGRATION=$1
    printf '\nApplying migration: %s\n' "$CURRENT_MIGRATION"
    "$PHP_BIN" artisan migrate --path="$CURRENT_MIGRATION" --force --no-interaction
    CURRENT_MIGRATION=
}
snapshot_site_jobs() {
    JOB_PIDS=(); JOB_STARTS=(); JOB_COMMANDS=()
    [[ -d /proc/self ]] || die 'Automatic worker draining requires Linux /proc; use --jobs-stopped for manual mode'
    local proc pid cwd arg command found args
    for proc in /proc/[0-9]*; do
        pid=${proc##*/}
        cwd=$(readlink "$proc/cwd" 2>/dev/null || true)
        [[ "$cwd" == "$PROJECT" ]] || continue
        args=(); mapfile -d '' -t args < "$proc/cmdline" 2>/dev/null || continue
        found=0; command=
        for arg in "${args[@]}"; do
            if (( found == 1 )); then command=$arg; break; fi
            [[ "$arg" == artisan || "$arg" == "$PROJECT/artisan" ]] && found=1
        done
        case "$command" in
            horizon|horizon:supervisor|horizon:work|queue:work|queue:listen|schedule:run|schedule:work|traffic:update|reset:traffic|reset:log|check:order|check:commission|check:ticket|check:renewal|send:remindMail|v2board:statistics|clients:check-releases|credits:expire)
                for arg in "${args[@]}"; do [[ "$arg" != --force && "$arg" != --force=* ]] || die 'A site worker bypasses maintenance with --force; stop it manually and use --jobs-stopped'; done
                JOB_PIDS+=("$pid")
                JOB_STARTS+=("$(awk '{print $22}' "$proc/stat" 2>/dev/null || true)")
                JOB_COMMANDS+=("$command");;
        esac
    done
}
drain_site_jobs() {
    # Maintenance blocks new normal queue jobs and scheduled events. Drain existing
    # invocations gracefully, scoped by this checkout's cwd, not all BaoTa workers.
    "$PHP_BIN" -r '
require "vendor/autoload.php"; $app=require "bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$check=function($items) use (&$check) { foreach($items as $key=>$value) {
if ($key==="force" && $value) throw new RuntimeException("Horizon force mode requires manual worker shutdown");
if(is_array($value)) $check($value);
}}; $check(config("horizon",[]));
'
    snapshot_site_jobs
    local i pid started deadline=$((SECONDS+720)) waiting
    for i in "${!JOB_PIDS[@]}"; do
        pid=${JOB_PIDS[$i]}
        case "${JOB_COMMANDS[$i]}" in
            horizon) AUTO_HORIZON=1; kill -TERM "$pid" 2>/dev/null || true;;
            queue:work|queue:listen) AUTO_QUEUE=1; kill -TERM "$pid" 2>/dev/null || true;;
            schedule:work) AUTO_SCHEDULER=1; kill -TERM "$pid" 2>/dev/null || true;;
        esac
    done
    while :; do
        waiting=0
        for i in "${!JOB_PIDS[@]}"; do
            pid=${JOB_PIDS[$i]}; started=$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || true)
            [[ -n "$started" && "$started" == "${JOB_STARTS[$i]}" ]] && waiting=1
        done
        (( waiting == 1 )) || break
        (( SECONDS < deadline )) || die 'Workers did not drain within 12 minutes; maintenance retained. Check the site Supervisor before retrying'
        sleep 2
    done
    printf 'Site jobs drained; maintenance prevents new jobs during migration.\n'
}
cleanup() {
    local result=$?
    trap - EXIT
    if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then rm -rf -- "$WORK_DIR"; fi
    if (( result != 0 && MAINTENANCE == 1 )); then
        printf '\nFailed: keep maintenance and background jobs stopped.\nBackup: %s\nRead DEPLOYMENT.txt before rollback.\n' "$BACKUP" >&2
    fi
    exit "$result"
}
trap cleanup EXIT
trap 'report_failure "$LINENO"' ERR
while (( $# )); do
    case "$1" in
        --project|--branch|--php|--composer|--lock-file|--database-backup|--backup-dir|--web-user)
            (( $# >= 2 )) || die "Missing value for $1"
            case "$1" in
                --project) PROJECT=$2;; --branch) BRANCH=$2;; --php) PHP_BIN=$2;;
                --composer) COMPOSER_BIN=$2;; --lock-file) LOCK_FILE=$2;;
                --database-backup) DATABASE_BACKUP=$2;; --backup-dir) BACKUP_DIR=$2;;
                --web-user) WEB_USER=$2;;
            esac
            shift 2;;
        --jobs-stopped) JOBS_STOPPED=1; shift;;
        --check) CHECK_ONLY=1; shift;;
        --resolve-dependencies) RESOLVE_DEPENDENCIES=1; shift;;
        --help|-h) usage; exit 0;;
        *) die "Unknown option: $1";;
    esac
done
for tool in git tar sha256sum realpath cmp flock awk readlink; do command -v "$tool" >/dev/null || die "Missing $tool"; done
PROJECT=$(realpath "$PROJECT")
cd "$PROJECT"
[[ "$(git rev-parse --show-toplevel)" == "$PROJECT" ]] || die 'Project must be the repository root'
git check-ref-format --branch "$BRANCH" >/dev/null || die 'Invalid branch'
git diff --cached --quiet || die 'Review staged changes first'
while IFS= read -r changed; do
    case "$changed" in
        ''|composer.json) ;;
        storage/geoip/GeoLite2-ASN.mmdb|storage/geoip/GeoLite2-City.mmdb|storage/geoip/GeoLite2-Country.mmdb)
            [[ -f "$changed" && ! -L "$changed" ]] || die "GeoIP change is not a regular file: $changed"
            LOCAL_GEOIP+=("$changed");;
        *) die "Review tracked change first: $changed";;
    esac
done < <(git diff --name-only)
[[ -s .env && -s config/v2board.php ]] || die 'Existing .env and config/v2board.php required'
PHP_BIN=$(command -v "$PHP_BIN") || die 'PHP executable not found'
if [[ -z "$COMPOSER_BIN" ]]; then
    if [[ -f composer.phar ]]; then COMPOSER_BIN="$PROJECT/composer.phar";
    else COMPOSER_BIN=$(command -v composer || true); fi
fi
[[ -f "$COMPOSER_BIN" ]] || die 'Provide an existing Composer executable/phar with --composer'
COMPOSER_BIN=$(realpath "$COMPOSER_BIN")
LOCK_FILE=$(realpath "${LOCK_FILE:-$PROJECT/composer.lock}")
[[ -s "$LOCK_FILE" ]] || die 'Provide tested target composer.lock with --lock-file'
OLD_COMMIT=$(git rev-parse HEAD)
OLD_BRANCH=$(git symbolic-ref --short -q HEAD || true)
git fetch origin "refs/heads/$BRANCH"
TARGET=$(git rev-parse FETCH_HEAD)
# Run the updater from the fetched target, outside the checkout. The running Bash
# file must not be overwritten by git merge, and an old allowlist cannot omit new migrations.
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/v2board-update.XXXXXXXX")
git show "$TARGET:update.sh" > "$WORK_DIR/target-update.sh"
if ! cmp -s -- "$SCRIPT_PATH" "$WORK_DIR/target-update.sh"; then
    printf 'Using target updater from %s (%s).\n' "$TARGET" "$BRANCH"
    if (cd "$INVOCATION_DIR"; bash "$WORK_DIR/target-update.sh" "${ORIGINAL_ARGS[@]}"); then exit 0; else exit $?; fi
fi
# Serialize actual deployments after target-script handoff.
if (( CHECK_ONLY == 0 )); then
    exec 9>"$(git rev-parse --git-path update.lock)"
    flock -n 9 || die 'Another updater is running for this checkout'
fi
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git merge-base --is-ancestor "refs/heads/$BRANCH" "$TARGET" || die 'Local target branch diverges or is ahead; reconcile it first'
fi
for protected in .env config/v2board.php; do
    if git cat-file -e "$TARGET:$protected" 2>/dev/null; then die "Target must not track $protected"; fi
done
git cat-file -e "$TARGET:public/console/.vite/manifest.json" || die 'Target has no built frontend manifest'
git cat-file -e "$TARGET:$MIGRATION" || die 'Target lacks the approved migration'
git cat-file -e "$TARGET:$INVITATION_MIGRATION" || die 'Target lacks the email invitation migration'
git cat-file -e "$TARGET:$LANGUAGE_MIGRATION" || die 'Target lacks the user language migration'
git cat-file -e "$TARGET:$CREDIT_MIGRATION" || die 'Target lacks the traffic credit migration'
git cat-file -e "$TARGET:$BANNER_MIGRATION" || die 'Target lacks the banner migration'
git cat-file -e "$TARGET:$CONTENT_MIGRATION" || die 'Target lacks the notice translations migration'
git cat-file -e "$TARGET:$NOTICE_MIGRATION" || die 'Target lacks the announcement read migration'
git cat-file -e "$TARGET:$CURRENCY_MIGRATION" || die 'Target lacks order currency migration'
git cat-file -e "$TARGET:$EXPIRY_MIGRATION" || die 'Target lacks credit expiry migration'
git cat-file -e "$TARGET:$REWARD_MIGRATION" || die 'Target lacks the invitation rewards migration'
git cat-file -e "$TARGET:$SERVICE_MAIL_MIGRATION" || die 'Target lacks the service notification migration'
git cat-file -e "$TARGET:$NODE_DISPLAY_MIGRATION" || die 'Target lacks the node display metadata migration'
git cat-file -e "$TARGET:$RESET_MIGRATION" || die 'Target lacks the usage reset migration'
while IFS= read -r changed; do
    [[ -z "$changed" || "$changed" == "$MIGRATION" || "$changed" == "$INVITATION_MIGRATION" || "$changed" == "$LANGUAGE_MIGRATION" || "$changed" == "$CURRENCY_MIGRATION" || "$changed" == "$EXPIRY_MIGRATION" || "$changed" == "$REWARD_MIGRATION" || "$changed" == "$RESET_MIGRATION" || "$changed" == "$NOTICE_MIGRATION" || "$changed" == "$CREDIT_MIGRATION" || "$changed" == "$CONTENT_MIGRATION" || "$changed" == "$BANNER_MIGRATION" || "$changed" == "$NODE_DISPLAY_MIGRATION" || "$changed" == "$SERVICE_MAIL_MIGRATION" ]] || die "Unexpected migration: $changed; review scope first"
done < <(git diff --name-only "$OLD_COMMIT" "$TARGET" -- database/migrations)
git show "$TARGET:composer.json" > "$WORK_DIR/composer.json"
git show "$OLD_COMMIT:composer.json" > "$WORK_DIR/original-composer.json"
# A manual checkout can leave a legacy Composer file on the new branch.
mkdir "$WORK_DIR/composer-history"
history_index=0
while IFS= read -r revision; do
    history_index=$((history_index + 1))
    candidate=$(printf '%06d-%s.json' "$history_index" "$revision")
    git show "$revision:composer.json" > "$WORK_DIR/composer-history/$candidate"
done < <(git log -100 --format=%H "$TARGET" "$OLD_COMMIT" -- composer.json)
# Carry over additive package requirements only, never local scripts or repositories.
"$PHP_BIN" -r '
$local=json_decode(file_get_contents($argv[2]),true,512,JSON_THROW_ON_ERROR);
$target=json_decode(file_get_contents($argv[3]),true,512,JSON_THROW_ON_ERROR);
function mergeRequirements($old,$local,$target) {
foreach (["require","require-dev"] as $section) {
    foreach ($old[$section]??[] as $name=>$constraint) {
        if (($local[$section][$name]??null)!==$constraint) throw new RuntimeException("Changed existing dependency: ".$name);
    }
    foreach ($local[$section]??[] as $name=>$constraint) {
        if (isset($old[$section][$name])) continue;
        if (isset($target[$section][$name]) && $target[$section][$name]!==$constraint) throw new RuntimeException("Dependency conflict: ".$name);
        $target[$section][$name]=$constraint;
        unset($local[$section][$name]);
    }
    if (empty($local[$section]) && !isset($old[$section])) unset($local[$section]);
}
if ($local!=$old) throw new RuntimeException("Unsupported local composer.json edits; review before upgrade.");
return $target;
}
$firstError=null;
foreach (array_merge([$argv[1]],glob($argv[4]."/*.json")) as $candidate) {
    $old=json_decode(file_get_contents($candidate),true,512,JSON_THROW_ON_ERROR);
    try { $merged=mergeRequirements($old,$local,$target); }
    catch (RuntimeException $error) { $firstError=$firstError??$error; continue; }
    file_put_contents($argv[3],json_encode($merged,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)."\n");
    copy($candidate,$argv[5]);
    echo "Composer baseline matched: ".basename($candidate).PHP_EOL;
    exit(0);
}
throw new RuntimeException("No committed Composer baseline matches local file. ".$firstError->getMessage());
' "$WORK_DIR/original-composer.json" "$PROJECT/composer.json" "$WORK_DIR/composer.json" "$WORK_DIR/composer-history" "$WORK_DIR/matched-composer.json"
cp -- "$LOCK_FILE" "$WORK_DIR/composer.lock"
if (( RESOLVE_DEPENDENCIES == 1 )); then
    # Resolve a candidate lock without modifying the live vendor tree.
    (cd "$WORK_DIR"; COMPOSER="$WORK_DIR/composer.json" "$PHP_BIN" "$COMPOSER_BIN" --no-plugins --no-scripts update --no-install --no-interaction --prefer-dist)
fi
COMPOSER="$WORK_DIR/composer.json" "$PHP_BIN" "$COMPOSER_BIN" --no-plugins --no-scripts validate --no-check-publish --check-lock --no-interaction
COMPOSER="$WORK_DIR/composer.json" "$PHP_BIN" "$COMPOSER_BIN" --no-plugins --no-scripts check-platform-reqs --lock --no-dev --no-interaction
MANUAL_USERS=$("$PHP_BIN" -r 'require $argv[1]."/vendor/autoload.php"; $app=require $argv[1]."/bootstrap/app.php"; $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap(); echo App\Models\User::where("banned",0)->whereNull("plan_id")->where("transfer_enable",">",0)->where(function($q){$q->whereNull("expired_at")->orWhere("expired_at",">",time());})->count();' "$PROJECT")
[[ "$MANUAL_USERS" =~ ^[0-9]+$ ]] || die 'Unable to verify manual-quota accounts'
(( MANUAL_USERS == 0 )) || die 'Manual-quota accounts without plan_id exist. Resolve target UI compatibility before upgrading.'
# Preserve custom untracked files; relocate only colliding GeoIP files after backup.
while IFS= read -r -d '' file; do
    if [[ -e "$file" || -L "$file" ]]; then
        if ! git ls-files --error-unmatch -- "$file" >/dev/null 2>&1; then
            [[ "$file" == storage/geoip/* && -f "$file" && ! -L "$file" ]] || die "Untracked target collision: $file"
            printf '%s\0' "$file" >> "$WORK_DIR/geoip-collisions"
        fi
    fi
done < <(git ls-tree -r --name-only -z "$TARGET")
printf 'Preflight passed. Current: %s\nTarget: %s (%s)\n' "$OLD_COMMIT" "$TARGET" "$BRANCH"
if (( CHECK_ONLY == 1 )); then exit 0; fi
if [[ -n "$DATABASE_BACKUP" ]]; then
    DATABASE_BACKUP=$(realpath "$DATABASE_BACKUP")
    [[ -s "$DATABASE_BACKUP" ]] || die 'Database backup empty or missing'
    case "$DATABASE_BACKUP" in "$PROJECT"|"$PROJECT"/*) die 'Database backup must be outside the website';; esac
fi
BACKUP_DIR=${BACKUP_DIR:-$(dirname "$PROJECT")/v2board-private-backups}
mkdir -p -- "$BACKUP_DIR"
BACKUP_DIR=$(realpath "$BACKUP_DIR")
case "$BACKUP_DIR" in "$PROJECT"|"$PROJECT"/*) die 'File backups must be outside the website';; esac
if [[ $(id -u) == 0 ]]; then id "$WEB_USER" >/dev/null || die 'Runtime user not found'; fi
PHASE=backup
BACKUP=$(mktemp -d "$BACKUP_DIR/$(date +%Y%m%d-%H%M%S).XXXXXXXX")
printf '%s\n' "$OLD_COMMIT" > "$BACKUP/old-commit.txt"
printf '%s\n' "$OLD_BRANCH" > "$BACKUP/old-branch.txt"
printf '%s\n' "$TARGET" > "$BACKUP/target-commit.txt"
if [[ -n "$DATABASE_BACKUP" ]]; then cp -- "$DATABASE_BACKUP" "$BACKUP/database-backup"; fi
printf 'Database backup is managed by the operator.\n'
cp -- composer.json composer.lock "$BACKUP/"
cp -- "$WORK_DIR/composer.json" "$BACKUP/target-composer.json"
cp -- "$WORK_DIR/matched-composer.json" "$BACKUP/composer-baseline.json"
cp -- "$WORK_DIR/composer.lock" "$BACKUP/target-composer.lock"
git diff --binary -- composer.json > "$BACKUP/composer-local.patch"
sha256sum .env config/v2board.php > "$BACKUP/protected.sha256"
cat > "$BACKUP/DEPLOYMENT.txt" <<EOF
Project: $PROJECT
Original branch: $OLD_BRANCH
Original commit: $OLD_COMMIT
Target: $TARGET
PHP: $PHP_BIN
On failure retain maintenance and stopped jobs. Inspect the error first.
Code rollback: git checkout --detach $OLD_COMMIT
site.tar.gz contains ORIGINAL vendor, lock, config, storage and source files.
Restore original dependencies/config deliberately; do not overwrite newer uploads.
Then config:clear, route:clear, view:clear, config:cache; restart PHP-FPM.
Run artisan up only after verification, then restart original queue/scheduler.
Traffic-credit conversion is not code-only reversible. Follow docs/traffic-credits.md.
Reconcile new orders and restore matching code/database/Redis state; never migrate:fresh.
EOF
if [[ ! -e storage/framework/down ]]; then
    "$PHP_BIN" artisan down
    OPEN_ON_SUCCESS=1
fi
MAINTENANCE=1
if (( JOBS_STOPPED == 0 )); then
    PHASE=drain-jobs
    drain_site_jobs
fi
tar --exclude='./.git' --exclude='./frontend/node_modules' --exclude='./node_modules' -czf "$BACKUP/site.tar.gz" .
tar -tzf "$BACKUP/site.tar.gz" >/dev/null
# Release the local tracked edit only after the full backup has been verified.
git restore --source=HEAD -- composer.json
for file in "${LOCAL_GEOIP[@]}"; do
    mkdir -p -- "$BACKUP/tracked/$(dirname "$file")"
    cp -- "$file" "$BACKUP/tracked/$file"
    git restore --source=HEAD -- "$file"
done
if [[ -f "$WORK_DIR/geoip-collisions" ]]; then
    while IFS= read -r -d '' file; do
        mkdir -p -- "$BACKUP/untracked/$(dirname "$file")"
        mv -- "$file" "$BACKUP/untracked/$file"
    done < "$WORK_DIR/geoip-collisions"
fi
PHASE=checkout
# New public/PHP files must remain readable by PHP-FPM, even when run as root.
umask 022
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git checkout "$BRANCH"
    git merge --ff-only "$TARGET"
else git checkout -b "$BRANCH" "$TARGET"; fi
[[ "$(git rev-parse HEAD)" == "$TARGET" ]] || die 'Checkout differs from target'
cp -- "$WORK_DIR/composer.lock" composer.lock
cp -- "$WORK_DIR/composer.json" composer.json
# cp overwrites content without fixing an existing 0600 destination. Private
# staging files and earlier deployments may leave manifests unreadable to FPM.
chmod 0644 composer.json composer.lock
PHASE=dependencies
"$PHP_BIN" "$COMPOSER_BIN" install --no-dev --prefer-dist --optimize-autoloader --no-interaction
"$PHP_BIN" "$COMPOSER_BIN" check-platform-reqs --no-dev --no-interaction
PHASE=cache-preparation
"$PHP_BIN" artisan config:clear
"$PHP_BIN" artisan route:clear
"$PHP_BIN" artisan view:clear
PHASE=migrations
for migration in "$MIGRATION" "$INVITATION_MIGRATION" "$LANGUAGE_MIGRATION" "$RESET_MIGRATION" "$NOTICE_MIGRATION" "$CREDIT_MIGRATION" "$CONTENT_MIGRATION" "$BANNER_MIGRATION" "$REWARD_MIGRATION" "$EXPIRY_MIGRATION" "$CURRENCY_MIGRATION" "$NODE_DISPLAY_MIGRATION" "$SERVICE_MAIL_MIGRATION"; do
    run_migration "$migration"
done
printf '\nAll approved migrations completed.\n'
PHASE=verification
"$PHP_BIN" artisan config:cache
"$PHP_BIN" artisan view:cache
"$PHP_BIN" artisan console:verify
sha256sum -c "$BACKUP/protected.sha256"
if [[ $(id -u) == 0 ]]; then chown -R "$WEB_USER" storage bootstrap/cache; fi
"$PHP_BIN" artisan --version
if (( JOBS_STOPPED == 0 )); then
    PHASE=restart-jobs
    drain_site_jobs
    if (( AUTO_HORIZON == 1 || AUTO_QUEUE == 1 || AUTO_SCHEDULER == 1 )); then
        # BaoTa Supervisor should respawn the master with the new code/config.
        found=0
        for attempt in {1..30}; do
            snapshot_site_jobs
            have_horizon=0; have_queue=0; have_scheduler=0
            for command in "${JOB_COMMANDS[@]}"; do
                case "$command" in horizon) have_horizon=1;; queue:work|queue:listen) have_queue=1;; schedule:work) have_scheduler=1;; esac
            done
            if (( have_horizon >= AUTO_HORIZON && have_queue >= AUTO_QUEUE && have_scheduler >= AUTO_SCHEDULER )); then found=1; fi
            (( found == 0 )) || break
            sleep 1
        done
        (( found == 1 )) || die 'Background service did not restart; enable autorestart in this site BaoTa Supervisor. Maintenance retained'
    fi
    if (( OPEN_ON_SUCCESS == 1 )); then "$PHP_BIN" artisan up; MAINTENANCE=0; fi
fi
printf '\nUpgrade complete. File backup: %s\n' "$BACKUP"
if (( MAINTENANCE == 1 )); then
    printf 'Maintenance preserved (manual mode or site already offline). Run %q artisan up after verification.\n' "$PHP_BIN"
else
    printf 'Site reopened; supervised workers and scheduled jobs can continue.\n'
fi
printf 'If PHP-FPM disables OPcache timestamp validation, reload this site PHP-FPM in BaoTa.\n'
