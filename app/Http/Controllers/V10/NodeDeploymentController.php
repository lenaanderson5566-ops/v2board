<?php
namespace App\Http\Controllers\V10;

use App\Http\Controllers\Controller;
use App\Services\NodeDeployment;
use App\Services\NodeDeploymentTask;
use App\Services\NodeDeploymentWorkflow;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;

final class NodeDeploymentController extends Controller
{
    public function bootstrap() {
        $script=str_replace(['__NODE_PREREQUISITES__','__NODE_DEPLOY_HELPER__'],[file_get_contents(resource_path('scripts/node-prerequisites.sh')),file_get_contents(resource_path('scripts/node-deploy.py'))],file_get_contents(resource_path('scripts/node-deploy.sh')));
        return response(str_replace("\r\n","\n",$script),200,
            ['Content-Type'=>'text/x-shellscript; charset=utf-8','Cache-Control'=>'no-store','X-Content-Type-Options'=>'nosniff']);
    }
    public function redeem(Request $request) {
        abort_unless($request->isJson(),415);
        abort_unless($request->json()->all()===[],422,'Deployment request body must be empty');
        $runtimeReady=in_array('runtime-ready-v1',explode(',',$request->header('X-Deployment-Capabilities','')),true);
        return response()->json(['data'=>NodeDeployment::redeem((string)$request->bearerToken(),$runtimeReady)])
            ->header('Cache-Control','private, no-store');
    }
    public function progress(Request $request) {
        abort_unless($request->isJson(),415);
        abort_if(array_diff(array_keys($request->json()->all()),['action','dnsState','dnsRole']),422);
        $v=$request->validate(['action'=>'required|in:status,start,complete','dnsState'=>'sometimes|required|in:checking,verified,mismatch,unavailable','dnsRole'=>'required_with:dnsState|in:origin,entry,certificate']);
        $token = (string)$request->bearerToken();
        try {
            $result = NodeDeploymentWorkflow::progress($token, $v['action'], isset($v['dnsState']) ? ['state'=>$v['dnsState'], 'role'=>$v['dnsRole']] : null);
        } catch (HttpException $e) {
            NodeDeploymentTask::checkRejection($token, $e->getStatusCode());
            throw $e;
        }
        NodeDeploymentTask::observed($token, $result);
        return response()->json(['data'=>$result])->header('Cache-Control','private, no-store');
    }
}
