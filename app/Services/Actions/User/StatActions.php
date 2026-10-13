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
            'record_timezone',
            'user_id',
            'server_rate'
        ])
            ->where('user_id', $request->user['id'])
            ->where('record_at', '>=', $start - 172800)
            ->where('record_at', '<', strtotime('tomorrow') + 172800)
            ->orderBy('record_at', 'desc');
        return response([
            'data' => $builder->get()->map(function ($row) {
                $zone=\App\Services\TimeZones::valid($row->record_timezone)?$row->record_timezone:'Asia/Shanghai';
                $row->record_timezone=$zone;
                $row->business_date=(new \DateTimeImmutable('@'.$row->record_at))->setTimezone(new \DateTimeZone($zone))->format('Y-m-d');
                return $row;
            })->filter(function ($row) use ($start) { return $row->business_date>=date('Y-m-d',$start) && $row->business_date<=date('Y-m-d'); })->values()
        ]);
    }
}
