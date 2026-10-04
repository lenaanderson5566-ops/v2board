<?php
namespace App\Http\Controllers\V10;
class GuestCommController extends ResourceController
{
    public function getPublicSettings(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getPublicSettings');
        $result = app(\App\Services\Actions\Guest\CommActions::class)->config();
        return $this->respond($request, $result, 'getPublicSettings');
    }
}
