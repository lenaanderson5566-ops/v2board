<?php
namespace App\Http\Routes\V1;
use Illuminate\Contracts\Routing\Registrar;
class UserRoute
{
    public function map(Registrar $router)
    {
        // Shared authentication/profile dependencies of the unchanged admin UI.
        $router->group(['prefix'=>'user', 'middleware'=>'user'], function ($router) {
            $router->get('/info', 'V1\\User\\UserController@info');
            $router->post('/update', 'V1\\User\\UserController@update');
            $router->post('/logout', 'V1\\User\\UserController@logout');
        });
    }
}
