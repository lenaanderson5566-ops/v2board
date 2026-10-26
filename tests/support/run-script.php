<?php
// Keep uncaught test failures outside Laravel's console exception handler.
$testScript = $argv[1] ?? null;
if (!$testScript || !is_file($testScript)) {
    fwrite(STDERR, "Missing test script\n");
    exit(1);
}
array_shift($argv);
$argc = count($argv);
$_SERVER['argv'] = $argv;
$_SERVER['argc'] = $argc;
try {
    require $testScript;
} catch (Throwable $error) {
    fwrite(STDERR, get_class($error).': '.$error->getMessage()."\n".$error->getTraceAsString()."\n");
    exit(1);
}
