<?php
namespace App\Http\Controllers\V10;

use App\Services\AuthService;
use App\Http\Resources\V10\Resource;
use Illuminate\Http\Request;
use Illuminate\Foundation\Http\FormRequest;

abstract class ResourceController extends \App\Http\Controllers\Controller
{
    protected function prepare(Request $request, string $endpoint): void
    {
        $contract = Resource::contracts()['endpoints'][$endpoint];
        $request->attributes->set('v10.contract', $contract);
        $user = null;
        if ($contract['role'] === 'user') {
            $credential = $request->bearerToken();
            $user = AuthService::decryptAuthData($credential);
            if (!$user) abort(401, __('Unauthenticated.'));
            if ($user['banned']) abort(403, __('Account is disabled.'));
            $request->attributes->set('v10.userId', $user['id']);
            // Shared business actions receive the already verified session credential.
            $request->headers->set('Authorization', $credential);
        }
        if ($contract['raw'] && $contract['role'] === 'public') return;
        // Browser mutations and session exchanges accept body fields only.
        if (!$request->isMethod('GET') && !$request->isMethod('HEAD')) $request->query->replace([]);
        \App\Http\Requests\V10\Input::validate($request,$contract);
        $input = [];
        foreach ($contract['input'] as $external => $internal) {
            if ($request->exists($external)) $input[$internal] = $request->input($external);
        }
        foreach (['isforget','auto_renewal','remind_expire','remind_traffic'] as $flag) if (isset($input[$flag])) $input[$flag]=(int)(bool)$input[$flag];
        $request->validate(['page' => 'nullable|integer|min:1', 'pageSize' => 'nullable|integer|min:1|max:100']);
        if (array_key_exists('page', $contract['input'])) $input['current'] = $input['current'] ?? 1;
        if (array_key_exists('pageSize', $contract['input'])) $input[$contract['input']['pageSize']] = $input[$contract['input']['pageSize']] ?? 20;
        if (!isset($input['language']) && str_contains($contract['key'],'KnowledgeController')) $input['language'] = app()->getLocale();
        // Clients without a language header retain the account's saved preference.
        if (!isset($input['language']) && $contract['role'] === 'subscription' && $request->attributes->get('v10.negotiatedLanguage')) $input['language'] = $request->attributes->get('v10.negotiatedLanguage');
        $request->attributes->set('notice_locale',app()->getLocale());
        foreach ($contract['bindings'] as $parameter => $internal) $input[$internal] = $request->route($parameter);
        if ($user && isset($input['trade_no'])) {
            if (!\App\Models\Order::where('trade_no',$input['trade_no'])->where('user_id',$user['id'])->exists()) abort(404,__('Order not found.'));
        }
        if ($user && str_contains($contract['key'],'TicketController') && isset($input['id'])) {
            if (!\App\Models\Ticket::where('id',$input['id'])->where('user_id',$user['id'])->exists()) abort(404,__('Ticket not found.'));
        }
        if (isset($input['period'])) {
            $period = array_search($input['period'], Resource::PERIODS, true);
            if ($period === false) abort(422, __('Invalid billing period.'));
            $input['period'] = $period;
        }
        if (isset($input['status']) && str_contains($contract['key'], 'OrderController')) {
            $status = array_search($input['status'], Resource::ORDER_STATUSES, true);
            if ($status === false) abort(422, __('Invalid order status.'));
            $input['status'] = $status;
        }
        if (isset($input['level'])) {
            $priority = array_search($input['level'], ['normal', 'high', 'urgent'], true);
            if ($priority === false) abort(422, __('Invalid priority.'));
            $input['level'] = $priority;
        }
        if ($contract['role'] === 'subscription') {
            $input['token'] = $request->route('subscriptionToken');
            if (isset($input['flag'])) {
                $formats = ['clash'=>'clash', 'clash-meta'=>'meta', 'clash-verge'=>'verge', 'flclash'=>'flclash', 'sing-box'=>'sing', 'shadowrocket'=>'shadowrocket', 'surge'=>'surge', 'quantumult-x'=>'quantumult x', 'stash'=>'stash', 'general'=>'general'];
                if (!isset($formats[$input['flag']])) abort(422, __('Unsupported subscription format.'));
                $input['flag'] = $formats[$input['flag']];
            }
        }
        // Replace both input sources so query credentials and user IDs cannot override server context.
        $request->query->replace([]);
        $request->replace($input);
        if ($user) $request->merge(['user' => $user]);
        if ($contract['role'] === 'subscription') {
            app(\App\Http\Middleware\Client::class)->handle($request, fn() => null);
        }
    }

    protected function businessRequest(Request $request, string $class): Request
    {
        if ($class === Request::class) return $request;
        $form = $class::createFrom($request);
        $form->setContainer(app())->setRedirector(app('redirect'));
        $form->validateResolved();
        return $form;
    }

    protected function respond(Request $request, $result, string $endpoint)
    {
        $contract = Resource::contracts()['endpoints'][$endpoint];
        if ($contract['raw']) return $result ?? response('', 204);
        $response = $result instanceof \Symfony\Component\HttpFoundation\Response ? $result : response($result);
        if ($response->getStatusCode() >= 400 || $response->getStatusCode() === 304) return $response;
        $payload = json_decode($response->getContent(), true);
        if ($contract['status'] === 204) return response('',204);
        $data = $payload['data'] ?? null;
        if ($contract['output'] === 'account') $data['id']=$request->user['id'];
        if ($contract['output'] === 'inbox') $payload['total'] = $data['total'] ?? 0;
        if (isset($contract['input']['pageSize']) && is_array($data) && array_is_list($data) && !isset($payload['total'])) {
            $payload['total']=count($data);
            $data=array_slice($data,((int)$request->input('current',1)-1)*(int)$request->input('page_size',20),(int)$request->input('page_size',20));
        }
        $resource = Resource::encode($contract['output'], $data, $payload ?? []);
        $body = ['data' => $resource];
        if ($contract['status'] === 202 && isset($resource['id'])) $body['meta']['taskId']='invitation-email:'.$resource['id'];
        if (isset($payload['total'])) {
            $size = (int)$request->input('page_size', $request->input('pageSize', 20));
            $page = (int)$request->input('current', 1);
            $body['meta']['pagination'] = ['page'=>$page, 'pageSize'=>$size, 'total'=>(int)$payload['total'], 'totalPages'=>(int)ceil($payload['total'] / max(1,$size))];
        }
        $response->setContent(json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $response->setStatusCode($contract['status']);
        $response->headers->set('Content-Type', 'application/json');
        return $response;
    }
}
