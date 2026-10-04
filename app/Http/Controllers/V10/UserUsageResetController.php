<?php
namespace App\Http\Controllers\V10;
class UserUsageResetController extends ResourceController
{
    public function getMeUsageResets(\Illuminate\Http\Request $request ,\App\Services\UsageResetService $service)
    {
        $this->prepare($request, 'getMeUsageResets');
        $result = app(\App\Services\Actions\User\UsageResetActions::class)->fetch($this->businessRequest($request, \Illuminate\Http\Request::class), $service);
        return $this->respond($request, $result, 'getMeUsageResets');
    }
    public function postMeUsageResetsConsumptions(\Illuminate\Http\Request $request ,\App\Services\UsageResetService $service)
    {
        $this->prepare($request, 'postMeUsageResetsConsumptions');
        $result = app(\App\Services\Actions\User\UsageResetActions::class)->consume($this->businessRequest($request, \Illuminate\Http\Request::class), $service);
        return $this->respond($request, $result, 'postMeUsageResetsConsumptions');
    }
}
