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

        // The base language has one source of truth. Historical same-language
        // copies must never hide an administrator's latest source edit.
        if ($candidates[0] === PlanTranslationState::SOURCE_LANGUAGE) {
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
            if ($translation->locale === PlanTranslationState::SOURCE_LANGUAGE) continue;
            $translationMap[$translation->plan_id][$translation->locale] = $translation->toArray();
        }

        foreach ($plans as $plan) {
            $source = ['name' => (string) $plan->name, 'content' => (string) $plan->content];
            $hashes = PlanTranslationState::hashes($plan);
            $variants = $translationMap[$plan->id] ?? [];
            foreach ($variants as &$variant) {
                foreach (['name', 'content'] as $field) {
                    $fingerprint = $variant[$field . '_source_hash'] ?? null;
                    // Legacy values remain compatible until an administrator
                    // changes their source; reads never backfill or save them.
                    if ($fingerprint !== null && $fingerprint !== ''
                        && !hash_equals($hashes[$field], (string) $fingerprint)) {
                        unset($variant[$field]);
                    }
                }
            }
            unset($variant);
            // SQL whereIn does not preserve locale preference order.
            // Resolve each field explicitly: exact locale first, then fallback.
            foreach (['name', 'content'] as $field) {
                $plan->$field = ContentTranslation::field(
                    $variants, $field, $source[$field], $locale, PlanTranslationState::SOURCE_LANGUAGE
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
