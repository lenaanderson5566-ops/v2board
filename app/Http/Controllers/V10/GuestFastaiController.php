<?php
namespace App\Http\Controllers\V10;
class GuestFastaiController extends ResourceController
{
    public function getPublicFastaiReleasesLatest(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getPublicFastaiReleasesLatest');
        $result = app(\App\Services\Actions\Guest\FastaiActions::class)->release($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getPublicFastaiReleasesLatest');
    }
    public function getPublicFastaiEntrypoints(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getPublicFastaiEntrypoints');
        $result = app(\App\Services\Actions\Guest\FastaiActions::class)->entrypoints($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getPublicFastaiEntrypoints');
    }
}
