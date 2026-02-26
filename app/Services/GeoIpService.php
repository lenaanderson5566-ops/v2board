<?php

namespace App\Services;

use GeoIp2\Database\Reader;

class GeoIpService
{
    private static $readers = [];

    public function lookup(?string $ip): array
    {
        if (!$ip || !filter_var($ip, FILTER_VALIDATE_IP) || $this->isPrivateIp($ip)) {
            return $this->emptyResult();
        }

        $result = $this->emptyResult();

        $countryReader = $this->getReader('country');
        if ($countryReader) {
            try {
                $record = $countryReader->country($ip);
                $result['country'] = $record->country->names['zh-CN'] ?? $record->country->name;
            } catch (\Throwable $e) {
            }
        }

        $cityReader = $this->getReader('city');
        if ($cityReader) {
            try {
                $record = $cityReader->city($ip);
                $result['region'] = $record->mostSpecificSubdivision->names['zh-CN'] ?? $record->mostSpecificSubdivision->name;
                $result['city'] = $record->city->names['zh-CN'] ?? $record->city->name;
                if (!$result['country']) {
                    $result['country'] = $record->country->names['zh-CN'] ?? $record->country->name;
                }
            } catch (\Throwable $e) {
            }
        }

        $asnReader = $this->getReader('asn');
        if ($asnReader) {
            try {
                $record = $asnReader->asn($ip);
                $result['asn'] = $record->autonomousSystemNumber ? 'AS' . $record->autonomousSystemNumber : null;
                $result['isp'] = $record->autonomousSystemOrganization;
            } catch (\Throwable $e) {
            }
        }

        return $result;
    }

    private function getReader(string $type): ?Reader
    {
        if (array_key_exists($type, self::$readers)) {
            return self::$readers[$type];
        }

        $map = [
            'country' => config('v2board.geoip_country_path', storage_path('geoip/GeoLite2-Country.mmdb')),
            'city' => config('v2board.geoip_city_path', storage_path('geoip/GeoLite2-City.mmdb')),
            'asn' => config('v2board.geoip_asn_path', storage_path('geoip/GeoLite2-ASN.mmdb')),
        ];

        $path = $map[$type] ?? null;
        if (!$path || !is_file($path)) {
            self::$readers[$type] = null;
            return null;
        }

        self::$readers[$type] = new Reader($path);
        return self::$readers[$type];
    }

    private function emptyResult(): array
    {
        return [
            'country' => null,
            'region' => null,
            'city' => null,
            'asn' => null,
            'isp' => null,
        ];
    }

    private function isPrivateIp(string $ip): bool
    {
        return !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
    }
}
