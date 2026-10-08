<?php
namespace App\Http\Requests\V10;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

final class Input
{
    // Public validation is independent of the legacy FormRequests used by shared actions.
    public static function validate(Request $request, array $contract): void
    {
        $types = [
            'legacyToken'=>'string|max:8192',
            'codeChallenge'=>'string|regex:/^[A-Za-z0-9_-]{43}$/',
            'state'=>'string|regex:/^[A-Za-z0-9_-]{43}$/',
            'redirectUri'=>'string|max:255',
            'authorizationCode'=>'string|regex:/^[a-f0-9]{64}$/',
            'codeVerifier'=>'string|regex:/^[A-Za-z0-9._~-]{43,128}$/',
            'clientVersion'=>'string|regex:/^\\d+(?:\\.\\d+){1,3}$/',
            'architecture'=>'in:x64,arm64,arm,x86',
            'platform'=>'in:windows,android,macos,linux,ios',
            'email'=>'string|email:strict|max:254', 'password'=>'string|min:8|max:128',
            'oldPassword'=>'string|max:128','newPassword'=>'string|min:8|max:128',
            'emailCode'=>'string|digits:6', 'invitation'=>'string|regex:/^[a-f0-9]{64}$/',
            'captchaToken'=>'string|max:8192','verificationToken'=>'string|max:128',
            'planId'=>'integer|min:0','replacementOrderNumber'=>'string|max:64',
            'billingPeriod'=>'string|in:monthly,quarterly,semiannual,annual,biennial,triennial,credits,reset,deposit',
            'paymentMethodId'=>'integer|min:0','paymentToken'=>'string|max:1024','depositAmount'=>'integer|min:1|max:9999998',
            'couponCode'=>'string|max:128','code'=>'string|max:128','giftCardCode'=>'string|max:128',
            'amount'=>'integer|min:1','autoRenewal'=>'boolean','expiryReminders'=>'boolean','trafficReminders'=>'boolean','serviceNotifications'=>'boolean',
            'resetPassword'=>'boolean','languageSelected'=>'boolean','language'=>\App\Services\LanguagePreferenceService::rule(),
            'requestKey'=>'uuid','page'=>'integer|min:1','pageSize'=>'integer|min:1|max:100',
            'days'=>'integer|in:7,30,90','subject'=>'string|max:255','priority'=>'in:normal,high,urgent',
            'message'=>'string|max:20000','withdrawalMethod'=>'string|max:64','withdrawalAccount'=>'string|max:255',
            'keyword'=>'string|max:200','articleId'=>'integer|min:1','ticketId'=>'integer|min:1',
            'notificationId'=>'integer|min:1','version'=>'integer|min:0','redirect'=>'string|regex:/^[a-z0-9-]+$/',
            'placement'=>'in:landing,dashboard','status'=>'in:unpaid,processing,cancelled,completed,discounted'
        ];
        $required = [
            'Passport/BrowserSessionController@migrate'=>['legacyToken'],
            'Passport/ClientAuthorizationController@create'=>['codeChallenge','state','redirectUri','platform'],
            'Passport/ClientAuthorizationController@exchange'=>['authorizationCode','codeVerifier','redirectUri'],
            'Guest/FastaiController@release'=>['platform','architecture'],
            'Client/ClientController@authenticatedConfig'=>['clientVersion','platform'],
            'Passport/AuthController@login'=>['email','password'],
            'Passport/AuthController@register'=>['email','password'],
            'Passport/AuthController@forget'=>['email','password','emailCode'],
            'Passport/AuthController@token2Login'=>['verificationToken'],
            'Passport/CommController@sendEmailVerify'=>['email'],
            'User/OrderController@save'=>['planId','billingPeriod'],
            'User/OrderController@checkout'=>['paymentMethodId'],
            'User/UserController@changePassword'=>['oldPassword','newPassword'],
            'User/UserController@transfer'=>['amount'],
            'User/UserController@redeemgiftcard'=>['giftCardCode'],
            'User/UsageResetController@consume'=>['requestKey'],
            'User/InviteController@sendEmail'=>['email'],
            'User/TicketController@save'=>['subject','priority','message'],
            'User/TicketController@reply'=>['message'],
            'User/TicketController@withdraw'=>['withdrawalMethod','withdrawalAccount'],
            'User/NoticeController@read'=>['notificationId','version'],
            'User/CouponController@check'=>['code']
        ];
        $rules=[];
        foreach ($contract['input'] as $field=>$internal) {
            $rule=$types[$field] ?? 'string|max:255';
            $rules[$field] = is_array($rule) ? array_merge(['nullable'],$rule) : 'nullable|'.$rule;
        }
        foreach ($required[$contract['key']] ?? [] as $field) $rules[$field]='required|'.($types[$field] ?? 'string');
        if (($contract['key'] === 'User/OrderController@save') && $request->input('billingPeriod')==='deposit') $rules['depositAmount']='required|'.$types['depositAmount'];
        $messages=['required'=>__('This field is required.')];
        foreach (['string','email','max','min','digits','regex','integer','in','boolean','uuid'] as $rule) {
            $messages[$rule]=__('Please check the format and allowed range of this value.');
        }
        $validator=Validator::make($request->all(),$rules,$messages);
        $validator->after(function ($validator) use ($request,$contract) {
            if ($contract['key'] !== 'User/OrderController@save' || $validator->errors()->isNotEmpty()) return;
            if (($request->input('billingPeriod')==='deposit') !== ((int)$request->input('planId')===0)) {
                $validator->errors()->add('planId',__('The selected plan does not match the order type.'));
            }
        });
        $validator->validate();
    }
}
