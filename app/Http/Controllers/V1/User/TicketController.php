<?php
namespace App\Http\Controllers\V1\User;

class TicketController extends \App\Http\Controllers\Controller
{
    public function reply(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\TicketActions::class)->reply($request);
    }
    public function close(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\TicketActions::class)->close($request);
    }
    public function save(\App\Http\Requests\User\TicketSave $request)
    {
        return app(\App\Services\Actions\User\TicketActions::class)->save($request);
    }
    public function fetch(\Illuminate\Http\Request $request)
    {
        return app(\App\Services\Actions\User\TicketActions::class)->fetch($request);
    }
    public function withdraw(\App\Http\Requests\User\TicketWithdraw $request)
    {
        return app(\App\Services\Actions\User\TicketActions::class)->withdraw($request);
    }
}
