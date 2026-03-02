<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\Plan;
use App\Models\PlanTranslation;
use Illuminate\Http\Request;

class PlanI18nController extends Controller
{
    private const RECOMMENDED_LOCALES = [
        'zh-CN', 'zh-TW', 'zh-HK', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt-BR', 'ru',
        'ar', 'tr', 'vi', 'th', 'id', 'ms', 'hi', 'it', 'nl', 'pl', 'uk'
    ];

    public function locales()
    {
        $files = glob(resource_path('lang') . '/*.json');
        $locales = [];
        foreach ($files as $file) {
            $locales[] = basename($file, '.json');
        }

        $dbLocales = PlanTranslation::query()->distinct()->pluck('locale')->toArray();

        $all = array_values(array_unique(array_filter(array_merge($locales, self::RECOMMENDED_LOCALES, $dbLocales))));
        sort($all);

        return response([
            'data' => [
                'all' => $all,
                'recommended' => self::RECOMMENDED_LOCALES,
                'from_filesystem' => $locales,
                'from_db' => $dbLocales
            ]
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

    public function save(Request $request)
    {
        $params = $request->validate([
            'plan_id' => 'required|integer',
            'locale' => ['required', 'string', 'max:16', 'regex:/^[A-Za-z0-9_-]+$/'],
            'name' => 'nullable|string|max:255',
            'content' => 'nullable|string'
        ], [
            'locale.regex' => '语言标识格式不正确'
        ]);

        $plan = Plan::find($params['plan_id']);
        if (!$plan) {
            abort(500, '订阅不存在');
        }

        $params['locale'] = trim($params['locale']);

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
