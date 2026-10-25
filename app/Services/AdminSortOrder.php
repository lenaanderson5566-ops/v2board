<?php
namespace App\Services;

use Illuminate\Support\Facades\DB;

/** Validate and lock the entire selection before changing any persisted order. */
final class AdminSortOrder
{
    public static function apply(string $model, array $ids, bool $timestamps = true): void
    {
        DB::transaction(function () use ($model, $ids, $timestamps) {
            $records = $model::whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            abort_unless($records->count() === count($ids), 422, '部分记录已不存在，请重新载入列表');
            foreach (array_values($ids) as $position => $id) {
                $record = $records->get($id);
                if ((int)$record->sort === $position + 1) continue;
                $record->timestamps = $timestamps;
                $record->update(['sort' => $position + 1]);
            }
        });
    }
}
