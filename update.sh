#!/usr/bin/env bash
# For an old-branch upgrade, run a copy of this script OUTSIDE the checkout.
set -Eeuo pipefail
umask 077
ORIGINAL_ARGS=("$@")
INVOCATION_DIR=$PWD
SCRIPT_PATH=$(realpath "${BASH_SOURCE[0]}")
PHASE=preflight
CURRENT_MIGRATION=
BRANCH=codex/payment-icon-picker
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
JOBS_RESTART_TIMEOUT=60
JOB_PIDS=()
JOB_STARTS=()
JOB_COMMANDS=()
OPERATIONS_SCHEMA_MIGRATION=database/migrations/2026_10_11_000000_ensure_operations_schema.php
MIGRATION=database/migrations/2026_10_01_000001_add_trusted_x_forwarded_for_to_v2node.php
INVITATION_MAIL_MIGRATION=database/migrations/2026_10_15_000001_link_invitation_mail_logs.php
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
RETIRED_PAYMENT_MIGRATION=database/migrations/2026_10_07_000001_disable_retired_payment_methods.php
SERVICE_MAIL_MIGRATION=database/migrations/2026_10_08_000001_add_service_notifications.php
PAYMENT_HISTORY_MIGRATION=database/migrations/2026_10_10_000001_add_order_payment_snapshot.php
V2BOX_MIGRATION=database/migrations/2026_10_11_000001_create_v2box_nodes.php
RETIRED_NODE_TABLES_MIGRATION=database/migrations/2026_10_11_000002_drop_retired_node_tables.php
V2BOX_SINGBOX_MIGRATION=database/migrations/2026_10_11_000003_add_v2box_sing_box.php
NODE_ROUTES_MIGRATION=database/migrations/2026_10_11_000004_separate_node_routes.php
NODE_DDNS_MIGRATION=database/migrations/2026_10_11_000005_create_node_ddns.php
LOG_METADATA_MIGRATION=database/migrations/2026_10_11_000006_index_log_metadata.php
NODE_TRAFFIC_BATCH_MIGRATION=database/migrations/2026_10_11_000007_create_node_traffic_batches.php
SERVER_TRAFFIC_BUDGET_MIGRATION=database/migrations/2026_10_11_000008_create_server_traffic_budgets.php
SERVER_TRAFFIC_IMPORT_MIGRATION=database/migrations/2026_10_11_000009_create_server_traffic_imports.php
LIGHTSAIL_MIGRATION=database/migrations/2026_10_11_000010_create_lightsail_servers.php
CLIENT_IDENTITY_MIGRATION=database/migrations/2026_10_12_000001_canonicalize_subscription_clients.php
PAYMENT_CALLBACK_MIGRATION=database/migrations/2026_10_13_000001_create_payment_callback_events.php
CLIENT_DIAGNOSTIC_MIGRATION=database/migrations/2026_10_13_000002_create_client_diagnostic_reports.php
INVITATION_REVIEW_MIGRATION=database/migrations/2026_10_13_000003_create_invitation_reviews.php
TIMEZONE_MIGRATION=database/migrations/2026_10_13_000007_add_timezones.php
TELEGRAM_NOTIFICATION_MIGRATION=database/migrations/2026_10_13_000006_add_telegram_notifications.php
BILLING_CURRENCIES_MIGRATION=database/migrations/2026_10_14_000008_add_billing_currencies.php
ANALYTICS_MIGRATION=database/migrations/2026_10_17_000001_create_product_analytics.php
CLIENT_RECOGNITION_MIGRATION=database/migrations/2026_10_20_000002_create_client_recognition.php
NODE_DICTIONARY_MIGRATION=database/migrations/2026_10_20_000001_create_node_dictionary.php
ACCOUNT_DELETION_MIGRATION=database/migrations/2026_10_19_000004_add_account_deletion.php
PASSKEY_MIGRATION=database/migrations/2026_10_19_000002_create_passkeys.php
ANALYTICS_BROWSERS_MIGRATION=database/migrations/2026_10_19_000003_add_analytics_browsers.php
ANALYTICS_MEASUREMENTS_MIGRATION=database/migrations/2026_10_19_000001_create_analytics_measurements.php
ANALYTICS_SOURCES_MIGRATION=database/migrations/2026_10_17_000002_add_analytics_sources.php
RETIRED_STAFF_MIGRATION=database/migrations/2026_10_18_000001_drop_retired_staff_role.php
MFA_MIGRATION=database/migrations/2026_10_14_000011_add_optional_mfa.php
COUPON_PRESENTATION_MIGRATION=database/migrations/2026_10_14_000010_add_coupon_presentations.php
COUPON_CAMPAIGN_MIGRATION=database/migrations/2026_10_14_000009_add_coupon_campaigns.php
COUPON_WALLET_MIGRATION=database/migrations/2026_10_14_000007_add_coupon_wallet.php
MAIL_BLOCKLIST_MIGRATION=database/migrations/2026_10_14_000006_add_mail_blocklist.php
MAIL_CAMPAIGN_MIGRATION=database/migrations/2026_10_14_000005_add_mail_campaigns.php
MAIL_FEEDBACK_MIGRATION=database/migrations/2026_10_14_000004_add_mail_feedback.php
MAIL_TRANSPORT_MIGRATION=database/migrations/2026_10_14_000003_add_mail_transport_codes.php
MAIL_DELIVERY_MIGRATION=database/migrations/2026_10_14_000002_add_mail_delivery_metadata.php
TELEGRAM_HARDENING_MIGRATION=database/migrations/2026_10_14_000001_harden_telegram_delivery.php
TELEGRAM_MEMBERSHIP_MIGRATION=database/migrations/2026_10_13_000005_add_telegram_membership.php
CLIENT_REPORT_KIND_MIGRATION=database/migrations/2026_10_13_000004_add_client_report_kind.php
usage() {
    cat <<'HELP'
Usage: bash update.sh [options]
  --project PATH          Existing Git checkout (default: current directory)
  --branch NAME           Default: codex/payment-icon-picker
  --php PATH              PHP matching the website PHP-FPM
  --composer PATH         Existing Composer executable or phar
  --lock-file PATH        Override the committed target composer.lock
  --resolve-dependencies Resolve merged dependencies in an isolated temp directory
  --database-backup PATH  Optional: copy an existing database backup into file backup
  --backup-dir PATH       Private backup parent OUTSIDE the website
  --web-user NAME         Runtime user (default: www)
  --jobs-restart-timeout N Wait 2-600 seconds for stable workers (default: 60)
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
            horizon|horizon:supervisor|horizon:work|queue:work|queue:listen|schedule:run|schedule:work|coupons:campaigns|mail:campaigns|traffic:update|reset:traffic|reset:log|check:order|check:commission|check:ticket|check:renewal|send:remindMail|v2board:statistics|clients:check-releases|credits:expire)
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
wait_site_jobs() {
    local deadline=$((SECONDS+JOBS_RESTART_TIMEOUT)) previous= signature i
    local have_horizon have_queue have_scheduler
    while (( SECONDS < deadline )); do
        snapshot_site_jobs
        have_horizon=0; have_queue=0; have_scheduler=0; signature=
        for i in "${!JOB_COMMANDS[@]}"; do
            case "${JOB_COMMANDS[$i]}" in
                horizon) have_horizon=1;;
                queue:work|queue:listen) have_queue=1;;
                schedule:work) have_scheduler=1;;
                *) continue;;
            esac
            signature+="${JOB_COMMANDS[$i]}:${JOB_PIDS[$i]}:${JOB_STARTS[$i]} "
        done
        if (( have_horizon >= AUTO_HORIZON && have_queue >= AUTO_QUEUE && have_scheduler >= AUTO_SCHEDULER )); then
            if [[ -n "$signature" && "$signature" == "$previous" ]]; then return 0; fi
            previous=$signature
        else
            previous=
        fi
        sleep 1
    done
    printf 'Expected background services: horizon=%s queue=%s scheduler=%s\n' "$AUTO_HORIZON" "$AUTO_QUEUE" "$AUTO_SCHEDULER" >&2
    printf 'Observed background services: horizon=%s queue=%s scheduler=%s\n' "$have_horizon" "$have_queue" "$have_scheduler" >&2
    printf 'Check this site Supervisor autorestart, PHP executable, runtime user and process error logs.\n' >&2
    printf 'After repairing and starting the services, verify them and run: %q artisan up\n' "$PHP_BIN" >&2
    return 1
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
        --project|--branch|--php|--composer|--lock-file|--database-backup|--backup-dir|--web-user|--jobs-restart-timeout)
            (( $# >= 2 )) || die "Missing value for $1"
            case "$1" in
                --project) PROJECT=$2;; --branch) BRANCH=$2;; --php) PHP_BIN=$2;;
                --composer) COMPOSER_BIN=$2;; --lock-file) LOCK_FILE=$2;;
                --database-backup) DATABASE_BACKUP=$2;; --backup-dir) BACKUP_DIR=$2;;
                --web-user) WEB_USER=$2;; --jobs-restart-timeout) JOBS_RESTART_TIMEOUT=$2;;
            esac
            shift 2;;
        --jobs-stopped) JOBS_STOPPED=1; shift;;
        --check) CHECK_ONLY=1; shift;;
        --resolve-dependencies) RESOLVE_DEPENDENCIES=1; shift;;
        --help|-h) usage; exit 0;;
        *) die "Unknown option: $1";;
    esac
done
[[ "$JOBS_RESTART_TIMEOUT" =~ ^[0-9]{1,3}$ ]] || die 'Invalid jobs restart timeout; use 2-600 seconds'
JOBS_RESTART_TIMEOUT=$((10#$JOBS_RESTART_TIMEOUT))
(( JOBS_RESTART_TIMEOUT >= 2 && JOBS_RESTART_TIMEOUT <= 600 )) || die 'Invalid jobs restart timeout; use 2-600 seconds'
for tool in git tar sha256sum realpath cmp flock awk readlink; do command -v "$tool" >/dev/null || die "Missing $tool"; done
PROJECT=$(realpath "$PROJECT")
cd "$PROJECT"
[[ "$(git rev-parse --show-toplevel)" == "$PROJECT" ]] || die 'Project must be the repository root'
git check-ref-format --branch "$BRANCH" >/dev/null || die 'Invalid branch'
git diff --cached --quiet || die 'Review staged changes first'
while IFS= read -r changed; do
    case "$changed" in
        ''|composer.json|composer.lock) ;;
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
if [[ -n "$LOCK_FILE" ]]; then
    LOCK_FILE=$(realpath "$LOCK_FILE")
    [[ -s "$LOCK_FILE" ]] || die 'Provided target composer.lock is missing'
fi
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
git cat-file -e "$TARGET:$OPERATIONS_SCHEMA_MIGRATION" || die 'Target lacks operations schema migration'
git cat-file -e "$TARGET:$MIGRATION" || die 'Target lacks the approved migration'
git cat-file -e "$TARGET:$INVITATION_MIGRATION" || die 'Target lacks the email invitation migration'
git cat-file -e "$TARGET:$INVITATION_MAIL_MIGRATION" || die 'Target lacks invitation mail log migration'
git cat-file -e "$TARGET:$LANGUAGE_MIGRATION" || die 'Target lacks the user language migration'
git cat-file -e "$TARGET:$CREDIT_MIGRATION" || die 'Target lacks the traffic credit migration'
git cat-file -e "$TARGET:$BANNER_MIGRATION" || die 'Target lacks the banner migration'
git cat-file -e "$TARGET:$CONTENT_MIGRATION" || die 'Target lacks the notice translations migration'
git cat-file -e "$TARGET:$NOTICE_MIGRATION" || die 'Target lacks the announcement read migration'
git cat-file -e "$TARGET:$CURRENCY_MIGRATION" || die 'Target lacks order currency migration'
git cat-file -e "$TARGET:$EXPIRY_MIGRATION" || die 'Target lacks credit expiry migration'
git cat-file -e "$TARGET:$REWARD_MIGRATION" || die 'Target lacks the invitation rewards migration'
git cat-file -e "$TARGET:$RETIRED_PAYMENT_MIGRATION" || die 'Target lacks the retired payment migration'
git cat-file -e "$TARGET:$PAYMENT_HISTORY_MIGRATION" || die 'Target lacks payment history migration'
git cat-file -e "$TARGET:$SERVICE_MAIL_MIGRATION" || die 'Target lacks the service notification migration'
git cat-file -e "$TARGET:$RETIRED_NODE_TABLES_MIGRATION" || die 'Target lacks retired node table removal migration'
git cat-file -e "$TARGET:$V2BOX_MIGRATION" || die 'Target lacks V2Box migration'
git cat-file -e "$TARGET:$NODE_DISPLAY_MIGRATION" || die 'Target lacks the node display metadata migration'
git cat-file -e "$TARGET:$RESET_MIGRATION" || die 'Target lacks the usage reset migration'
git cat-file -e "$TARGET:$V2BOX_SINGBOX_MIGRATION" || die 'Target lacks v2box_singbox migration'
git cat-file -e "$TARGET:$NODE_ROUTES_MIGRATION" || die 'Target lacks node_routes migration'
git cat-file -e "$TARGET:$NODE_DDNS_MIGRATION" || die 'Target lacks node_ddns migration'
git cat-file -e "$TARGET:$LOG_METADATA_MIGRATION" || die 'Target lacks log_metadata migration'
git cat-file -e "$TARGET:$NODE_TRAFFIC_BATCH_MIGRATION" || die 'Target lacks node_traffic_batch_migration migration'
git cat-file -e "$TARGET:$SERVER_TRAFFIC_BUDGET_MIGRATION" || die 'Target lacks server_traffic_budget_migration migration'
git cat-file -e "$TARGET:$SERVER_TRAFFIC_IMPORT_MIGRATION" || die 'Target lacks server_traffic_import_migration migration'
git cat-file -e "$TARGET:$LIGHTSAIL_MIGRATION" || die 'Target lacks lightsail migration'
git cat-file -e "$TARGET:$BILLING_CURRENCIES_MIGRATION" || die 'Target lacks billing currency migration'
git cat-file -e "$TARGET:$ANALYTICS_MIGRATION" || die 'Target lacks product analytics migration'
git cat-file -e "$TARGET:$RETIRED_STAFF_MIGRATION" || die 'Target lacks retired staff role migration'
git cat-file -e "$TARGET:$CLIENT_RECOGNITION_MIGRATION" || die 'Target lacks client recognition migration'
git cat-file -e "$TARGET:$NODE_DICTIONARY_MIGRATION" || die 'Target lacks node dictionary migration'
git cat-file -e "$TARGET:$ACCOUNT_DELETION_MIGRATION" || die 'Target lacks account deletion migration'
git cat-file -e "$TARGET:$PASSKEY_MIGRATION" || die 'Target lacks Passkey migration'
git cat-file -e "$TARGET:$ANALYTICS_BROWSERS_MIGRATION" || die 'Target lacks browser analytics migration'
git cat-file -e "$TARGET:$ANALYTICS_MEASUREMENTS_MIGRATION" || die 'Target lacks analytics measurements migration'
git cat-file -e "$TARGET:$ANALYTICS_SOURCES_MIGRATION" || die 'Target lacks analytics source migration'
git cat-file -e "$TARGET:$MFA_MIGRATION" || die 'Target lacks optional MFA migration'
git cat-file -e "$TARGET:$COUPON_PRESENTATION_MIGRATION" || die 'Target lacks coupon presentation migration'
git cat-file -e "$TARGET:$COUPON_CAMPAIGN_MIGRATION" || die 'Target lacks coupon campaign migration'
git cat-file -e "$TARGET:$COUPON_WALLET_MIGRATION" || die 'Target lacks coupon wallet migration'
git cat-file -e "$TARGET:$MAIL_BLOCKLIST_MIGRATION" || die 'Target lacks mail blocklist migration'
git cat-file -e "$TARGET:$MAIL_CAMPAIGN_MIGRATION" || die 'Target lacks mail campaign migration'
git cat-file -e "$TARGET:$MAIL_FEEDBACK_MIGRATION" || die 'Target lacks mail feedback migration'
git cat-file -e "$TARGET:$MAIL_TRANSPORT_MIGRATION" || die 'Target lacks mail transport migration'
git cat-file -e "$TARGET:$MAIL_DELIVERY_MIGRATION" || die 'Target lacks mail delivery migration'
git cat-file -e "$TARGET:$TELEGRAM_HARDENING_MIGRATION" || die 'Target lacks Telegram hardening migration'
git cat-file -e "$TARGET:$TIMEZONE_MIGRATION" || die 'Target lacks timezone migration'
git cat-file -e "$TARGET:$TELEGRAM_NOTIFICATION_MIGRATION" || die 'Target lacks Telegram notification migration'
git cat-file -e "$TARGET:$TELEGRAM_MEMBERSHIP_MIGRATION" || die 'Target lacks Telegram membership migration'
git cat-file -e "$TARGET:$CLIENT_REPORT_KIND_MIGRATION" || die 'Target lacks client runtime report migration'
git cat-file -e "$TARGET:$CLIENT_IDENTITY_MIGRATION" || die 'Target lacks canonical client migration'
git cat-file -e "$TARGET:$PAYMENT_CALLBACK_MIGRATION" || die "Target lacks 2026_10_13_000001_create_payment_callback_events.php"
git cat-file -e "$TARGET:$CLIENT_DIAGNOSTIC_MIGRATION" || die "Target lacks 2026_10_13_000002_create_client_diagnostic_reports.php"
git cat-file -e "$TARGET:$INVITATION_REVIEW_MIGRATION" || die "Target lacks 2026_10_13_000003_create_invitation_reviews.php"
while IFS= read -r changed; do
    [[ -z "$changed" || "$changed" == "$OPERATIONS_SCHEMA_MIGRATION" || "$changed" == "$MIGRATION" || "$changed" == "$INVITATION_MIGRATION" || "$changed" == "$INVITATION_MAIL_MIGRATION" || "$changed" == "$LANGUAGE_MIGRATION" || "$changed" == "$CURRENCY_MIGRATION" || "$changed" == "$EXPIRY_MIGRATION" || "$changed" == "$REWARD_MIGRATION" || "$changed" == "$RESET_MIGRATION" || "$changed" == "$NOTICE_MIGRATION" || "$changed" == "$CREDIT_MIGRATION" || "$changed" == "$CONTENT_MIGRATION" || "$changed" == "$BANNER_MIGRATION" || "$changed" == "$RETIRED_NODE_TABLES_MIGRATION" || "$changed" == "$V2BOX_MIGRATION" || "$changed" == "$V2BOX_SINGBOX_MIGRATION" || "$changed" == "$NODE_ROUTES_MIGRATION" || "$changed" == "$NODE_DDNS_MIGRATION" || "$changed" == "$LOG_METADATA_MIGRATION" || "$changed" == "$NODE_TRAFFIC_BATCH_MIGRATION" || "$changed" == "$SERVER_TRAFFIC_BUDGET_MIGRATION" || "$changed" == "$SERVER_TRAFFIC_IMPORT_MIGRATION" || "$changed" == "$LIGHTSAIL_MIGRATION" || "$changed" == "$CLIENT_IDENTITY_MIGRATION" || "$changed" == "$PAYMENT_CALLBACK_MIGRATION" || "$changed" == "$CLIENT_DIAGNOSTIC_MIGRATION" || "$changed" == "$BILLING_CURRENCIES_MIGRATION" || "$changed" == "$RETIRED_STAFF_MIGRATION" || "$changed" == "$CLIENT_RECOGNITION_MIGRATION" || "$changed" == "$NODE_DICTIONARY_MIGRATION" || "$changed" == "$ACCOUNT_DELETION_MIGRATION" || "$changed" == "$PASSKEY_MIGRATION" || "$changed" == "$ANALYTICS_BROWSERS_MIGRATION" || "$changed" == "$ANALYTICS_MEASUREMENTS_MIGRATION" || "$changed" == "$ANALYTICS_SOURCES_MIGRATION" || "$changed" == "$ANALYTICS_MIGRATION" || "$changed" == "$MFA_MIGRATION" || "$changed" == "$COUPON_PRESENTATION_MIGRATION" || "$changed" == "$COUPON_CAMPAIGN_MIGRATION" || "$changed" == "$COUPON_WALLET_MIGRATION" || "$changed" == "$MAIL_BLOCKLIST_MIGRATION" || "$changed" == "$MAIL_CAMPAIGN_MIGRATION" || "$changed" == "$MAIL_FEEDBACK_MIGRATION" || "$changed" == "$MAIL_TRANSPORT_MIGRATION" || "$changed" == "$MAIL_DELIVERY_MIGRATION" || "$changed" == "$TELEGRAM_HARDENING_MIGRATION" || "$changed" == "$TIMEZONE_MIGRATION" || "$changed" == "$TELEGRAM_NOTIFICATION_MIGRATION" || "$changed" == "$TELEGRAM_MEMBERSHIP_MIGRATION" || "$changed" == "$CLIENT_REPORT_KIND_MIGRATION" || "$changed" == "$INVITATION_REVIEW_MIGRATION" || "$changed" == "$NODE_DISPLAY_MIGRATION" || "$changed" == "$PAYMENT_HISTORY_MIGRATION" || "$changed" == "$SERVICE_MAIL_MIGRATION" || "$changed" == "$RETIRED_PAYMENT_MIGRATION" ]] || die "Unexpected migration: $changed; review scope first"
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
if [[ -n "$LOCK_FILE" ]]; then
    cp -- "$LOCK_FILE" "$WORK_DIR/composer.lock"
else
    git show "$TARGET:composer.lock" > "$WORK_DIR/composer.lock" || die 'Target lacks a tested lock; provide --lock-file'
fi
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
            [[ ( "$file" == storage/geoip/* || "$file" == composer.lock ) && -f "$file" && ! -L "$file" ]] || die "Untracked target collision: $file"
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
if git ls-files --error-unmatch composer.lock >/dev/null 2>&1; then
    git restore --source=HEAD -- composer.lock
fi
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
for migration in "$CLIENT_RECOGNITION_MIGRATION" "$OPERATIONS_SCHEMA_MIGRATION" "$MIGRATION" "$INVITATION_MIGRATION" "$INVITATION_MAIL_MIGRATION" "$LANGUAGE_MIGRATION" "$RESET_MIGRATION" "$NOTICE_MIGRATION" "$CREDIT_MIGRATION" "$CONTENT_MIGRATION" "$BANNER_MIGRATION" "$REWARD_MIGRATION" "$EXPIRY_MIGRATION" "$CURRENCY_MIGRATION" "$NODE_DISPLAY_MIGRATION" "$RETIRED_PAYMENT_MIGRATION" "$SERVICE_MAIL_MIGRATION" "$PAYMENT_HISTORY_MIGRATION" "$V2BOX_MIGRATION" "$RETIRED_NODE_TABLES_MIGRATION" "$V2BOX_SINGBOX_MIGRATION" "$NODE_ROUTES_MIGRATION" "$NODE_DDNS_MIGRATION" "$LOG_METADATA_MIGRATION" "$NODE_TRAFFIC_BATCH_MIGRATION" "$SERVER_TRAFFIC_BUDGET_MIGRATION" "$SERVER_TRAFFIC_IMPORT_MIGRATION" "$LIGHTSAIL_MIGRATION" "$CLIENT_IDENTITY_MIGRATION" "$PAYMENT_CALLBACK_MIGRATION" "$CLIENT_DIAGNOSTIC_MIGRATION" "$INVITATION_REVIEW_MIGRATION" "$CLIENT_REPORT_KIND_MIGRATION" "$TELEGRAM_MEMBERSHIP_MIGRATION" "$TELEGRAM_NOTIFICATION_MIGRATION" "$TIMEZONE_MIGRATION" "$TELEGRAM_HARDENING_MIGRATION" "$MAIL_DELIVERY_MIGRATION" "$MAIL_TRANSPORT_MIGRATION" "$MAIL_FEEDBACK_MIGRATION" "$MAIL_CAMPAIGN_MIGRATION" "$MAIL_BLOCKLIST_MIGRATION" "$COUPON_WALLET_MIGRATION" "$BILLING_CURRENCIES_MIGRATION" "$COUPON_CAMPAIGN_MIGRATION" "$COUPON_PRESENTATION_MIGRATION" "$MFA_MIGRATION" "$ANALYTICS_MIGRATION" "$ANALYTICS_SOURCES_MIGRATION" "$ANALYTICS_MEASUREMENTS_MIGRATION" "$ANALYTICS_BROWSERS_MIGRATION" "$PASSKEY_MIGRATION" "$ACCOUNT_DELETION_MIGRATION" "$NODE_DICTIONARY_MIGRATION" "$RETIRED_STAFF_MIGRATION"; do
    run_migration "$migration"
done
printf '\nAll approved migrations completed.\n'
PHASE=verification
"$PHP_BIN" -r '
require "vendor/autoload.php"; $app=require "bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
foreach (["v2_analytics_session", "v2_analytics_page"] as $table) {
    if (!Illuminate\Support\Facades\Schema::hasTable($table)) throw new RuntimeException("Missing analytics table: ".$table);
}
foreach (["attribution_version", "source_domain"] as $column) {
    if (!Illuminate\Support\Facades\Schema::hasColumn("v2_analytics_session", $column)) throw new RuntimeException("Missing analytics source column: ".$column);
}
'
"$PHP_BIN" -r 'require "vendor/autoload.php"; $app=require "bootstrap/app.php"; $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap(); if (Illuminate\Support\Facades\Schema::hasColumn("v2_user", "is_staff")) throw new RuntimeException("Retired staff role column remains");'
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
        wait_site_jobs || die 'Background services did not become stable before timeout; maintenance retained'
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
