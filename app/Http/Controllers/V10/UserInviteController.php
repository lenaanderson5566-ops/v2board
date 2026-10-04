<?php
namespace App\Http\Controllers\V10;
class UserInviteController extends ResourceController
{
    public function postMeInvitationsRetiredCodes(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeInvitationsRetiredCodes');
        $result = app(\App\Services\Actions\User\InviteActions::class)->save($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postMeInvitationsRetiredCodes');
    }
    public function getMeReferrals(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeReferrals');
        $result = app(\App\Services\Actions\User\InviteActions::class)->fetch($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeReferrals');
    }
    public function getMeCommissions(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeCommissions');
        $result = app(\App\Services\Actions\User\InviteActions::class)->details($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeCommissions');
    }
    public function postMeInvitations(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeInvitations');
        $result = app(\App\Services\Actions\User\InviteActions::class)->sendEmail($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postMeInvitations');
    }
    public function getMeInvitations(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeInvitations');
        $result = app(\App\Services\Actions\User\InviteActions::class)->emailHistory($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeInvitations');
    }
}
