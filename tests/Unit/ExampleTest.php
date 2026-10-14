<?php

namespace Tests\Unit;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;
use Tests\Support\Assertions;

class ExampleTest extends TestCase
{
    /**
     * A basic test example.
     *
     * @return void
     */
    public function testBasicTest()
    {
        $this->assertTrue(true);
    }

    public function testCounterIncrementsOnlyAfterSuccessfulAssertion(): void
    {
        require_once dirname(__DIR__).'/support/Assertions.php';
        $count = 0;
        $assert = Assertions::counter($count);
        $assert(true, 'success');
        try {
            $assert(false, 'failure');
            $this->fail('A failed assertion must throw');
        } catch (\RuntimeException $error) {
            $this->assertSame('failure', $error->getMessage());
        }
        $this->assertSame(1, $count);
    }
}
