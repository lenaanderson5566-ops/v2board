<?php
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!app()->environment('local')) throw new RuntimeException('Local test only');
use Illuminate\Support\Facades\DB;

$sql = file_get_contents(__DIR__.'/../database/install.sql');
$sql = substr($sql, strpos($sql, '/* Default exact-match UA blacklist.'));
$sql = str_replace('`v2_risk_blacklist_ua_hash`', '`test_default_ua_install`', $sql);
$sql = str_replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE IF NOT EXISTS', $sql);
$run = function () use ($sql) {
    // Reproduce the installer's newline removal and semicolon splitting.
    foreach (explode(';', str_replace("\n", '', $sql)) as $statement) {
        if (trim($statement) !== '') DB::statement($statement);
    }
};
$assert = function ($ok, $message) { if (!$ok) throw new RuntimeException($message); };
try {
    $run();
    $rows = DB::table('test_default_ua_install')->orderBy('id')->get();
    $assert($rows->count() === 11, 'Expected 11 default UA records');
    foreach ($rows as $row) {
        $assert(hash('sha256', $row->ua_raw) === $row->value, 'UA hash mismatch');
        $assert((int) $row->is_enabled === 1, 'Default must be enabled');
    }
    $assert($rows->last()->value === '63279522febcf5538b72996c16a8660ff177cd5536e86fb9c2a577bf32a65430', 'Browser UA mismatch');
    DB::table('test_default_ua_install')->where('id', $rows->first()->id)->update(['is_enabled' => 0, 'remark' => 'custom']);
    $before = DB::table('test_default_ua_install')->orderBy('id')->get()->toJson();
    $run();
    $assert(DB::table('test_default_ua_install')->orderBy('id')->get()->toJson() === $before, 'Repeat import must preserve existing settings');
    echo "Default UA install: 25 checks passed\n";
} finally {
    DB::statement('DROP TEMPORARY TABLE IF EXISTS `test_default_ua_install`');
}
