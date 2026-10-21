<?php
namespace App\Http\Controllers\V10;

use App\Http\Controllers\Controller;
use App\Services\NodeDeployment;
use Illuminate\Http\Request;

final class NodeDeploymentController extends Controller
{
    public function bootstrap() {
        $script=str_replace('__NODE_PREREQUISITES__',file_get_contents(resource_path('scripts/node-prerequisites.sh')),file_get_contents(resource_path('scripts/node-deploy.sh')));
        return response(str_replace("\r\n","\n",$script),200,
            ['Content-Type'=>'text/x-shellscript; charset=utf-8','Cache-Control'=>'no-store','X-Content-Type-Options'=>'nosniff']);
    }
    public function redeem(Request $request) {
        abort_unless($request->isJson(),415);
        abort_unless($request->json()->all()===[],422,'Deployment request body must be empty');
        return response()->json(['data'=>NodeDeployment::redeem((string)$request->bearerToken())])
            ->header('Cache-Control','private, no-store');
    }
}
