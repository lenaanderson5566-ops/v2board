<?php
namespace App\Http\Controllers\V1\Guest;

class CommController extends \App\Http\Controllers\Controller
{
    public function config()
    {
        return app(\App\Services\Actions\Guest\CommActions::class)->config();
    }
}
