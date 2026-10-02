<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\Plan;
use App\Models\PlanTranslation;
use Illuminate\Http\Request;

class PlanI18nController extends Controller
{
    public function locales()
    {
        $files = glob(resource_path('lang') . '/*.json');
        $locales = [];
        foreach ($files as $file) {
            $locales[] = basename($file, '.json');
        }
        sort($locales);

        return response([
            'data' => $locales
        ]);
    }

    public function fetch(Request $request)
    {
        $request->validate([
            'plan_id' => 'required|integer'
        ]);

        $plan = Plan::find($request->input('plan_id'));
        if (!$plan) {
            abort(500, '订阅不存在');
        }

        $translations = PlanTranslation::where('plan_id', $plan->id)->get();
        $data = [];
        foreach ($translations as $item) {
            $data[$item->locale] = [
                'name' => $item->name,
                'content' => $item->content
            ];
        }

        return response([
            'data' => [
                'plan_id' => $plan->id,
                'default' => [
                    'name' => $plan->name,
                    'content' => $plan->content
                ],
                'translations' => $data
            ]
        ]);
    }

    public function generate(Request $request)
    {
        $params = $request->validate([
            'plan_id'=>'required|integer',
            'source'=>'required|in:zh-CN,zh-TW,en-US,ja-JP,ko-KR,vi-VN,ru-RU,fa-IR',
            'locale'=>'required|in:zh-CN,zh-TW,en-US,ja-JP,ko-KR,vi-VN,ru-RU,fa-IR',
        ]);
        $plan = Plan::findOrFail($params['plan_id']);
        $content = (string) $plan->content;
        if (strlen($content) > 20000) abort(422, '套餐描述过长，请分段人工翻译');
        $translated = $params['source'] === $params['locale'] ? $content :
            app(\App\Services\PlanAutoTranslation::class)->generate($content, $params['source'], $params['locale']);
        return response(['data'=>['name'=>$plan->name, 'content'=>$translated, 'source_hash'=>hash('sha256', $content)]]);
    }

    public function save(Request $request)
    {
        $params = $request->validate([
            'plan_id' => 'required|integer',
            'locale' => 'required|string|max:16',
            'name' => 'nullable|string|max:255',
            'content' => 'nullable|string',
            'only_missing' => 'sometimes|boolean',
            'source_hash' => 'required_if:only_missing,true|string|size:64'
        ]);

        $plan = Plan::find($params['plan_id']);
        if (!$plan) {
            abort(500, '订阅不存在');
        }

        $localeFile = resource_path('lang/' . $params['locale'] . '.json');
        if (!is_file($localeFile)) {
            abort(500, '语言不存在');
        }

        if (!empty($params['only_missing'])) {
            $saved = \Illuminate\Support\Facades\DB::transaction(function () use ($params) {
                $locked = Plan::where('id', $params['plan_id'])->lockForUpdate()->firstOrFail();
                if (!hash_equals(hash('sha256', (string) $locked->content), $params['source_hash'])) abort(409, '套餐原文已变更，请重新生成译文');
                $existing = PlanTranslation::where('plan_id', $locked->id)->where('locale', $params['locale'])->first();
                if ($existing && trim((string) $existing->content) !== '') return false;
                PlanTranslation::updateOrCreate(['plan_id'=>$locked->id, 'locale'=>$params['locale']],
                    ['name'=>$existing && $existing->name ? $existing->name : ($params['name'] ?? $locked->name), 'content'=>$params['content'] ?? '']);
                return true;
            });
            return response(['data'=>$saved]);
        }

        $name = $params['name'] ?? null;
        $content = $params['content'] ?? null;

        if (($name === null || $name === '') && ($content === null || $content === '')) {
            PlanTranslation::where('plan_id', $plan->id)
                ->where('locale', $params['locale'])
                ->delete();

            return response([
                'data' => true
            ]);
        }

        PlanTranslation::updateOrCreate(
            [
                'plan_id' => $plan->id,
                'locale' => $params['locale']
            ],
            [
                'name' => $name,
                'content' => $content
            ]
        );

        return response([
            'data' => true
        ]);
    }
}
