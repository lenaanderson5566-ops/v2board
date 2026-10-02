#!/usr/bin/env bash
# Isolated Git repositories; PHP/Composer/Artisan are mocked. No live DB changes.
set -euo pipefail
SOURCE=$(realpath "${1:-update.sh}")
TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/seed"
cd "$TMP/seed"
git init -q
git config user.email test@example.test
git config user.name 'Updater Test'
printf '.env\nconfig/v2board.php\ncomposer.lock\nvendor/\nstorage/\nbootstrap/cache/\n' > .gitignore
printf '{"name":"test/site"}\n' > composer.json
mkdir -p config storage/framework bootstrap/cache
touch artisan
git add .; git commit -qm original
OLD=$(git rev-parse HEAD)
git branch -M original
git checkout -qb codex/react-typescript-console
mkdir -p public/console/.vite database/migrations
echo '{}' > public/console/.vite/manifest.json
echo '<?php // fixture' > database/migrations/2026_10_01_000001_add_trusted_x_forwarded_for_to_v2node.php
git add .; git commit -qm target
TARGET=$(git rev-parse HEAD)
git clone -q --bare . "$TMP/origin.git"
printf 'SQL backup fixture\n' > "$TMP/db.sql"
printf '{}' > "$TMP/tested.lock"
touch "$TMP/composer.phar"
cat > "$TMP/php" <<'MOCK'
#!/usr/bin/env bash
set -e
printf '%s\n' "$*" >> calls.log
if [[ "$1" == '-r' ]]; then echo "${MANUAL_USERS:-0}"; exit; fi
if [[ "$1" == artisan && "$2" == down ]]; then mkdir -p storage/framework; touch storage/framework/down; fi
if [[ "$*" == *' install '* && "${FAIL_INSTALL:-0}" == 1 ]]; then exit 17; fi
if [[ "$*" == *' validate '* && "${FAIL_LOCK:-0}" == 1 ]]; then exit 18; fi
MOCK
chmod +x "$TMP/php"
new_site() {
    git clone -q -b original "$TMP/origin.git" "$TMP/$1"
    cd "$TMP/$1"
    mkdir -p config storage/framework bootstrap/cache vendor
    printf 'APP_KEY=original-key\n' > .env
    printf '<?php return ["preserved"=>true];\n' > config/v2board.php
    printf 'old dependencies\n' > vendor/original
    printf '{}\n' > composer.lock
    ARGS=(--project "$PWD" --php "$TMP/php" --composer "$TMP/composer.phar" --lock-file "$TMP/tested.lock" --backup-dir "$TMP/backups" --database-backup "$TMP/db.sql" --web-user "$(id -un)")
}
reject() { if bash "$SOURCE" "${ARGS[@]}" "$@" > "$TMP/output" 2>&1; then echo 'Unexpected success'; exit 1; fi; }
new_site check
bash "$SOURCE" "${ARGS[@]}" --check > "$TMP/output" 2>&1
[[ $(git rev-parse HEAD) == "$OLD" && ! -e storage/framework/down ]]
new_site dirty
echo changed >> composer.json
reject --jobs-stopped
[[ ! -e storage/framework/down ]]
new_site lockfail
export FAIL_LOCK=1; reject --jobs-stopped; unset FAIL_LOCK
[[ $(git rev-parse HEAD) == "$OLD" && ! -e storage/framework/down ]]
new_site manual
export MANUAL_USERS=1; reject --jobs-stopped; unset MANUAL_USERS
[[ $(git rev-parse HEAD) == "$OLD" ]]
new_site jobs
reject
[[ ! -e storage/framework/down ]]
new_site success
bash "$SOURCE" "${ARGS[@]}" --jobs-stopped > "$TMP/output" 2>&1
[[ $(git rev-parse HEAD) == "$TARGET" && -e storage/framework/down ]]
grep -q original-key .env
grep -q preserved config/v2board.php
grep -q 'migrate --path=database/migrations/2026_10_01_000001' calls.log
[[ $(stat -c %a public/console/.vite/manifest.json) == 644 ]]
! grep -Eq 'v2board:update|cache:clear|optimize:clear|artisan up' calls.log
find "$TMP/backups" -name site.tar.gz -exec tar -tzf {} \; | grep -q './vendor/original'
new_site failure
export FAIL_INSTALL=1; reject --jobs-stopped; unset FAIL_INSTALL
[[ -e storage/framework/down ]]
grep -q 'keep maintenance' "$TMP/output"
new_site existingdown
touch storage/framework/down
bash "$SOURCE" "${ARGS[@]}" --jobs-stopped > "$TMP/output" 2>&1
[[ -e storage/framework/down ]]
echo 'Updater: 8 isolated scenarios passed'
