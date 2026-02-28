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
            $planId = $translation->plan_id;
            if (isset($translationMap[$planId])) {
                continue;
            }
            $translationMap[$planId] = $translation;
        }

        foreach ($plans as $plan) {
            if (!isset($translationMap[$plan->id])) {
                continue;
            }
            $translation = $translationMap[$plan->id];
            if ($translation->name) {
                $plan->name = $translation->name;
            }
            if ($translation->content) {
                $plan->content = $translation->content;
            }
        }

        return $plans;
    }

    public function translateSingle($plan, $locale)
    {
        if (!$plan || !$locale) {
            return $plan;
        }

        $candidates = $this->buildLocaleCandidates($locale);
        if (!$candidates) {
            return $plan;
        }

        $translation = PlanTranslation::where('plan_id', $plan->id)
            ->whereIn('locale', $candidates)
            ->first();

        if (!$translation) {
            return $plan;
        }

        if ($translation->name) {
            $plan->name = $translation->name;
        }
        if ($translation->content) {
            $plan->content = $translation->content;
        }

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
