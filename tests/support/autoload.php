<?php
$testProjectRoot = dirname(__DIR__, 2);
$testLoader = require $testProjectRoot.'/vendor/autoload.php';
$testDependencyRoot = dirname(realpath($testProjectRoot.'/vendor'));
if ($testProjectRoot === $testDependencyRoot) return $testLoader;
$testClassMap = [];
foreach ($testLoader->getClassMap() as $testClass => $testFile) {
    if (!preg_match('/^(App|Library|Tests)\\\\/', $testClass)) continue;
    $testFile = realpath($testFile) ?: $testFile;
    if (str_starts_with($testFile, $testDependencyRoot.'/')) {
        $testClassMap[$testClass] = $testProjectRoot.substr($testFile, strlen($testDependencyRoot));
    }
}
$testLoader->addClassMap($testClassMap);
foreach (['App'=>'app', 'Library'=>'library', 'Tests'=>'tests'] as $testNamespace => $testDirectory) {
    $testLoader->addPsr4($testNamespace.'\\', $testProjectRoot.'/'.$testDirectory.'/', true);
}
return $testLoader;
