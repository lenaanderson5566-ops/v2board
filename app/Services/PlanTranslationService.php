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

        $candidates = ContentTranslation::candidates($locale);
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
            $translationMap[$translation->plan_id][$translation->locale] = $translation->toArray();
        }

        foreach ($plans as $plan) {
            // SQL whereIn does not preserve locale preference order.
            // Resolve each field explicitly: exact locale first, then fallback.
            foreach (['name', 'content'] as $field) {
                $plan->$field = ContentTranslation::field(
                    $translationMap[$plan->id] ?? [], $field, (string)$plan->$field, $locale, 'zh-CN'
                );
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

}
