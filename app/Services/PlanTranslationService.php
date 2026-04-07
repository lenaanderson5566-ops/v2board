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

        $planIds = [];
        foreach ($plans as $plan) {
            $planIds[] = $plan->id;
        }

        $translations = PlanTranslation::whereIn('plan_id', $planIds)->get();

        $translationMap = [];
        foreach ($translations as $translation) {
            $planId = $translation->plan_id;
            $priority = $this->resolveLocalePriority($translation->locale, $locale);
            if ($priority === null) {
                continue;
            }
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

        $translations = PlanTranslation::where('plan_id', $plan->id)->get();
        $translation = null;
        $bestPriority = null;
        foreach ($translations as $item) {
            $priority = $this->resolveLocalePriority($item->locale, $locale);
            if ($priority === null) {
                continue;
            }
            if ($translation === null || $priority < $bestPriority) {
                $translation = $item;
                $bestPriority = $priority;
            }
        }

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

    private function resolveLocalePriority(?string $translationLocale, ?string $requestedLocale): ?int
    {
        $translation = $this->normalizeLocale($translationLocale);
        if ($translation === '') {
            return null;
        }
        $requested = $this->normalizeLocale($requestedLocale);

        if ($requested !== '') {
            if (strcasecmp($translation, $requested) === 0) {
                return 0;
            }

            $requestedLang = explode('-', $requested)[0];
            if (strcasecmp($translation, $requestedLang) === 0) {
                return 1;
            }
            if (stripos($translation, $requestedLang . '-') === 0) {
                return 2;
            }
        }

        // English fallback
        if (strcasecmp($translation, 'en-US') === 0) {
            return 100;
        }
        if (strcasecmp($translation, 'en') === 0) {
            return 101;
        }
        if (stripos($translation, 'en-') === 0) {
            return 102;
        }

        return null;
    }

    private function normalizeLocale(?string $locale): string
    {
        $raw = str_replace('_', '-', trim((string) $locale));
        if ($raw === '') {
            return '';
        }

        $parts = explode('-', $raw);
        $language = strtolower(array_shift($parts));
        if (count($parts) === 0) {
            return $language;
        }

        $regions = array_map(function ($part) {
            return strtoupper($part);
        }, $parts);

        return $language . '-' . implode('-', $regions);
    }
}
