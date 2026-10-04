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
            'email'=>'string|email:strict|max:254', 'password'=>'string|min:8|max:128',
            'oldPassword'=>'string|max:128','newPassword'=>'string|min:8|max:128',
            'emailCode'=>'string|digits:6', 'invitation'=>'string|regex:/^[a-f0-9]{64}$/',
            'captchaToken'=>'string|max:8192','verificationToken'=>'string|max:128',
            'planId'=>'integer|min:0','replacementOrderNumber'=>'string|max:64',
            'billingPeriod'=>'string|in:monthly,quarterly,semiannual,annual,biennial,triennial,credits,reset,deposit',
            'paymentMethodId'=>'integer|min:0','paymentToken'=>'string|max:1024','depositAmount'=>'integer|min:1|max:9999998',
            'couponCode'=>'string|max:128','code'=>'string|max:128','giftCardCode'=>'string|max:128',
            'amount'=>'integer|min:1','autoRenewal'=>'boolean','expiryReminders'=>'boolean','trafficReminders'=>'boolean',
            'resetPassword'=>'boolean','languageSelected'=>'boolean','language'=>\App\Services\LanguagePreferenceService::rule(),
            'requestKey'=>'uuid','page'=>'integer|min:1','pageSize'=>'integer|min:1|max:100',
            'days'=>'integer|in:7,30,90','subject'=>'string|max:255','priority'=>'in:normal,high,urgent',
            'message'=>'string|max:20000','withdrawalMethod'=>'string|max:64','withdrawalAccount'=>'string|max:255',
            'keyword'=>'string|max:200','articleId'=>'integer|min:1','ticketId'=>'integer|min:1',
            'notificationId'=>'integer|min:1','version'=>'integer|min:0','redirect'=>'string|regex:/^[a-z0-9-]+$/',
            'placement'=>'in:landing,dashboard','status'=>'in:unpaid,processing,cancelled,completed,discounted'
        ];
        $required = [
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
        Validator::make($request->all(),$rules)->validate();
    }
}
