<?php
namespace App\Services;

class MigrationHealthService
{
    // These historical steps are superseded by the compatibility migration.
    private const LEGACY = [
        '2026_02_21_000001_create_login_log_table',
        '2026_02_21_000002_create_subscribe_log_table',
        '2026_02_21_000003_create_risk_rule_hit_table',
        '2026_02_21_000004_add_traffic_snapshot_to_subscribe_log_table',
        '2026_02_21_000005_create_risk_rule_config_table',
        '2026_02_26_000006_create_client_strategy_table',
        '2026_02_26_000007_add_min_version_to_client_strategy_table',
        '2026_02_26_000008_create_risk_blacklist_table',
        '2026_02_26_000009_split_risk_blacklist_tables',
        '2026_02_26_000010_add_ua_raw_to_risk_blacklist_ua_hash_table',
        '2026_02_26_000011_seed_default_ua_blacklist',
        '2026_02_26_000012_cleanup_legacy_blacklist_and_resync_default_ua',
        '2026_02_26_000013_create_user_online_snapshot_table',
        '2026_02_26_000014_create_user_connection_log_table',
        '2026_02_26_000015_optimize_user_online_snapshot_unique_index',
        '2026_02_26_000016_create_risk_setting_table',
        '2026_02_28_000001_create_plan_translations_table',
        '2026_02_28_000016_alter_user_last_login_ip_to_unsigned_bigint',
        '2026_02_28_000017_alter_user_last_login_ip_to_varchar',
    ];

    public static function pending(array $files, array $ran, bool $failedJobsExists): array
    {
        $covered = $ran;
        if (in_array('2026_10_11_000000_ensure_operations_schema', $ran, true)) {
            $covered = array_merge($covered, self::LEGACY);
        }
        // Legacy SQL installs create this table without a Laravel migration record.
        if ($failedJobsExists) $covered[] = '2019_08_19_000000_create_failed_jobs_table';
        return array_values(array_diff(array_keys($files), $covered));
    }
}
