<?php

namespace App\Http\Routes\V1;

use Illuminate\Contracts\Routing\Registrar;

class RiskRoute
{
    public function map(Registrar $router)
    {
        $router->group([
            'prefix' => config('v2board.risk_control_api_path', 'risk-control'),
            'middleware' => ['admin', 'log'],
        ], function ($router) {
            $router->get('/overview', 'V1\\Risk\\LogController@getOverview');
            $router->get('/rule/fetch', 'V1\\Risk\\LogController@getRules');
            $router->post('/rule/update', 'V1\\Risk\\LogController@updateRule');
            $router->get('/rule-hit/fetch', 'V1\\Risk\\LogController@getRuleHits');
            $router->get('/login-log/fetch', 'V1\\Risk\\LogController@getLoginLogs');
            $router->get('/subscribe-log/fetch', 'V1\\Risk\\LogController@getSubscribeLogs');
        });
    }
}
