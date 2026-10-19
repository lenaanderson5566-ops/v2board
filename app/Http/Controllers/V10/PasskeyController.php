<?php
namespace App\Http\Controllers\V10;

use App\Models\User;
use App\Services\PasskeyService;
use App\Http\Resources\V10\Resource;
use Illuminate\Http\Request;

final class PasskeyController extends ResourceController
{
    private function input(Request $request,string $endpoint,array $fields): void {
        abort_if(strlen($request->getContent())>200000,413,'Passkey response is too large.');
        $keys=array_keys($request->all());
        $this->prepare($request,$endpoint);
        abort_if(array_diff($keys,$fields),422,'Unsupported Passkey field.');
        if (!$request->isMethod('GET') && !$request->isMethod('HEAD')) abort_unless($request->isJson(),415,'JSON is required.');
    }
    public function state(Request $request,PasskeyService $service) {
        $this->input($request,'getMePasskeys',[]);
        return response()->json(['data'=>$service->state(User::findOrFail($request->user['id']))])->header('Cache-Control','private, no-store');
    }
    public function options(Request $request,PasskeyService $service) {
        $this->input($request,'postMePasskeyRegistrationOptions',['password','name']);
        return response()->json(['data'=>$service->registrationOptions(User::findOrFail($request->user['id']),$request)],201)->header('Cache-Control','private, no-store');
    }
    public function store(Request $request,PasskeyService $service) {
        $this->input($request,'postMePasskeys',['challengeId','clientDataJSON','credentialId','attestationObject']);
        $request->validate(['clientDataJSON'=>'required|string|max:16384','credentialId'=>'required|string|max:1400','attestationObject'=>'required|string|max:131072']);
        return response()->json(['data'=>$service->register(User::findOrFail($request->user['id']),$request)],201)->header('Cache-Control','private, no-store');
    }
    public function remove(Request $request,PasskeyService $service) {
        $this->input($request,'deleteMePasskey',['password']);
        $service->remove(User::findOrFail($request->user['id']),$request,(int)$request->input('passkeyId'));
        return response('',204)->header('Cache-Control','private, no-store');
    }
    public function loginOptions(Request $request,PasskeyService $service) {
        $this->input($request,'postAuthPasskeyOptions',[]);
        return response()->json(['data'=>$service->loginOptions($request)],201)->header('Cache-Control','private, no-store');
    }
    public function login(Request $request,PasskeyService $service) {
        $this->input($request,'postAuthPasskeySessions',['challengeId','clientDataJSON','credentialId','authenticatorData','signature','userHandle']);
        $request->validate(['clientDataJSON'=>'required|string|max:16384','credentialId'=>'required|string|max:1400','authenticatorData'=>'required|string|max:8192','signature'=>'required|string|max:4096','userHandle'=>'required|string|max:128']);
        return response()->json(['data'=>Resource::encode('authentication',$service->login($request))])->header('Cache-Control','private, no-store');
    }
}
