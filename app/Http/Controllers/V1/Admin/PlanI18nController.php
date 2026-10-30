<?php

namespace App\Http\Controllers\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\Plan;
use App\Models\PlanTranslation;
use App\Services\PlanAutoTranslation;
use App\Services\PlanTranslationState;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class PlanI18nController extends Controller
{
    private function supportedLocales(): array
    {
        $locales = array_map(static fn ($file) => basename($file, '.json'), glob(resource_path('lang').'/*.json'));
        sort($locales);
        return $locales;
    }

    public function locales()
    {
        return response(['data' => $this->supportedLocales()]);
    }

    public function fetch(Request $request)
    {
        $params = $request->validate(['plan_id' => 'required|integer|min:1']);
        $plan = Plan::findOrFail($params['plan_id']);
        $translations = PlanTranslation::where('plan_id', $plan->id)->get()->keyBy('locale');
        $data = [];
        foreach ($this->supportedLocales() as $locale) {
            // The source language has one authoritative copy on Plan, never an editable shadow row.
            if ($locale === PlanTranslationState::SOURCE_LANGUAGE) continue;
            $data[$locale] = PlanTranslationState::resource($plan, $translations->get($locale));
        }
        return response(['data' => [
            'plan_id' => $plan->id,
            'source_language' => PlanTranslationState::SOURCE_LANGUAGE,
            'source_hashes' => PlanTranslationState::hashes($plan),
            'default' => ['name' => $plan->name, 'content' => $plan->content],
            'translations' => $data,
        ]]);
    }

    public function generate(Request $request)
    {
        $params = $request->validate([
            'plan_id' => 'required|integer|min:1',
            'source' => ['required', Rule::in([PlanTranslationState::SOURCE_LANGUAGE])],
            'locale' => ['required', Rule::in($this->supportedLocales()), 'not_in:'.PlanTranslationState::SOURCE_LANGUAGE],
            'fields' => 'sometimes|array|min:1|max:2',
            'fields.*' => ['required', 'distinct', Rule::in(PlanTranslationState::FIELDS)],
        ]);
        $plan = Plan::findOrFail($params['plan_id']);
        $translation = PlanTranslation::where('plan_id', $plan->id)->where('locale', $params['locale'])->first();
        $fields = $params['fields'] ?? ['content'];
        // Capture both versions before external I/O. Saving will reject any intervening change.
        $result = [
            'fields' => $fields,
            'source_hashes' => PlanTranslationState::hashes($plan),
            'translation_version' => PlanTranslationState::version($translation),
            'source_hash' => hash('sha256', (string) $plan->content),
        ];
        $service = app(PlanAutoTranslation::class);
        foreach ($fields as $field) {
            $source = (string) $plan->$field;
            if ($field === 'content') {
                if (strlen($source) > 20000) abort(422, '套餐描述过长，请分段人工翻译');
                $result[$field] = $service->generate($source, $params['source'], $params['locale']);
            } else {
                $result[$field] = trim($source) === '' ? '' : $service->translateTexts([$source], $params['source'], $params['locale'], 'plain')[0];
                if (mb_strlen($result[$field]) > 255) abort(422, '译文名称过长，请人工缩短后保存');
            }
        }
        return response(['data' => $result]);
    }

    public function save(Request $request)
    {
        $legacy = $request->boolean('only_missing');
        $rules = [
            'plan_id' => 'required|integer|min:1',
            'locale' => ['required', Rule::in($this->supportedLocales()), 'not_in:'.PlanTranslationState::SOURCE_LANGUAGE],
            'name' => 'nullable|string|max:255',
            'content' => 'nullable|string',
            'only_missing' => 'sometimes|boolean',
        ];
        if ($legacy) {
            $rules['source_hash'] = 'required|string|regex:/^[a-f0-9]{64}$/';
        } else {
            $rules += [
                'fields' => 'required|array|min:1|max:2',
                'fields.*' => ['required', 'distinct', Rule::in(PlanTranslationState::FIELDS)],
                'source_hashes' => 'required|array',
                'source_hashes.*' => 'required|string|regex:/^[a-f0-9]{64}$/',
                'translation_version' => 'required|string|regex:/^[a-f0-9]{64}$/',
                'origins' => 'sometimes|array',
                'origins.*' => ['required', Rule::in(['manual', 'machine'])],
            ];
        }
        $params = $request->validate($rules);
        if (!$legacy) foreach ($params['fields'] as $field) {
            if (!array_key_exists($field, $params['source_hashes']) || !array_key_exists($field, $params)) {
                throw ValidationException::withMessages([$field => '请提交该字段及对应原文版本']);
            }
        }
        $saved = DB::transaction(function () use ($params, $legacy) {
            // Every translation writer locks the same parent, including creation of a previously absent row.
            $plan = Plan::where('id', $params['plan_id'])->lockForUpdate()->firstOrFail();
            $translation = PlanTranslation::where('plan_id', $plan->id)->where('locale', $params['locale'])->lockForUpdate()->first();
            $hashes = PlanTranslationState::hashes($plan);
            if ($legacy) {
                if (!hash_equals($hashes['content'], $params['source_hash'])) abort(409, '套餐原文已变更，请重新生成译文');
                if ($translation && trim((string) $translation->content) !== '') return false;
                $fields = ['content'];
            } else {
                $fields = $params['fields'];
                foreach ($fields as $field) {
                    if (!hash_equals($hashes[$field], $params['source_hashes'][$field])) abort(409, '套餐原文已变更，请重新加载并核对译文');
                }
                if (!hash_equals(PlanTranslationState::version($translation), $params['translation_version'])) abort(409, '此语言译文已被修改，请重新加载后合并');
            }
            $translation = $translation ?? new PlanTranslation(['plan_id' => $plan->id, 'locale' => $params['locale']]);
            foreach ($fields as $field) {
                $value = $params[$field] ?? null;
                $present = is_string($value) && trim($value) !== '';
                $translation->$field = $present ? $value : null;
                $translation->setAttribute($field.'_source_hash', $present ? $hashes[$field] : null);
                $translation->setAttribute($field.'_origin', $present ? ($legacy ? 'machine' : ($params['origins'][$field] ?? 'manual')) : null);
            }
            if (trim((string) $translation->name) === '' && trim((string) $translation->content) === '') {
                if ($translation->exists) $translation->delete();
            } else {
                $translation->save();
            }
            return true;
        });
        return response(['data' => $saved]);
    }
}
