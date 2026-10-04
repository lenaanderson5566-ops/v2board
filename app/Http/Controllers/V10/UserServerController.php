<?php
namespace App\Http\Controllers\V10;
class UserServerController extends ResourceController
{
    public function getMeNodes(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeNodes');
        $result = app(\App\Services\Actions\User\ServerActions::class)->fetch($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeNodes');
    }
}
