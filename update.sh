#!/usr/bin/env bash
# For an old-branch upgrade, run a copy of this script OUTSIDE the checkout.
set -Eeuo pipefail
umask 077
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
MIGRATION=database/migrations/2026_10_01_000001_add_trusted_x_forwarded_for_to_v2node.php
usage() {
    cat <<'HELP'
Usage: bash update.sh [options]
  --project PATH          Existing Git checkout (default: current directory)
  --branch NAME           Default: codex/react-typescript-console
  --php PATH              PHP matching the website PHP-FPM
  --composer PATH         Existing Composer executable or phar
  --lock-file PATH        Tested target composer.lock (existing lock otherwise)
  --resolve-dependencies Resolve merged dependencies in an isolated temp directory
  --database-backup PATH  Completed non-empty backup OUTSIDE the website
  --backup-dir PATH       Private backup parent OUTSIDE the website
  --web-user NAME         Runtime user (default: www)
  --jobs-stopped          Operator has stopped this site's queue and scheduler
  --check                 Preflight only; no checkout/install/migration
  --help
Pause writes and background jobs before taking the database backup.
Success keeps maintenance ON for PHP-FPM restart and operator verification.
Local additive Composer requirements and the three GeoLite2 databases are backed up.
Other tracked edits stop.
No historical update.sql replay, cache flush, or DB rollback.
HELP
}
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
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
trap 'printf "Command failed at line %s.\n" "$LINENO" >&2' ERR
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
for tool in git tar sha256sum realpath; do command -v "$tool" >/dev/null || die "Missing $tool"; done
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
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git merge-base --is-ancestor "refs/heads/$BRANCH" "$TARGET" || die 'Local target branch diverges or is ahead; reconcile it first'
fi
for protected in .env config/v2board.php; do
    if git cat-file -e "$TARGET:$protected" 2>/dev/null; then die "Target must not track $protected"; fi
done
git cat-file -e "$TARGET:public/console/.vite/manifest.json" || die 'Target has no built frontend manifest'
git cat-file -e "$TARGET:$MIGRATION" || die 'Target lacks the approved migration'
while IFS= read -r changed; do
    [[ -z "$changed" || "$changed" == "$MIGRATION" ]] || die "Unexpected migration: $changed; review scope first"
done < <(git diff --name-only "$OLD_COMMIT" "$TARGET" -- database/migrations)
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/v2board-update.XXXXXXXX")
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
COMPOSER="$WORK_DIR/composer.json" "$PHP_BIN" "$COMPOSER_BIN" --no-plugins --no-scripts validate --no-check-publish --check-lock
COMPOSER="$WORK_DIR/composer.json" "$PHP_BIN" "$COMPOSER_BIN" --no-plugins --no-scripts check-platform-reqs --lock --no-dev
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
(( JOBS_STOPPED == 1 )) || die 'Stop queue/scheduler and pass --jobs-stopped'
[[ -n "$DATABASE_BACKUP" ]] || die 'Provide a completed database backup with --database-backup'
DATABASE_BACKUP=$(realpath "$DATABASE_BACKUP")
[[ -s "$DATABASE_BACKUP" ]] || die 'Database backup empty or missing'
case "$DATABASE_BACKUP" in "$PROJECT"|"$PROJECT"/*) die 'Database backup must be outside the website';; esac
BACKUP_DIR=${BACKUP_DIR:-$(dirname "$PROJECT")/v2board-private-backups}
mkdir -p -- "$BACKUP_DIR"
BACKUP_DIR=$(realpath "$BACKUP_DIR")
case "$BACKUP_DIR" in "$PROJECT"|"$PROJECT"/*) die 'File backups must be outside the website';; esac
if [[ $(id -u) == 0 ]]; then id "$WEB_USER" >/dev/null || die 'Runtime user not found'; fi
BACKUP=$(mktemp -d "$BACKUP_DIR/$(date +%Y%m%d-%H%M%S).XXXXXXXX")
printf '%s\n' "$OLD_COMMIT" > "$BACKUP/old-commit.txt"
printf '%s\n' "$OLD_BRANCH" > "$BACKUP/old-branch.txt"
printf '%s\n' "$TARGET" > "$BACKUP/target-commit.txt"
cp -- "$DATABASE_BACKUP" "$BACKUP/database-backup"
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
The nullable added column can usually remain. No blind DB restore or migrate:fresh.
EOF
if [[ ! -e storage/framework/down ]]; then "$PHP_BIN" artisan down; fi
MAINTENANCE=1
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
# New public/PHP files must remain readable by PHP-FPM, even when run as root.
umask 022
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git checkout "$BRANCH"
    git merge --ff-only "$TARGET"
else git checkout -b "$BRANCH" "$TARGET"; fi
[[ "$(git rev-parse HEAD)" == "$TARGET" ]] || die 'Checkout differs from target'
cp -- "$WORK_DIR/composer.lock" composer.lock
cp -- "$WORK_DIR/composer.json" composer.json
"$PHP_BIN" "$COMPOSER_BIN" install --no-dev --prefer-dist --optimize-autoloader --no-interaction
"$PHP_BIN" "$COMPOSER_BIN" check-platform-reqs --no-dev
"$PHP_BIN" artisan config:clear
"$PHP_BIN" artisan route:clear
"$PHP_BIN" artisan view:clear
"$PHP_BIN" artisan migrate --path="$MIGRATION" --force
"$PHP_BIN" artisan config:cache
"$PHP_BIN" artisan view:cache
"$PHP_BIN" artisan console:verify
sha256sum -c "$BACKUP/protected.sha256"
if [[ $(id -u) == 0 ]]; then chown -R "$WEB_USER" storage bootstrap/cache; fi
"$PHP_BIN" artisan --version
printf '\nUpgrade complete; maintenance remains ON. Backup: %s\n' "$BACKUP"
printf 'In BaoTa restart this site PHP-FPM, then run:\n  %q artisan up\n' "$PHP_BIN"
printf 'Verify login/subscriptions/payments/admin/assets; start original queue and scheduler.\n'
printf 'Check manual-quota accounts without plan_id per docs/account-entry-states.md.\n'
