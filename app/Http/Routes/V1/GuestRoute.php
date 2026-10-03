<?php
namespace App\Http\Routes\V1;

use Illuminate\Contracts\Routing\Registrar;

class GuestRoute
{
    public function map(Registrar $router)
    {
        $router->group([
            'prefix' => 'guest'
        ], function ($router) {
            // Telegram
            $router->post('/telegram/webhook', 'V1\\Guest\\TelegramController@webhook');
            // Payment
            $router->match(['get', 'post'], '/payment/notify/{method}/{uuid}', 'V1\\Guest\\PaymentController@notify');
            $router->get('/banner/fetch', 'V1\\Guest\\BannerController@fetch');
            $router->get('/banner/image/{name}', 'V1\\Guest\\BannerController@image')->where('name', '[a-f0-9]{40}\\.(png|jpe?g|webp)');
            // Comm
            $router->get ('/comm/config', 'V1\\Guest\\CommController@config');
        });
    }
}
