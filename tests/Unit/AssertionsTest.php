<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use Tests\Support\Assertions;

class AssertionsTest extends TestCase
{
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
