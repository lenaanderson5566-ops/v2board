<?php
namespace App\Http\Controllers\V10;
class UserStatController extends ResourceController
{
    public function getMeTrafficRecords(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeTrafficRecords');
        $result = app(\App\Services\Actions\User\StatActions::class)->getTrafficLog($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeTrafficRecords');
    }
}
