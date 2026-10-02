<?php

namespace App\Services;

use App\Models\PlanTranslation;

class PlanTranslationService
{
    public function translateCollection($plans, $locale)
    {
        if (!$locale || count($plans) === 0) {
            return $plans;
        }

        $candidates = $this->buildLocaleCandidates($locale);
        if (!$candidates) {
            return $plans;
        }

        $planIds = [];
        foreach ($plans as $plan) {
            $planIds[] = $plan->id;
        }

        $translations = PlanTranslation::whereIn('plan_id', $planIds)
            ->whereIn('locale', $candidates)
            ->get();

        $translationMap = [];
        foreach ($translations as $translation) {
            $translationMap[$translation->plan_id][$translation->locale] = $translation;
        }

        foreach ($plans as $plan) {
            // SQL whereIn does not preserve locale preference order.
            // Resolve each field explicitly: exact locale first, then fallback.
            foreach (['name', 'content'] as $field) {
                foreach ($candidates as $candidate) {
                    $translation = $translationMap[$plan->id][$candidate] ?? null;
                    if ($translation && trim((string) $translation->$field) !== '') {
                        $plan->$field = $translation->$field;
                        break;
                    }
                }
            }
        }

        return $plans;
    }

    public function translateSingle($plan, $locale)
    {
        if (!$plan || !$locale) {
            return $plan;
        }

        $this->translateCollection([$plan], $locale);
        return $plan;
    }

    private function buildLocaleCandidates($locale)
    {
        $locale = trim((string) $locale);
        if ($locale === '') {
            return [];
        }

        $available = $this->getAvailableLocales();
        if (!$available) {
            return [$locale];
        }

        $normalized = str_replace('_', '-', $locale);
        $aliases = ['zh-hant'=>'zh-TW', 'zh-hant-tw'=>'zh-TW', 'zh-hk'=>'zh-TW', 'zh-hant-hk'=>'zh-TW', 'zh-hans'=>'zh-CN', 'zh-hans-cn'=>'zh-CN'];
        $normalized = $aliases[strtolower($normalized)] ?? $normalized;
        $langOnly = explode('-', $normalized)[0];

        $candidates = [];

        $add = function ($item) use (&$candidates, $available) {
            if (!$item) return;
            foreach ($available as $v) {
                if (strtolower($v) === strtolower($item) && !in_array($v, $candidates, true)) {
                    $candidates[] = $v;
                }
            }
        };

        $add($locale);
        $add($normalized);
        $add($langOnly);

        foreach ($available as $v) {
            if (stripos($v, $langOnly . '-') === 0 && !in_array($v, $candidates, true)) {
                $candidates[] = $v;
            }
        }

        return $candidates;
    }

    private function getAvailableLocales()
    {
        $files = glob(resource_path('lang') . '/*.json');
        $locales = [];
        foreach ($files as $file) {
            $locales[] = basename($file, '.json');
        }
        return $locales;
    }
}
