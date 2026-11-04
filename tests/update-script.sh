#!/usr/bin/env bash
# Isolated Git repositories; PHP/Composer/Artisan are mocked. No live DB changes.
set -euo pipefail
SOURCE=$(realpath "${1:-update.sh}")
export REAL_PHP=$(command -v php)
TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT
trap '[[ ! -f "$TMP/output" ]] || cat "$TMP/output" >&2' ERR
mkdir -p "$TMP/seed"
cd "$TMP/seed"
git init -q
git config user.email test@example.test
git config user.name 'Updater Test'
# Exact public Git blobs from the two historical signing-seed loaders. Never
# read config/fastai.php from the operator's working tree to build fixtures.
public_current=$(git hash-object -w --stdin <<'PUBLIC_LOADER'
<?php
$seed=env('FASTAI_ENTRYPOINT_SIGNING_SEED', '');
if (!is_string($seed)) $seed='';
if ($seed==='') {
    $seedFile=storage_path('app/fastai-entrypoint.seed');
    if (is_file($seedFile) && is_readable($seedFile)) $seed=trim(file_get_contents($seedFile));
}
return ['entrypoint_signing_seed'=>$seed];
PUBLIC_LOADER
)
public_initial=$(git hash-object -w --stdin <<'PUBLIC_LOADER'
<?php
$seedFile=storage_path('app/fastai-entrypoint.seed');
return ['entrypoint_signing_seed' => env('FASTAI_ENTRYPOINT_SIGNING_SEED', is_file($seedFile) ? trim(file_get_contents($seedFile)) : '')];
PUBLIC_LOADER
)
[[ "$public_current" == 4927b0b1dd84ebcf3aece5b46fe742ac60aa7677 ]]
[[ "$public_initial" == 754bbcbe18982c1af0f2e621fcd1d1ef21c2af8d ]]
printf '.env\nconfig/fastai.php\nconfig/v2board.php\ncomposer.lock\nvendor/\nstorage/\nbootstrap/cache/\n' > .gitignore
printf '{"name":"test/site","require":{"php":"^7.3.0|^8.0"}}\n' > composer.json
mkdir -p config storage/framework bootstrap/cache
touch artisan
git add .; git commit -qm original
OLD=$(git rev-parse HEAD)
git branch -M original
git checkout -qb codex/payment-icon-picker
printf '{"name":"test/site","require":{"php":"^7.3.0 || ^8.0","geoip2/geoip2":"^2.12"}}\n' > composer.json
git cat-file blob "$public_current" > config/entrypoint-signing.php
mkdir -p public/console/.vite database/migrations
cp -- "$SOURCE" update.sh
echo '{}' > public/console/.vite/manifest.json
echo '<?php // fixture' > database/migrations/2026_10_11_000000_ensure_operations_schema.php
echo '<?php // fixture' > database/migrations/2026_10_27_000001_retire_v2node.php
echo '<?php // fixture' > database/migrations/2026_10_01_000001_add_trusted_x_forwarded_for_to_v2node.php
echo '<?php // fixture' > database/migrations/2026_10_02_000001_create_email_invitations.php
echo '<?php // fixture' > database/migrations/2026_10_02_000002_add_language_to_users.php
echo '<?php // fixture' > database/migrations/2026_10_02_000003_create_usage_resets.php
echo '<?php // fixture' > database/migrations/2026_10_02_000004_create_notice_reads.php
echo '<?php // fixture' > database/migrations/2026_10_02_000005_create_traffic_credits.php
echo '<?php // fixture' > database/migrations/2026_10_03_000002_create_banners.php
echo '<?php // fixture' > database/migrations/2026_10_03_000001_add_notice_translations.php
echo '<?php // fixture' > database/migrations/2026_10_05_000001_create_invitation_rewards.php
echo '<?php // fixture' > database/migrations/2026_10_05_000002_create_credit_batches.php
echo '<?php // fixture' > database/migrations/2026_10_05_000003_add_order_currency.php
echo '<?php // fixture' > database/migrations/2026_10_06_000001_add_node_display_metadata.php
echo '<?php // fixture' > database/migrations/2026_10_07_000001_disable_retired_payment_methods.php
echo '<?php // fixture' > database/migrations/2026_10_08_000001_add_service_notifications.php
echo '<?php // fixture' > database/migrations/2026_10_10_000001_add_order_payment_snapshot.php
echo '<?php // fixture' > database/migrations/2026_10_11_000001_create_v2box_nodes.php
echo '<?php // fixture' > database/migrations/2026_10_11_000002_drop_retired_node_tables.php
echo '<?php // fixture' > database/migrations/2026_10_11_000003_add_v2box_sing_box.php
echo '<?php // fixture' > database/migrations/2026_10_11_000004_separate_node_routes.php
echo '<?php // fixture' > database/migrations/2026_10_11_000005_create_node_ddns.php
echo '<?php // fixture' > database/migrations/2026_10_11_000006_index_log_metadata.php
echo '<?php // fixture' > database/migrations/2026_10_11_000007_create_node_traffic_batches.php
echo '<?php // fixture' > database/migrations/2026_10_11_000008_create_server_traffic_budgets.php
echo '<?php // fixture' > database/migrations/2026_10_11_000009_create_server_traffic_imports.php
echo '<?php // fixture' > database/migrations/2026_10_11_000010_create_lightsail_servers.php
echo '<?php // fixture' > database/migrations/2026_10_12_000001_canonicalize_subscription_clients.php
# Keep the fixture synchronized with the updater's explicit migration allowlist.
while IFS= read -r migration; do
    printf '<?php // isolated migration fixture\n' > "$migration"
done < <(sed -n 's/^[A-Z_]*MIGRATION=\(database\/migrations\/[^[:space:]]*\)$/\1/p' "$SOURCE")
echo '{}' > composer.lock
git add -f composer.lock
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
if [[ "$*" == *' install '* && -n "${EXPECT_RETIRED_LOADER_DIR:-}" ]]; then
    [[ ! -e config/fastai.php ]]
    cmp config/v2board.php "$EXPECT_RETIRED_LOADER_DIR/legacy.php"
    cmp config/entrypoint-signing.php "$EXPECT_RETIRED_LOADER_DIR/public.php"
    cmp storage/app/fastai-entrypoint.seed "$EXPECT_RETIRED_LOADER_DIR/seed"
    [[ $(stat -c %a config/v2board.php) == 640 ]]
    [[ $(stat -c %a storage/app/fastai-entrypoint.seed) == 600 ]]
    printf 'retired public loader verified before dependency scripts\n' >> "$MOCK_LOG"
fi
if [[ "$*" == *' update '* && "${FAIL_RESOLVE:-0}" == 1 ]]; then exit 19; fi
if [[ "$1" == artisan && "$2" == up ]]; then rm -f storage/framework/down; fi
if [[ "$1" == artisan && "$2" == down ]]; then mkdir -p storage/framework; touch storage/framework/down; fi
if [[ "$*" == *' install '* && "${FAIL_INSTALL:-0}" == 1 ]]; then exit 17; fi
if [[ "$1" == artisan && "$2" == migrate && -n "${FAIL_MIGRATION:-}" && "$*" == *"$FAIL_MIGRATION"* ]]; then echo 'Simulated database migration error' >&2; exit 23; fi
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
new_site invalidrestarttimeout
reject --jobs-restart-timeout 601
[[ ! -e storage/framework/down ]]
grep -q 'Invalid jobs restart timeout' "$TMP/output"
new_site check
bash "$SOURCE" "${ARGS[@]}" --check > "$TMP/output" 2>&1
[[ $(git rev-parse HEAD) == "$OLD" && ! -e storage/framework/down ]]
new_site canonicalconfig
mv config/v2board.php config/fastai.php
cp config/fastai.php "$TMP/canonical-config.expected"
bash "$SOURCE" "${ARGS[@]}" --jobs-stopped > "$TMP/output" 2>&1
cmp config/fastai.php "$TMP/canonical-config.expected"
[[ ! -e config/v2board.php && -e storage/framework/down ]]
new_site bothconfigs
printf '<?php return ["canonical"=>true,"disabled"=>false];\n' > config/fastai.php
cp config/fastai.php "$TMP/both-current-config.expected"
cp config/v2board.php "$TMP/both-legacy-config.expected"
ARGS+=(--backup-dir "$TMP/both-config-backups")
bash "$SOURCE" "${ARGS[@]}" --jobs-stopped > "$TMP/output" 2>&1
cmp config/fastai.php "$TMP/both-current-config.expected"
cmp config/v2board.php "$TMP/both-legacy-config.expected"
protected=$(find "$TMP/both-config-backups" -name protected.sha256 -print -quit)
[[ -n "$protected" ]]
grep -q 'config/fastai.php$' "$protected"
grep -q 'config/v2board.php$' "$protected"
tar -xOf "${protected%/*}/site.tar.gz" ./config/fastai.php | cmp - "$TMP/both-current-config.expected"
tar -xOf "${protected%/*}/site.tar.gz" ./config/v2board.php | cmp - "$TMP/both-legacy-config.expected"
new_site missingconfigs
rm config/v2board.php
reject --check
grep -q 'Existing site configuration required' "$TMP/output"
[[ ! -e storage/framework/down ]]
new_site emptycanonicalconfig
: > config/fastai.php
reject --check
grep -q 'Existing settings file is empty: config/fastai.php' "$TMP/output"
[[ ! -e storage/framework/down ]]

# Shared private settings may live outside the checkout. Preserve their links
# and archive their dereferenced contents separately, including on install failure.
linked_site() {
    new_site "$1"
    LINKED_SHARED="$TMP/shared-$1"
    LINKED_EXPECTED="$TMP/expected-$1"
    LINKED_BACKUPS="$TMP/backups-$1"
    mkdir -m 700 -- "$LINKED_SHARED" "$LINKED_EXPECTED"
    mv .env "$LINKED_SHARED/env"
    mv config/v2board.php "$LINKED_SHARED/legacy.php"
    printf '<?php return ["canonical"=>true,"custom_nested"=>["disabled"=>false,"count"=>0]];\n' > "$LINKED_SHARED/current.php"
    chmod 600 "$LINKED_SHARED/env" "$LINKED_SHARED/current.php"
    chmod 640 "$LINKED_SHARED/legacy.php"
    ln -s "$LINKED_SHARED/env" .env
    ln -s "../../shared-$1/current.php" config/fastai.php
    ln -s "../../shared-$1/legacy.php" config/v2board.php
    for private in .env config/fastai.php config/v2board.php; do
        mkdir -p -- "$LINKED_EXPECTED/$(dirname "$private")"
        cp -pL -- "$private" "$LINKED_EXPECTED/$private"
        readlink "$private" > "$LINKED_EXPECTED/$private.link"
    done
    ARGS+=(--backup-dir "$LINKED_BACKUPS")
}
assert_linked_backup() {
    local protected snapshot archive mode
    protected=$(find "$LINKED_BACKUPS" -name protected.sha256 -print -quit)
    [[ -n "$protected" ]]
    snapshot="${protected%/*}/private-config"
    [[ $(stat -c %a "$snapshot") == 700 && $(stat -c %a "$snapshot/config") == 700 ]]
    (cd "$snapshot"; sha256sum -c "$protected") > /dev/null
    grep -q 'private-config/' "${protected%/*}/DEPLOYMENT.txt"
    archive="$LINKED_EXPECTED/archive"
    mkdir -m 700 -- "$archive" "$LINKED_EXPECTED/restored"
    tar -xzf "${protected%/*}/site.tar.gz" -C "$archive" ./.env ./config/fastai.php ./config/v2board.php
    for private in .env config/fastai.php config/v2board.php; do
        [[ -L "$private" && -L "$archive/$private" ]]
        [[ $(readlink "$private") == "$(cat "$LINKED_EXPECTED/$private.link")" ]]
        [[ $(readlink "$archive/$private") == "$(cat "$LINKED_EXPECTED/$private.link")" ]]
        cmp "$private" "$LINKED_EXPECTED/$private"
        [[ -f "$snapshot/$private" && ! -L "$snapshot/$private" ]]
        cmp "$snapshot/$private" "$LINKED_EXPECTED/$private"
        mode=$(stat -c %a "$LINKED_EXPECTED/$private")
        [[ $(stat -Lc %a "$private") == "$mode" && $(stat -c %a "$snapshot/$private") == "$mode" ]]
        mkdir -p -- "$LINKED_EXPECTED/restored/$(dirname "$private")"
        cp -p -- "$snapshot/$private" "$LINKED_EXPECTED/restored/$private"
        cmp "$LINKED_EXPECTED/restored/$private" "$LINKED_EXPECTED/$private"
        [[ $(stat -c %a "$LINKED_EXPECTED/restored/$private") == "$mode" ]]
    done
}
linked_site linkedsettings
bash "$SOURCE" "${ARGS[@]}" --jobs-stopped > "$TMP/output" 2>&1
[[ $(git rev-parse HEAD) == "$TARGET" && -e storage/framework/down ]]
assert_linked_backup
linked_site linkedsettingsfailure
export FAIL_INSTALL=1; reject --jobs-stopped; unset FAIL_INSTALL
[[ $(git rev-parse HEAD) == "$TARGET" && -e storage/framework/down ]]
grep -q 'keep maintenance' "$TMP/output"
assert_linked_backup

# Invalid link targets and directories must fail before maintenance, backup or
# any PHP/Composer/Artisan invocation. Keep the established empty-file errors.
for private in .env config/fastai.php config/v2board.php; do
    for invalid in dangling directory empty; do
        fixture="invalid-private-${private//[\/.]/-}-$invalid"
        new_site "$fixture"
        rm -f -- "$private"
        if [[ "$invalid" == directory ]]; then
            mkdir -m 700 -- "$private"
        else
            target="$TMP/$fixture-external"
            if [[ "$invalid" == empty ]]; then touch "$target"; chmod 600 "$target"; fi
            ln -s "$target" "$private"
        fi
        ARGS+=(--backup-dir "$TMP/backups-$fixture")
        reject --jobs-stopped
        [[ $(git rev-parse HEAD) == "$OLD" && ! -e storage/framework/down ]]
        [[ ! -e calls.log && ! -e "$TMP/backups-$fixture" ]]
        if [[ "$invalid" == directory ]]; then
            [[ -d "$private" && ! -L "$private" && $(stat -c %a "$private") == 700 ]]
            grep -q 'must be a regular file or a symbolic link to one' "$TMP/output"
        else
            [[ -L "$private" && $(readlink "$private") == "$target" ]]
            if [[ "$invalid" == dangling ]]; then
                [[ ! -e "$target" ]]
                grep -q 'dangling symbolic link' "$TMP/output"
            else
                [[ -f "$target" && ! -s "$target" && $(stat -c %a "$target") == 600 ]]
                if [[ "$private" == .env ]]; then
                    grep -q 'Existing .env required' "$TMP/output"
                else
                    grep -q "Existing settings file is empty: $private" "$TMP/output"
                fi
            fi
        fi
    done
done
new_site targetlock
ARGS=(--project "$PWD" --php "$TMP/php" --composer "$TMP/composer.phar" --backup-dir "$TMP/backups" --web-user "$(id -un)")
bash "$SOURCE" "${ARGS[@]}" --jobs-stopped > "$TMP/output" 2>&1
[[ $(git rev-parse HEAD) == "$TARGET" ]]
cmp composer.lock "$TMP/seed/composer.lock"
grep -q 'migrate --path=database/migrations/2026_10_11_000006_index_log_metadata.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_11_000007_create_node_traffic_batches.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_11_000008_create_server_traffic_budgets.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_11_000009_create_server_traffic_imports.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_11_000010_create_lightsail_servers.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_27_000002_share_lightsail_credentials.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_11_04_000003_fence_lightsail_operations.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_30_000001_track_plan_translation_sources.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_11_03_000001_add_traffic_reset_anchor.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_11_04_000001_subscription_blacklist_expiry.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_11_04_000002_reconcile_mail_complaint_suppressions.php --force --no-interaction' calls.log
grep -q 'Missing plan translation source column' calls.log
grep -q 'migrate --path=database/migrations/2026_10_12_000001_canonicalize_subscription_clients.php --force --no-interaction' calls.log
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
ARGS+=(--database-backup '')
bash "$SOURCE" "${ARGS[@]}" > "$TMP/output" 2>&1
[[ $(git rev-parse HEAD) == "$TARGET" && ! -e storage/framework/down ]]
grep -q 'artisan up' calls.log
grep -q 'Site jobs drained' "$TMP/output"
new_site success
chmod 600 composer.json composer.lock
bash "$SOURCE" "${ARGS[@]}" --jobs-stopped > "$TMP/output" 2>&1
[[ $(git rev-parse HEAD) == "$TARGET" && -e storage/framework/down ]]
grep -q original-key .env
grep -q preserved config/v2board.php
grep -q 'migrate --path=database/migrations/2026_10_11_000000_ensure_operations_schema.php' calls.log
grep -q 'migrate --path=database/migrations/2026_10_01_000001' calls.log
grep -q 'migrate --path=database/migrations/2026_10_02_000001' calls.log
grep -q 'migrate --path=database/migrations/2026_10_02_000002' calls.log
grep -q 'migrate --path=database/migrations/2026_10_02_000003' calls.log
grep -q 'migrate --path=database/migrations/2026_10_02_000004' calls.log
grep -q 'migrate --path=database/migrations/2026_10_02_000005' calls.log
grep -q 'migrate --path=database/migrations/2026_10_06_000001_add_node_display_metadata.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_07_000001_disable_retired_payment_methods.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_08_000001_add_service_notifications.php --force --no-interaction' calls.log
grep -q 'artisan console:verify' calls.log
[[ $(stat -c %a public/console/.vite/manifest.json) == 644 ]]
[[ $(stat -c %a composer.json) == 644 && $(stat -c %a composer.lock) == 644 ]]
! grep -Eq 'fastai:update|v2board:update|cache:clear|optimize:clear|artisan up' calls.log
find "$TMP/backups" -name site.tar.gz -exec tar -tzf {} \; | grep './vendor/original' > /dev/null
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
git checkout -q codex/payment-icon-picker
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
git checkout -q codex/payment-icon-picker
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
new_site missingbackup
ARGS+=(--database-backup "$TMP/missing.sql")
reject --jobs-stopped
grep -q 'Database backup empty or missing' "$TMP/output"
[[ ! -e storage/framework/down ]]
new_site migrationretry
export FAIL_MIGRATION=2026_10_02_000002
reject --jobs-stopped
unset FAIL_MIGRATION
[[ -e storage/framework/down ]]
grep -q 'Failed migration: database/migrations/2026_10_02_000002' "$TMP/output"
! grep -q 'migrate --path=database/migrations/2026_10_02_000003' calls.log
! grep -q 'migrate --path=database/migrations/2026_10_08_000001_add_service_notifications.php --force --no-interaction' calls.log
! grep -q 'artisan console:verify' calls.log
bash "$SOURCE" "${ARGS[@]}" --jobs-stopped > "$TMP/output" 2>&1
grep -q 'All approved migrations completed' "$TMP/output"
grep -q 'migrate --path=database/migrations/2026_10_08_000001_add_service_notifications.php --force --no-interaction' calls.log
grep -q 'artisan console:verify' calls.log
[[ -e storage/framework/down ]]
new_site autofailure
ARGS+=(--database-backup '')
export FAIL_MIGRATION=2026_10_05_000002
reject
unset FAIL_MIGRATION
[[ -e storage/framework/down ]]
! grep -q 'artisan up' calls.log
new_site autoexistingdown
touch storage/framework/down
ARGS+=(--database-backup '')
bash "$SOURCE" "${ARGS[@]}" > "$TMP/output" 2>&1
[[ -e storage/framework/down ]]
! grep -q 'artisan up' calls.log
# Target script changed after the caller was installed. A relative --project must survive handoff.
cd "$TMP/seed"
printf '\n# newer updater fixture\n' >> update.sh
git add update.sh; git commit -qm newer-updater
git push -q "$TMP/origin.git" HEAD:codex/payment-icon-picker
new_site targetupdater
cd "$TMP"
ARGS+=(--project targetupdater)
bash "$SOURCE" "${ARGS[@]}" --check > "$TMP/output" 2>&1
[[ $(grep -c 'Using target updater' "$TMP/output") == 1 ]]
[[ ! -e "$TMP/targetupdater/storage/framework/down" ]]
new_site targetupgrade
git checkout -q "$TARGET"
bash update.sh "${ARGS[@]}" --jobs-stopped > "$TMP/output" 2>&1
[[ $(grep -c 'Using target updater' "$TMP/output") == 1 ]]
[[ $(git rev-parse HEAD) == $(git rev-parse origin/codex/payment-icon-picker) && -e storage/framework/down ]]
grep -q 'All approved migrations completed' "$TMP/output"
grep -q 'migrate --path=database/migrations/2026_10_18_000001_drop_retired_staff_role.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_19_000001_create_analytics_measurements.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_19_000003_add_analytics_browsers.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_19_000004_add_account_deletion.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_19_000002_create_passkeys.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_20_000001_create_node_dictionary.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_21_000001_create_node_target_snapshots.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_21_000002_create_node_target_daily.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_22_000001_create_node_maintenance.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_21_000003_index_dashboard_financial.php --force --no-interaction' calls.log

grep -q 'migrate --path=database/migrations/2026_10_20_000002_create_client_recognition.php --force --no-interaction' calls.log

grep -q 'migrate --path=database/migrations/2026_10_20_000003_create_node_credentials.php --force --no-interaction' calls.log

grep -q 'migrate --path=database/migrations/2026_10_23_000001_manage_node_dns.php --force --no-interaction' calls.log

grep -q 'migrate --path=database/migrations/2026_10_23_000002_node_tls_transition.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_23_000004_proxy_service_routes.php --force --no-interaction' calls.log
grep -q 'migrate --path=database/migrations/2026_10_24_000001_link_server_traffic_budget.php --force --no-interaction' calls.log

new_site missingplantranslationmigration
git checkout -q codex/payment-icon-picker
git rm -q database/migrations/2026_10_30_000001_track_plan_translation_sources.php
git -c user.email=test@example.test -c user.name='Updater Test' commit -qm 'Incomplete translation upgrade fixture'
git push -q origin HEAD:missing-plan-translation-migration
ARGS+=(--branch missing-plan-translation-migration)
reject --check
grep -q 'Target lacks the plan translation source migration' "$TMP/output"
[[ ! -e storage/framework/down ]]

# A target can remove an old production package and move a tool to require-dev
# while carrying an unrelated local dependency forward from the committed base.
cd "$TMP/seed"
git checkout -qb dependencies-before "$TARGET"
"$REAL_PHP" -r '$c=json_decode(file_get_contents("composer.json"),true); $c["require"]["linfo/linfo"]="^4.0"; $c["require"]["laravel/tinker"]="^3.0"; file_put_contents("composer.json",json_encode($c,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)."\n");'
git add composer.json; git commit -qm production-dependency-baseline
git checkout -qb dependencies-after
"$REAL_PHP" -r '$c=json_decode(file_get_contents("composer.json"),true); unset($c["require"]["linfo/linfo"],$c["require"]["laravel/tinker"]); $c["require-dev"]["laravel/tinker"]="^3.0"; file_put_contents("composer.json",json_encode($c,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)."\n");'
git add composer.json; git commit -qm production-dependency-cleanup
git push -q "$TMP/origin.git" dependencies-before dependencies-after
new_site dependencycleanup
git checkout -q dependencies-before
"$REAL_PHP" -r '$c=json_decode(file_get_contents("composer.json"),true); $c["require"]["joanhey/adapterman"]="^0.7.1"; file_put_contents("composer.json",json_encode($c,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)."\n");'
cp composer.json "$TMP/dependencies-local.json"
ARGS+=(--branch dependencies-after)
bash "$SOURCE" "${ARGS[@]}" --check --resolve-dependencies > "$TMP/output" 2>&1
cmp composer.json "$TMP/dependencies-local.json"
[[ ! -e storage/framework/down ]]
bash "$SOURCE" "${ARGS[@]}" --jobs-stopped --resolve-dependencies > "$TMP/output" 2>&1
"$REAL_PHP" -r '
$c=json_decode(file_get_contents("composer.json"),true);
if (isset($c["require"]["linfo/linfo"]) || isset($c["require"]["laravel/tinker"])
    || isset($c["require-dev"]["linfo/linfo"]) || ($c["require-dev"]["laravel/tinker"]??null)!=="^3.0"
    || ($c["require"]["joanhey/adapterman"]??null)!=="^0.7.1") exit(1);
'
grep -q 'install --no-dev' calls.log
[[ -e storage/framework/down ]]

# A release must never replace private settings with a tracked canonical file.
cd "$TMP/seed"
git checkout -qb tracked-canonical-settings "$TARGET"
printf '<?php return ["untrusted_release_setting"=>true];\n' > config/fastai.php
git add -f config/fastai.php
git commit -qm unsafe-tracked-settings-fixture
git push -q "$TMP/origin.git" tracked-canonical-settings
new_site trackedcanonicalconfig
ARGS+=(--branch tracked-canonical-settings)
reject --check
grep -q 'Target must not track config/fastai.php' "$TMP/output"
[[ ! -e storage/framework/down ]]

# The historical tracked loaders must be retired, never restored as private
# settings. Reading fixture Git blobs also works in a shallow source checkout.
for version in current initial; do
    if [[ "$version" == current ]]; then public_blob=$public_current; else public_blob=$public_initial; fi
    cd "$TMP/seed"
    git checkout -qb "public-loader-$version" "$OLD"
    mkdir -p config
    git cat-file blob "$public_blob" > config/fastai.php
    git add -f config/fastai.php
    git commit -qm "Historical public signing loader $version"
    historical_old=$(git rev-parse HEAD)
    [[ $(git rev-parse HEAD:config/fastai.php) == "$public_blob" ]]
    git checkout -qb "retired-loader-$version"
    git read-tree --reset -u "$TARGET"
    git cat-file blob "$public_current" > config/entrypoint-signing.php
    git add config/entrypoint-signing.php
    git commit -qm "Relocate public signing loader $version"
    historical_target=$(git rev-parse HEAD)
    for private_path in .env config/fastai.php config/v2board.php; do
        ! git cat-file -e "HEAD:$private_path" 2>/dev/null
    done
    git push -q "$TMP/origin.git" "public-loader-$version" "retired-loader-$version"

    new_site "retired-public-$version"
    git checkout -q "public-loader-$version"
    mkdir -p storage/app "$TMP/expected-public-$version"
    printf '<?php return ["preserved"=>true,"legacy_only"=>"unchanged"];\n' > config/v2board.php
    printf 'fixture-signing-seed-%s\n' "$version" > storage/app/fastai-entrypoint.seed
    chmod 640 config/v2board.php
    chmod 600 storage/app/fastai-entrypoint.seed
    cp -p config/v2board.php "$TMP/expected-public-$version/legacy.php"
    cp -p storage/app/fastai-entrypoint.seed "$TMP/expected-public-$version/seed"
    git cat-file blob "$public_current" > "$TMP/expected-public-$version/public.php"
    ARGS+=(--branch "retired-loader-$version" --backup-dir "$TMP/retired-public-$version-backups")
    export EXPECT_RETIRED_LOADER_DIR="$TMP/expected-public-$version"
    bash "$SOURCE" "${ARGS[@]}" --jobs-stopped > "$TMP/output" 2>&1
    unset EXPECT_RETIRED_LOADER_DIR
    [[ $(git rev-parse HEAD) == "$historical_target" && -e storage/framework/down ]]
    [[ ! -e config/fastai.php ]]
    cmp config/v2board.php "$TMP/expected-public-$version/legacy.php"
    cmp config/entrypoint-signing.php "$TMP/expected-public-$version/public.php"
    cmp storage/app/fastai-entrypoint.seed "$TMP/expected-public-$version/seed"
    [[ $(stat -c %a config/v2board.php) == 640 ]]
    [[ $(stat -c %a storage/app/fastai-entrypoint.seed) == 600 ]]
    grep -q 'retired public loader verified before dependency scripts' calls.log
    protected=$(find "$TMP/retired-public-$version-backups" -name protected.sha256 -print -quit)
    [[ -n "$protected" ]]
    ! grep -q 'config/fastai.php$' "$protected"
    grep -q 'config/v2board.php$' "$protected"
    sha256sum -c "$protected" > /dev/null
    tar -xOf "${protected%/*}/site.tar.gz" ./config/v2board.php | cmp - "$TMP/expected-public-$version/legacy.php"
    tar -xOf "${protected%/*}/site.tar.gz" ./storage/app/fastai-entrypoint.seed | cmp - "$TMP/expected-public-$version/seed"
    tar -xOf "${protected%/*}/site.tar.gz" ./config/fastai.php | git hash-object --stdin | grep -qx "$public_blob"
    mkdir "$TMP/expected-public-$version/archive"
    tar -xzf "${protected%/*}/site.tar.gz" -C "$TMP/expected-public-$version/archive" ./config/v2board.php ./storage/app/fastai-entrypoint.seed
    [[ $(stat -c %a "$TMP/expected-public-$version/archive/config/v2board.php") == 640 ]]
    [[ $(stat -c %a "$TMP/expected-public-$version/archive/storage/app/fastai-entrypoint.seed") == 600 ]]

    # A locally edited loader cannot safely be identified as public code or
    # private settings. Reject every variant before maintenance or checkout.
    for change in custom-loader private-only both-settings assume-private skip-private; do
        new_site "dirty-public-$version-$change"
        git checkout -q "public-loader-$version"
        mkdir -p storage/app "$TMP/expected-dirty-$version-$change"
        if [[ "$change" == custom-loader ]]; then
            printf '\n// Locally customized public loader must be reviewed.\n' >> config/fastai.php
        else
            printf '<?php return ["canonical_private"=>true,"disabled"=>false];\n' > config/fastai.php
        fi
        if [[ "$change" == private-only ]]; then rm config/v2board.php; fi
        printf 'unchanged-dirty-fixture-seed\n' > storage/app/fastai-entrypoint.seed
        chmod 600 config/fastai.php storage/app/fastai-entrypoint.seed
        [[ ! -f config/v2board.php ]] || chmod 640 config/v2board.php
        cp -p config/fastai.php "$TMP/expected-dirty-$version-$change/fastai.php"
        cp -p storage/app/fastai-entrypoint.seed "$TMP/expected-dirty-$version-$change/seed"
        if [[ -f config/v2board.php ]]; then cp -p config/v2board.php "$TMP/expected-dirty-$version-$change/legacy.php"; fi
        if [[ "$change" == assume-private ]]; then
            git update-index --assume-unchanged config/fastai.php
            git diff --quiet -- config/fastai.php
        elif [[ "$change" == skip-private ]]; then
            git update-index --skip-worktree config/fastai.php
            git diff --quiet -- config/fastai.php
        fi
        ARGS+=(--branch "retired-loader-$version" --backup-dir "$TMP/dirty-public-$version-$change-backups")
        reject --jobs-stopped
        [[ $(git rev-parse HEAD) == "$historical_old" && ! -e storage/framework/down ]]
        cmp config/fastai.php "$TMP/expected-dirty-$version-$change/fastai.php"
        cmp storage/app/fastai-entrypoint.seed "$TMP/expected-dirty-$version-$change/seed"
        [[ $(stat -c %a config/fastai.php) == 600 && $(stat -c %a storage/app/fastai-entrypoint.seed) == 600 ]]
        if [[ "$change" == private-only ]]; then
            [[ ! -e config/v2board.php ]]
        else
            cmp config/v2board.php "$TMP/expected-dirty-$version-$change/legacy.php"
            [[ $(stat -c %a config/v2board.php) == 640 ]]
        fi
        [[ ! -e config/entrypoint-signing.php && ! -e "$TMP/dirty-public-$version-$change-backups" ]]
        [[ ! -e calls.log ]]
        grep -q 'Local changes to tracked config/fastai.php' "$TMP/output"
    done
done

echo 'Updater: 56 isolated scenarios passed'
