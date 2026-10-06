<?php

namespace App\Services;

// Keep native configuration separate from public subscription protocol discovery.
class FastaiConfig extends \App\Protocols\ClashMeta
{
    public $flag = 'fastai';
    protected $templateName = 'fastai';
    protected $subscriptionMetadata = false;
}
