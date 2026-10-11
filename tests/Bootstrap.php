<?php
namespace Tests;

use Illuminate\Contracts\Console\Kernel;
use PHPUnit\Event\TestRunner\ExecutionStarted;
use PHPUnit\Event\TestRunner\ExecutionStartedSubscriber;
use PHPUnit\Event\TestRunner\ExecutionFinished;
use PHPUnit\Event\TestRunner\ExecutionFinishedSubscriber;
use PHPUnit\Runner\Extension\Extension;
use PHPUnit\Runner\Extension\Facade;
use PHPUnit\Runner\Extension\ParameterCollection;
use PHPUnit\TextUI\Configuration\Configuration;

class Bootstrap implements Extension
{
    use CreatesApplication;

    public function bootstrap(Configuration $configuration, Facade $facade, ParameterCollection $parameters): void
    {
        $facade->registerSubscriber(new class($this) implements ExecutionStartedSubscriber {
            public function __construct(private Bootstrap $extension) {}
            public function notify(ExecutionStarted $event): void { $this->extension->prepare(); }
        });
        $facade->registerSubscriber(new class($this) implements ExecutionFinishedSubscriber {
            public function __construct(private Bootstrap $extension) {}
            public function notify(ExecutionFinished $event): void { $this->extension->cleanup(); }
        });
    }

    public function prepare(): void
    {
        $console=$this->createApplication()->make(Kernel::class);
        try {
            foreach (['config:cache', 'event:cache'] as $command) $console->call($command);
        } finally {
            // Do not carry the preparation application's handlers into individual tests.
            \Illuminate\Foundation\Bootstrap\HandleExceptions::flushState();
        }
    }

    public function cleanup(): void
    {
        foreach (glob(dirname(__DIR__).'/bootstrap/cache/*.phpunit.php') as $file) unlink($file);
    }
}
