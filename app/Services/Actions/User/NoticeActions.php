<?php

namespace App\Services\Actions\User;


use App\Models\Notice;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class NoticeActions
{
    private function localized($notice, Request $request)
    {
        if (!$notice) return $notice;
        $locale = $request->attributes->get('notice_locale') ?: \App\Services\ProductMail::language($request->header('Content-Language') ?: $request->input('language') ?: (isset($request->user['id']) ? \App\Models\User::where('id', $request->user['id'])->value('language') : null) ?: app()->getLocale());
        $request->attributes->set('notice_locale', $locale);
        $variant = ($notice->translations ?? [])[$locale] ?? [];
        if (!empty($variant['subject']) && !empty($variant['content'])) {
            $notice->title = $variant['subject'];
            $notice->content = $variant['content'];
        }
        $notice->makeHidden('translations');
        return $notice;
    }

    public function inbox(Request $request)
    {
        $request->validate(['current' => 'sometimes|integer|min:1']);
        $ready = Schema::hasTable('v2_notice_read');
        $model = Notice::where('v2_notice.show', 1);
        if ($ready) {
            $model->leftJoin('v2_notice_read as receipt', function ($join) use ($request) {
                $join->on('receipt.notice_id', '=', 'v2_notice.id')
                    ->where('receipt.user_id', '=', $request->user['id']);
            });
        }
        $total = (clone $model)->count();
        $unread = $ready ? (clone $model)->where(function ($query) {
            $query->whereNull('receipt.notice_id')
                ->orWhereColumn('receipt.notice_updated_at', '<', 'v2_notice.updated_at');
        })->count() : $total;
        $items = $model->select('v2_notice.*')
            ->selectRaw($ready ? 'CASE WHEN receipt.notice_updated_at >= v2_notice.updated_at THEN 1 ELSE 0 END AS is_read' : '0 AS is_read')
            ->orderBy('v2_notice.created_at', 'DESC')->orderBy('v2_notice.id', 'DESC')
            ->forPage($request->input('current', 1), $request->is('api/v10/*') ? (int)$request->input('page_size',20) : 10)->get();
        $items->each(function ($notice) use ($request) { $this->localized($notice, $request); });
        return response(['data' => ['items' => $items, 'total' => $total, 'unread' => $unread]]);
    }

    public function read(Request $request)
    {
        $data = $request->validate(['id' => 'required|integer|min:1', 'version' => 'required|integer|min:0']);
        if (!Schema::hasTable('v2_notice_read')) {
            return response(['message' => 'Announcement read tracking requires the database upgrade.', 'code' => 'NOTICE_MIGRATION_REQUIRED'], 503);
        }
        return DB::transaction(function () use ($request, $data) {
            // Serialize edits and reads; an older open panel must not acknowledge a newer announcement.
            $notice = Notice::where('id', $data['id'])->where('show', 1)->lockForUpdate()->first();
            if (!$notice) return response(['message' => 'Notice not found'], 404);
            if ((int) $notice->getRawOriginal('updated_at') !== (int) $data['version']) {
                return response(['message' => 'Announcement changed. Please reopen it.', 'code' => 'NOTICE_VERSION_CHANGED'], 409);
            }
            DB::table('v2_notice_read')->updateOrInsert(
                ['user_id' => $request->user['id'], 'notice_id' => $notice->id],
                ['notice_updated_at' => $data['version'], 'read_at' => time()]
            );
            return response(['data' => true]);
        });
    }

    public function fetch(Request $request)
    {
        if ($request->has('id')) {
            $id = $request->input('id');
            $notice = Notice::where('id', $id)
                ->where('show', 1)
                ->first();

            if (!$notice) {
                return response([
                    'message' => 'Notice not found'
                ], 404);
            }

            return response([
                'data' => $this->localized($notice, $request)
            ]);
        }

        $current = $request->input('current', 1);
        $pageSize = $request->input('pageSize', 5);

        $pageSize = min(max($pageSize, 1), 100);

        $model = Notice::orderBy('created_at', 'DESC')
            ->where('show', 1);

        $total = $model->count();
        $res = $model->forPage($current, $pageSize)->get();

        $res->each(function ($notice) use ($request) { $this->localized($notice, $request); });
        return response([
            'data' => $res,
            'total' => $total
        ]);
    }

}
