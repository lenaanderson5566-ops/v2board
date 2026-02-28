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

    public function save(Request $request)
    {
        $params = $request->validate([
            'plan_id' => 'required|integer',
            'locale' => 'required|string|max:16',
            'name' => 'nullable|string|max:255',
            'content' => 'nullable|string'
        ]);

        $plan = Plan::find($params['plan_id']);
        if (!$plan) {
            abort(500, '订阅不存在');
        }

        $localeFile = resource_path('lang/' . $params['locale'] . '.json');
        if (!is_file($localeFile)) {
            abort(500, '语言不存在');
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
