<?php
// Run with open_basedir restricted to the application and temporary directory.
require __DIR__ . '/../vendor/autoload.php';

set_error_handler(function ($severity, $message, $file, $line) {
    throw new ErrorException($message, 0, $severity, $file, $line);
});
$checks = 0;
$original = Illuminate\Support\Env::get('HORIZON_MAX_PROCESSES');
$repository = Illuminate\Support\Env::getRepository();
try {
    foreach ([null => 6, '12' => 12, '0' => 1, '-2' => 1, 'invalid' => 1] as $input => $expected) {
        if ($input === '') $repository->clear('HORIZON_MAX_PROCESSES');
        else $repository->set('HORIZON_MAX_PROCESSES', $input);
        ob_start();
        try { $config = require __DIR__ . '/../config/horizon.php'; }
        finally { $output = ob_get_clean(); }
        if ($output !== '') throw new RuntimeException('Configuration emitted response output');
        if ($config['environments']['*']['V2board']['maxProcesses'] !== $expected) {
            throw new RuntimeException('Incorrect queue worker limit');
        }
        $checks++;
    }
    echo "Horizon config: {$checks} checks passed\n";
} finally {
    if ($original === null) $repository->clear('HORIZON_MAX_PROCESSES');
    else $repository->set('HORIZON_MAX_PROCESSES', $original);
    restore_error_handler();
}
