<?php
namespace App\Http\Controllers\V10;
class UserTicketController extends ResourceController
{
    public function postMeTicketsTicketIdMessages(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeTicketsTicketIdMessages');
        $result = app(\App\Services\Actions\User\TicketActions::class)->reply($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postMeTicketsTicketIdMessages');
    }
    public function postMeTicketsTicketIdClosure(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeTicketsTicketIdClosure');
        $result = app(\App\Services\Actions\User\TicketActions::class)->close($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'postMeTicketsTicketIdClosure');
    }
    public function postMeTickets(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeTickets');
        $result = app(\App\Services\Actions\User\TicketActions::class)->save($this->businessRequest($request, \App\Http\Requests\User\TicketSave::class));
        return $this->respond($request, $result, 'postMeTickets');
    }
    public function getMeTickets(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeTickets');
        $result = app(\App\Services\Actions\User\TicketActions::class)->fetch($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeTickets');
    }
    public function postMeCommissionWithdrawals(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'postMeCommissionWithdrawals');
        $result = app(\App\Services\Actions\User\TicketActions::class)->withdraw($this->businessRequest($request, \App\Http\Requests\User\TicketWithdraw::class));
        return $this->respond($request, $result, 'postMeCommissionWithdrawals');
    }
    public function getMeTicketsTicketId(\Illuminate\Http\Request $request)
    {
        $this->prepare($request, 'getMeTicketsTicketId');
        $result = app(\App\Services\Actions\User\TicketActions::class)->fetch($this->businessRequest($request, \Illuminate\Http\Request::class));
        return $this->respond($request, $result, 'getMeTicketsTicketId');
    }
}
