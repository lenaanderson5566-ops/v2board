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
        $priorityMap = array_flip(array_values($candidates));
        foreach ($translations as $translation) {
            $planId = $translation->plan_id;
            $priority = $priorityMap[$translation->locale] ?? PHP_INT_MAX;
            if (!isset($translationMap[$planId]) || $priority < $translationMap[$planId]['priority']) {
                $translationMap[$planId] = [
                    'priority' => $priority,
                    'translation' => $translation
                ];
            }
        }

        foreach ($plans as $plan) {
            if (!isset($translationMap[$plan->id])) {
                continue;
            }
            $translation = $translationMap[$plan->id]['translation'];
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
            ->get()
            ->sortBy(function ($item) use ($candidates) {
                $index = array_search($item->locale, $candidates, true);
                return $index === false ? PHP_INT_MAX : $index;
            })
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
            return array_values(array_unique([$locale, 'en-US', 'en']));
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

        $add('en-US');
        $add('en');
        foreach ($available as $v) {
            if (stripos($v, 'en-') === 0 && !in_array($v, $candidates, true)) {
                $candidates[] = $v;
            }
        }

        return $candidates;
    }

    private function getAvailableLocales()
    {
        $dbLocales = PlanTranslation::query()->distinct()->pluck('locale')->toArray();
        $files = glob(resource_path('lang') . '/*.json');
        $fileLocales = [];
        foreach ($files as $file) {
            $fileLocales[] = basename($file, '.json');
        }
        return array_values(array_unique(array_merge($dbLocales, $fileLocales)));
    }
}
