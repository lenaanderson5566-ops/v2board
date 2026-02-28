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

        $translations = PlanTranslation::whereIn('plan_id', $planIds)
            ->where('locale', $locale)
            ->get()
            ->keyBy('plan_id');

        foreach ($plans as $plan) {
            if (!isset($translations[$plan->id])) {
                continue;
            }
            $translation = $translations[$plan->id];
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

        $translation = PlanTranslation::where('plan_id', $plan->id)
            ->where('locale', $locale)
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
}
