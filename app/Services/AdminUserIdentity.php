<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Collection;

class AdminUserIdentity
{
    public static function append(Collection $rows): void
    {
        $ids = $rows->pluck('user_id')->merge($rows->pluck('invite_user_id'))->filter()->unique();
        $emails = $ids->isEmpty() ? collect() : User::whereIn('id', $ids)->pluck('email', 'id');
        foreach ($rows as $row) {
            if ($row->user_id) {
                $row['email'] = $emails->get($row->user_id);
            }
            if ($row->invite_user_id) {
                $row['invite_email'] = $emails->get($row->invite_user_id);
            }
        }
    }
}
