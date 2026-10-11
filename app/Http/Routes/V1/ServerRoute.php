<?php
namespace App\Http\Routes\V1;

use Illuminate\Contracts\Routing\Registrar;

class ServerRoute
{
    public function map(Registrar $router)
    {
        $router->get('server/UniProxy/user', 'V1\Server\UniProxyController@user');
        $router->get('server/UniProxy/alivelist', 'V1\Server\UniProxyController@alivelist');
        $router->post('server/UniProxy/push', 'V1\Server\UniProxyController@push');
        $router->post('server/UniProxy/alive', 'V1\Server\UniProxyController@alive');
    }
}
