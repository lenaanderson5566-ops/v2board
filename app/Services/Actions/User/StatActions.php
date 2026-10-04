<?php

namespace App\Services\Actions\User;


use App\Models\StatUser;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class StatActions
{
    public function getTrafficLog(Request $request)
    {
        $request->validate(['days' => 'nullable|integer|in:7,30']);
        // Optional rolling window; preserve the original calendar-month default.
        $start = $request->filled('days')
            ? strtotime('-' . ((int) $request->input('days') - 1) . ' days', strtotime(date('Y-m-d')))
            : strtotime(date('Y-m-1'));
        $builder = StatUser::select([
            'u',
            'd',
            'record_at',
            'user_id',
            'server_rate'
        ])
            ->where('user_id', $request->user['id'])
            ->where('record_at', '>=', $start)
            ->where('record_at', '<', strtotime('tomorrow'))
            ->orderBy('record_at', 'DESC');
        return response([
            'data' => $builder->get()
        ]);
    }
}
