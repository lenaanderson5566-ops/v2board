<?php
namespace App\Http\Controllers\V10;
class UserPlanController extends ResourceController
{
    public function getCreditPackages(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getCreditPackages');
        $result = app(\App\Services\Actions\User\PlanActions::class)->credits($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getCreditPackages');
    }
    public function getPlans(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getPlans');
        $result = app(\App\Services\Actions\User\PlanActions::class)->fetch($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getPlans');
    }
    public function getPlansPlanId(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getPlansPlanId');
        $result = app(\App\Services\Actions\User\PlanActions::class)->fetch($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getPlansPlanId');
    }
}
