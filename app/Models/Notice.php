<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Notice extends Model
{
    protected static function booted()
    {
        static::updating(function ($notice) {
            // Keep the read receipt version monotonic, including edits within the same second.
            $notice->updated_at = max(time(), (int) $notice->getRawOriginal('updated_at') + 1);
        });
    }

    protected $table = 'v2_notice';
    protected $dateFormat = 'U';
    protected $guarded = ['id'];
    protected $casts = [
        'created_at' => 'timestamp',
        'updated_at' => 'timestamp',
        'tags' => 'array'
    ];
}
