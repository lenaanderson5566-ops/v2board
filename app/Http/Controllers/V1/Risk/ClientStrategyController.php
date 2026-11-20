<?php

namespace App\Http\Controllers\V1\Risk;

use App\Http\Controllers\Controller;
use App\Services\ClientStrategyService;
use App\Services\RiskStatisticsService;
use Illuminate\Http\Request;

class ClientStrategyController extends Controller
{
    public function getClientStrategies(Request $request)
    {
        $strategies = (new ClientStrategyService())->getStrategies();

        return response([
            'data' => app(RiskStatisticsService::class)->clientSubscriptionStats($strategies)
        ]);
    }

    public function updateClientStrategy(Request $request)
    {
        $rawItems = $request->input('items');
        if (is_null($rawItems)) {
            $rawItems = [$request->all()];
        }

        if (!is_array($rawItems)) {
            abort(422, 'items must be an array');
        }

        $items = [];
        foreach ($rawItems as $item) {
            if (!is_array($item)) {
                abort(422, 'each item must be an object');
            }
            if (empty($item['client_type']) || !is_string($item['client_type'])) {
                abort(422, 'client_type is required');
            }
            if (array_key_exists('sort', $item) && filter_var($item['sort'], FILTER_VALIDATE_INT) === false) {
                abort(422, 'sort must be integer');
            }
            if (array_key_exists('is_enabled', $item)) {
                $enabled = filter_var($item['is_enabled'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                if (is_null($enabled)) {
                    abort(422, 'is_enabled must be boolean');
                }
                $item['is_enabled'] = $enabled;
            }
            if (array_key_exists('client_name', $item) && !is_null($item['client_name']) && !is_string($item['client_name'])) {
                abort(422, 'client_name must be string');
            }
            if (array_key_exists('min_version', $item) && !is_null($item['min_version']) && !is_string($item['min_version'])) {
                abort(422, 'min_version must be string');
            }
            $item['client_type'] = strtolower($item['client_type']);
            $items[] = $item;
        }

        $strategies = (new ClientStrategyService())->updateStrategies($items);

        return response([
            'data' => app(RiskStatisticsService::class)->clientSubscriptionStats($strategies)
        ]);
    }
}
