#!/usr/bin/env bash
# Isolated Git repositories; PHP/Composer/Artisan are mocked. No live DB changes.
set -euo pipefail
SOURCE=$(realpath "${1:-update.sh}")
export REAL_PHP=$(command -v php)
TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/seed"
cd "$TMP/seed"
git init -q
git config user.email test@example.test
git config user.name 'Updater Test'
printf '.env\nconfig/v2board.php\ncomposer.lock\nvendor/\nstorage/\nbootstrap/cache/\n' > .gitignore
printf '{"name":"test/site","require":{"php":"^7.3.0|^8.0"}}\n' > composer.json
mkdir -p config storage/framework bootstrap/cache
touch artisan
git add .; git commit -qm original
OLD=$(git rev-parse HEAD)
git branch -M original
git checkout -qb codex/react-typescript-console
printf '{"name":"test/site","require":{"php":"^7.3.0 || ^8.0","geoip2/geoip2":"^2.12"}}\n' > composer.json
mkdir -p public/console/.vite database/migrations
echo '{}' > public/console/.vite/manifest.json
echo '<?php // fixture' > database/migrations/2026_10_01_000001_add_trusted_x_forwarded_for_to_v2node.php
echo '<?php // fixture' > database/migrations/2026_10_02_000001_create_email_invitations.php
echo '<?php // fixture' > database/migrations/2026_10_02_000002_add_language_to_users.php
mkdir -p storage/geoip
echo 'new mmdb' > storage/geoip/GeoLite2-ASN.mmdb
git add -f storage/geoip/GeoLite2-ASN.mmdb
git add .; git commit -qm target
TARGET=$(git rev-parse HEAD)
git clone -q --bare . "$TMP/origin.git"
printf 'SQL backup fixture\n' > "$TMP/db.sql"
printf '{}' > "$TMP/tested.lock"
touch "$TMP/composer.phar"
cat > "$TMP/php" <<'MOCK'
#!/usr/bin/env bash
set -e
printf '%s\n' "$*" >> "${MOCK_LOG:-calls.log}"
if [[ "$1" == '-r' ]]; then
    if [[ "$2" == *'json_decode'* ]]; then exec "$REAL_PHP" "$@"; fi
    echo "${MANUAL_USERS:-0}"; exit
fi
if [[ "$*" == *' update '* && "${FAIL_RESOLVE:-0}" == 1 ]]; then exit 19; fi
if [[ "$1" == artisan && "$2" == down ]]; then mkdir -p storage/framework; touch storage/framework/down; fi
if [[ "$*" == *' install '* && "${FAIL_INSTALL:-0}" == 1 ]]; then exit 17; fi
if [[ "$*" == *' validate '* && "${FAIL_LOCK:-0}" == 1 ]]; then exit 18; fi
MOCK
chmod +x "$TMP/php"
new_site() {
    git clone -q -b original "$TMP/origin.git" "$TMP/$1"
    cd "$TMP/$1"
    export MOCK_LOG="$PWD/calls.log"
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
grep -q 'migrate --path=database/migrations/2026_10_02_000001' calls.log
grep -q 'migrate --path=database/migrations/2026_10_02_000002' calls.log
grep -q 'artisan console:verify' calls.log
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
new_site customized
printf '{"name":"test/site","require":{"php":"^7.3.0|^8.0","joanhey/adapterman":"^0.7.1"}}\n' > composer.json
mkdir -p app/Payments storage/geoip
echo 'custom payment' > app/Payments/MetePay.php
echo 'old mmdb' > storage/geoip/GeoLite2-ASN.mmdb
bash "$SOURCE" "${ARGS[@]}" --jobs-stopped --resolve-dependencies > "$TMP/output" 2>&1
grep -q joanhey/adapterman composer.json
grep -q 'custom payment' app/Payments/MetePay.php
grep -q 'new mmdb' storage/geoip/GeoLite2-ASN.mmdb
find "$TMP/backups" -path '*/untracked/storage/geoip/GeoLite2-ASN.mmdb' -exec cat {} \; | grep -q 'old mmdb'
grep -q 'update --no-install' calls.log
new_site unsupported
printf '{"name":"test/site","scripts":{"danger":"echo run"}}\n' > composer.json
reject --jobs-stopped --resolve-dependencies
[[ $(git rev-parse HEAD) == "$OLD" && ! -e storage/framework/down ]]
new_site resolvefail
export FAIL_RESOLVE=1; reject --jobs-stopped --resolve-dependencies; unset FAIL_RESOLVE
[[ $(git rev-parse HEAD) == "$OLD" && ! -e storage/framework/down ]]
new_site collision
mkdir -p public/console/.vite
echo custom > public/console/.vite/manifest.json
reject --jobs-stopped
grep -q custom public/console/.vite/manifest.json
[[ ! -e storage/framework/down ]]
new_site customcheck
printf '{"name":"test/site","require":{"php":"^7.3.0|^8.0","joanhey/adapterman":"^0.7.1"}}\n' > composer.json
bash "$SOURCE" "${ARGS[@]}" --check --resolve-dependencies > "$TMP/output" 2>&1
[[ $(git rev-parse HEAD) == "$OLD" && ! -e storage/framework/down ]]
grep -q joanhey/adapterman composer.json
new_site customfailure
printf '{"name":"test/site","require":{"php":"^7.3.0|^8.0","joanhey/adapterman":"^0.7.1"}}\n' > composer.json
export FAIL_INSTALL=1; reject --jobs-stopped --resolve-dependencies; unset FAIL_INSTALL
[[ -e storage/framework/down ]]
grep -q joanhey/adapterman composer.json
find "$TMP/backups" -name composer-local.patch -exec cat {} \; | grep joanhey/adapterman > /dev/null
new_site trackedgeoip
git checkout -q codex/react-typescript-console
echo 'locally updated database' > storage/geoip/GeoLite2-ASN.mmdb
bash "$SOURCE" "${ARGS[@]}" --check > "$TMP/output" 2>&1
grep -q 'locally updated database' storage/geoip/GeoLite2-ASN.mmdb
[[ ! -e storage/framework/down ]]
bash "$SOURCE" "${ARGS[@]}" --jobs-stopped > "$TMP/output" 2>&1
grep -q 'new mmdb' storage/geoip/GeoLite2-ASN.mmdb
find "$TMP/backups" -path '*/tracked/storage/geoip/GeoLite2-ASN.mmdb' -exec cat {} \; | grep 'locally updated database' > /dev/null
[[ -e storage/framework/down ]]
new_site trackedcode
echo changed > artisan
reject --jobs-stopped
[[ ! -e storage/framework/down ]]
new_site legacycomposer
git checkout -q codex/react-typescript-console
# Reproduce the production state: new HEAD with legacy Composer plus local package.
printf '{"name":"test/site","require":{"php":"^7.3.0|^8.0","joanhey/adapterman":"^0.7.1"}}\n' > composer.json
bash "$SOURCE" "${ARGS[@]}" --check --resolve-dependencies > "$TMP/output" 2>&1
grep -q '7.3.0|\^8.0' composer.json
[[ ! -e storage/framework/down ]]
bash "$SOURCE" "${ARGS[@]}" --jobs-stopped --resolve-dependencies > "$TMP/output" 2>&1
"$REAL_PHP" -r '$c=json_decode(file_get_contents("composer.json"),true); if ($c["require"]["php"]!=="^7.3.0 || ^8.0" || !isset($c["require"]["joanhey/adapterman"],$c["require"]["geoip2/geoip2"])) exit(1);'
new_site unknownconstraint
printf '{"name":"test/site","require":{"php":"^8.4"}}\n' > composer.json
reject --jobs-stopped --resolve-dependencies
[[ ! -e storage/framework/down ]]
echo 'Updater: 18 isolated scenarios passed'
