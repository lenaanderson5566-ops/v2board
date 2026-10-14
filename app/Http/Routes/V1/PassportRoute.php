<?php
namespace App\Http\Routes\V1;

use Illuminate\Contracts\Routing\Registrar;

class PassportRoute
{
    public function map(Registrar $router)
    {
        $router->group([
            'prefix' => 'passport'
        ], function ($router) {
            // Auth
            $router->post('/auth/register', 'V1\\Passport\\AuthController@register');
            $router->post('/auth/login', 'V1\\Passport\\AuthController@login')->middleware('throttle:30,1');
            $router->post('/auth/forget', 'V1\\Passport\\AuthController@forget');
            $router->post('/mfa/emails', 'V1\\Admin\\MfaController@sendEmail')->middleware('throttle:10,1');
            $router->post('/mfa/verifications', 'V1\\Admin\\MfaController@finish')->middleware('throttle:30,1');
            // Comm
            $router->post('/comm/sendEmailVerify', 'V1\\Passport\\CommController@sendEmailVerify');
        });
    }
}
