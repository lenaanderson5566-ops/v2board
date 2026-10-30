<?php

namespace App\Services;

use App\Models\Plan;
use App\Models\PlanTranslation;

/** Source fingerprints describe translation freshness; they never translate or change content. */
final class PlanTranslationState
{
    public const SOURCE_LANGUAGE = 'zh-CN';
    public const FIELDS = ['name', 'content'];

    public static function hashes(Plan $plan): array
    {
        return [
            'name' => hash('sha256', (string) $plan->name),
            'content' => hash('sha256', (string) $plan->content),
        ];
    }

    public static function version(?PlanTranslation $translation): string
    {
        if (!$translation) return hash('sha256', 'missing-plan-translation');
        // Include the identity, values and provenance, rather than second-resolution timestamps alone.
        $values = ['id' => $translation->id];
        foreach (self::FIELDS as $field) {
            $values[$field] = $translation->$field;
            $values[$field.'_source_hash'] = $translation->getAttribute($field.'_source_hash');
            $values[$field.'_origin'] = $translation->getAttribute($field.'_origin');
        }
        return hash('sha256', json_encode($values, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    public static function fields(Plan $plan, ?PlanTranslation $translation): array
    {
        $hashes = self::hashes($plan);
        $result = [];
        foreach (self::FIELDS as $field) {
            $value = $translation ? (string) $translation->$field : '';
            $storedHash = $translation ? $translation->getAttribute($field.'_source_hash') : null;
            $origin = $translation ? $translation->getAttribute($field.'_origin') : null;
            $origin = in_array($origin, ['manual', 'machine'], true) ? $origin : 'unknown';
            if (trim($value) === '') {
                $status = $field === 'name' ? 'inherited' : 'missing';
                if ($field === 'name') $origin = 'inherited';
            } elseif (is_string($storedHash) && preg_match('/^[a-f0-9]{64}$/', $storedHash)) {
                $status = !hash_equals($hashes[$field], $storedHash) ? 'outdated' : ($origin === 'unknown' ? 'unverified' : 'current');
            } else {
                $status = 'unverified';
            }
            $result[$field] = ['status' => $status, 'origin' => $origin];
        }
        return $result;
    }

    public static function resource(Plan $plan, ?PlanTranslation $translation): array
    {
        return [
            'name' => $translation ? $translation->name : null,
            'content' => $translation ? $translation->content : null,
            'version' => self::version($translation),
            'fields' => self::fields($plan, $translation),
        ];
    }
}
