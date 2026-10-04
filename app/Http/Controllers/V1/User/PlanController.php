<?php
namespace App\Http\Controllers\V1\User;

class PlanController extends \App\Http\Controllers\Controller
{
    public function credits(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\PlanActions::class)->credits($request);
    }
    public function fetch(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\PlanActions::class)->fetch($request);
    }
}
