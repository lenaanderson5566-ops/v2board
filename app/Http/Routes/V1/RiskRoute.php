<?php

namespace App\Http\Routes\V1;

use Illuminate\Contracts\Routing\Registrar;

class RiskRoute
{
    public function map(Registrar $router)
    {
        $router->group([
            'prefix' => config('v2board.ops_api_path', 'ops'),
            'middleware' => ['admin', 'log'],
        ], function ($router) {
            $router->get('/risk/overview/fetch', 'V1\Risk\LogController@getOverview');
            $router->get('/risk/settings/fetch', 'V1\Risk\LogController@getRiskSettings');
            $router->post('/risk/settings/update', 'V1\Risk\LogController@updateRiskSettings');
            $router->get('/risk/rule/fetch', 'V1\Risk\LogController@getRules');
            $router->post('/risk/rule/update', 'V1\Risk\LogController@updateRule');
            $router->post('/risk/rule/reset', 'V1\Risk\LogController@resetRule');
            $router->get('/risk/blacklist/fetch', 'V1\Risk\LogController@getBlacklists');
            $router->post('/risk/blacklist/update', 'V1\Risk\LogController@updateBlacklist');
            $router->post('/risk/blacklist/delete', 'V1\Risk\LogController@deleteBlacklist');
            $router->get('/risk/blacklist/ip/fetch', 'V1\Risk\LogController@getIpBlacklists');
            $router->post('/risk/blacklist/ip/update', 'V1\Risk\LogController@updateIpBlacklist');
            $router->post('/risk/blacklist/ip/delete', 'V1\Risk\LogController@deleteIpBlacklist');
            $router->get('/risk/blacklist/ua/fetch', 'V1\Risk\LogController@getUaBlacklists');
            $router->post('/risk/blacklist/ua/update', 'V1\Risk\LogController@updateUaBlacklist');
            $router->post('/risk/blacklist/ua/delete', 'V1\Risk\LogController@deleteUaBlacklist');
            $router->get('/risk/online-user/fetch', 'V1\Risk\LogController@getOnlineUsers');
            $router->get('/risk/user-usage/fetch', 'V1\Risk\LogController@getUserUsage');

            $router->get('/client/strategy/fetch', 'V1\Risk\LogController@getClientStrategies');
            $router->post('/client/strategy/update', 'V1\Risk\LogController@updateClientStrategy');
            $router->post('/client/strategy/delete', 'V1\Risk\LogController@deleteClientStrategy');

            $router->get('/log/rule-hit/fetch', 'V1\Risk\LogController@getRuleHits');
            $router->get('/log/user-connection/fetch', 'V1\Risk\LogController@getUserConnectionLogs');
            $router->get('/log/login/fetch', 'V1\Risk\LogController@getLoginLogs');
            $router->get('/log/subscribe/fetch', 'V1\Risk\LogController@getSubscribeLogs');
        });
    }
}
