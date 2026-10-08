import json, pathlib, re
root=pathlib.Path(__file__).resolve().parent.parent
def write(p,s):
 p=root/p;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s,encoding='utf-8')
entries=json.loads((root/'docs/api-v10/endpoints.json').read_text())
# Public request names are intentionally declared, never inferred from database keys.
inputs={
 'legacyToken':'legacyToken','email':'email','password':'password','oldPassword':'old_password','newPassword':'new_password',
 'emailCode':'email_code','invitation':'invitation','inviteCode':'invite_code','captchaToken':'recaptcha_data',
 'language':'language','languageSelected':'language_selected','verificationToken':'verify','resetPassword':'isforget',
 'planId':'plan_id','replacementOrderNumber':'replace_trade_no','billingPeriod':'period','depositAmount':'deposit_amount',
 'couponCode':'coupon_code','paymentMethodId':'method','paymentToken':'token','amount':'transfer_amount',
 'autoRenewal':'auto_renewal','expiryReminders':'remind_expire','trafficReminders':'remind_traffic','serviceNotifications':'remind_service',
 'requestKey':'request_key','sessionId':'session_id','orderNumber':'trade_no','ticketId':'id',
 'subject':'subject','priority':'level','message':'message','withdrawalMethod':'withdraw_method',
 'withdrawalAccount':'withdraw_account','giftCardCode':'giftcard','status':'status','page':'current',
 'pageSize':'page_size','days':'days','articleId':'id','notificationId':'id','version':'version',
 'platform':'platform','architecture':'architecture','keyword':'keyword','redirect':'redirect','placement':'placement','format':'flag','accessToken':'access_token','code':'code'}
allowed={
 'Passport/BrowserSessionController@migrate':'legacyToken',
 'Guest/FastaiController@release':'platform architecture',
 'Passport/AuthController@login':'email password captchaToken language languageSelected',
 'Passport/AuthController@register':'email password emailCode invitation inviteCode captchaToken language languageSelected',
 'Passport/AuthController@forget':'email password emailCode language',
 'Passport/AuthController@token2Login':'verificationToken',
 'Passport/AuthController@getQuickLoginUrl':'redirect',
 'Passport/CommController@sendEmailVerify':'email resetPassword invitation captchaToken language',
 'Passport/CommController@pv':'inviteCode',
 'User/UserController@update':'language autoRenewal expiryReminders trafficReminders serviceNotifications',
 'User/UserController@changePassword':'oldPassword newPassword',
 'User/UserController@transfer':'amount', 'User/UserController@getQuickLoginUrl':'redirect', 'User/UserController@redeemgiftcard':'giftCardCode',
 'User/OrderController@save':'planId replacementOrderNumber billingPeriod depositAmount couponCode',
 'User/OrderController@checkout':'paymentMethodId paymentToken', 'User/OrderController@fetch':'status page pageSize',
 'User/PlanController@fetch':'planId', 'User/CouponController@check':'code planId billingPeriod',
 'User/InviteController@sendEmail':'email language', 'User/InviteController@emailHistory':'days page pageSize',
 'User/InviteController@details':'page pageSize', 'User/TicketController@save':'subject priority message',
 'User/TicketController@reply':'message', 'User/TicketController@fetch':'ticketId page pageSize',
 'User/TicketController@withdraw':'withdrawalMethod withdrawalAccount',
 'User/UsageResetController@consume':'requestKey', 'User/NoticeController@read':'notificationId version',
 'User/NoticeController@inbox':'page pageSize','User/NoticeController@fetch':'notificationId page pageSize',
 'User/KnowledgeController@fetch':'articleId keyword','User/StatController@getTrafficLog':'days page pageSize',
 'Guest/BannerController@fetch':'placement'}
def key(e):return e.get('key') or e['action'].split('V1\\')[1].replace('\\','/')
# Schema notation: source field, conversion, nested named schema. Only declared fields leave the server.
schemas={}
def schema(name, fields):
 schemas[name]={}
 for spec in fields.split():
  parts=spec.split(':');public,source=parts[:2];schemas[name][public]=[source]+parts[2:]
schema('plan','id:id name:name description:content quotaBytes:transfer_enable:gb speedLimitMbps:speed_limit deviceLimit:device_limit remainingCapacity:capacity_limit renewable:renew:boolean monthlyPrice:month_price quarterlyPrice:quarter_price semiannualPrice:half_year_price annualPrice:year_price biennialPrice:two_year_price triennialPrice:three_year_price creditPrice:onetime_price resetPrice:reset_price resetMethod:reset_traffic_method')
schema('accountStatus','state:state available:is_available:boolean quotaExhausted:quota_exhausted:boolean serverTime:server_time:time')
schema('account','id:id email:email language:language quotaBytes:transfer_enable:integer creditBytes:credit_balance:integer deviceLimit:device_limit lastLoginAt:last_login_at:time uploadedBytes:u:integer downloadedBytes:d:integer createdAt:created_at:time banned:banned:boolean autoRenewal:auto_renewal:boolean expiryReminders:remind_expire:boolean trafficReminders:remind_traffic:boolean serviceNotifications:remind_service:boolean expiresAt:expired_at:time balance:balance commissionBalance:commission_balance planId:plan_id discountPercent:discount commissionRate:commission_rate telegramId:telegram_id avatarUrl:avatar_url accountStatus:account_status:object:accountStatus')
schema('subscription','planId:plan_id expiresAt:expired_at:time uploadedBytes:u:integer downloadedBytes:d:integer quotaBytes:transfer_enable:integer creditBytes:credit_balance:integer deviceLimit:device_limit email:email credentialId:uuid plan:plan:object:plan onlineDevices:alive_ip subscriptionUrl:subscribe_url resetAt:reset_at:time resetTimezone:reset_timezone active:has_subscription:boolean resetDay:reset_day canAdvancePeriod:allow_new_period:boolean')
schema('creditSnapshot','name:name')
schema('order','orderNumber:trade_no planId:plan_id billingPeriod:period:period totalAmount:total_amount discountAmount:discount_amount creditOffset:surplus_amount refundAmount:refund_amount balanceOffset:balance_amount handlingAmount:handling_amount paymentId:payment_id status:status:orderStatus kind:type:orderKind createdAt:created_at:time updatedAt:updated_at:time paidAt:paid_at:time creditBytes:credit_bytes:integer plan:plan:object:plan creditedAmount:get_amount depositBonus:bounus creditSnapshot:credit_snapshot:object:creditSnapshot')
schema('paymentMethod','id:id name:name provider:payment iconUrl:icon fixedFee:handling_fee_fixed percentageFee:handling_fee_percent')
schema('credit','id:id name:name bytes:bytes:integer price:price')
schema('notification','id:id title:title content:content imageUrl:img_url tags:tags createdAt:created_at:time updatedAt:updated_at:time read:is_read:boolean version:updated_at')
schema('message','id:id ticketId:ticket_id message:message createdAt:created_at:time updatedAt:updated_at:time mine:is_me:boolean')
schema('ticket','id:id subject:subject priority:level:priority status:status:ticketStatus replyStatus:reply_status:replyStatus createdAt:created_at:time updatedAt:updated_at:time messages:message:array:message')
schema('node','id:id name:name protocol:type host:host port:port online:is_online:boolean rate:rate tags:tags lastCheckedAt:last_check_at:time nodeId:node_id proxyName:proxy_name regionCode:region_code cityCode:city_code displayLabel:display_label displayNames:display_names')
schema('traffic','uploadedBytes:u:integer downloadedBytes:d:integer recordedAt:record_at:time rate:server_rate')
schema('invitation','id:id email:email status:status createdAt:created_at:time expiresAt:expires_at:time')
schema('commission','id:id orderAmount:order_amount orderNumber:trade_no amount:get_amount createdAt:created_at:time')
schema('article','id:id title:title category:category body:body updatedAt:updated_at:time createdAt:created_at:time')
schema('banner','id:id title:title imageUrl:image_url mobileImageUrl:mobile_image_url targetUrl:target_url')
schema('apple','username:username password:password region:region_display lastCheckedAt:last_check:time available:available:boolean status:status')
schema('session','ip:ip loginAt:login_at:time userAgent:ua expiresAt:expires_at:time current:current:boolean clientKind:client_kind')
schema('resetCredit','id:id remaining:remaining expiresAt:expires_at:time')
schema('resetHistory','id:id kind:kind quantity:quantity uploadedBefore:u_before:integer downloadedBefore:d_before:integer createdAt:created_at:time')
schema('reset','available:available credits:credits:array:resetCredit canReset:can_reset:boolean disabledReason:disabled_reason history:history:array:resetHistory')
schema('resetResult','outcome:outcome')
schema('publicSettings','termsUrl:tos_url emailVerificationRequired:is_email_verify:boolean invitationRequired:is_invite_force:boolean emailSuffixes:email_whitelist_suffix:strings captchaRequired:is_recaptcha:boolean captchaSiteKey:recaptcha_site_key description:app_description appUrl:app_url logoUrl:logo')
schema('preferences','telegramEnabled:is_telegram:boolean telegramCommunityUrl:telegram_discuss_link stripePublicKey:stripe_pk withdrawalMethods:withdraw_methods withdrawalsClosed:withdraw_close:boolean currency:currency currencySymbol:currency_symbol commissionDistributionEnabled:commission_distribution_enable:boolean commissionLevelOne:commission_distribution_l1 commissionLevelTwo:commission_distribution_l2 commissionLevelThree:commission_distribution_l3')
schema('task','taskId:task_id status:status')
schema('bot','username:username')
schema('loginState','authenticated:is_login:boolean administrator:is_admin:boolean')
schema('coupon','id:id code:code name:name discountType:type:couponType value:value startedAt:started_at:time expiresAt:ended_at:time')
schema('signedEntrypoints','payload:payload signature:signature')
schema('fastaiRelease','platform:platform architecture:architecture channel:channel latestVersion:latestVersion latestBuild:latestBuild:integer minimumVersion:minimumVersion downloadUrl:downloadUrl sha256:sha256 releaseNotes:releaseNotes publishedAt:publishedAt')
schema('applicationVersion','platform:platform version:version downloadUrl:download_url')
for name in ['plan','account','order','paymentMethod','credit','commission','coupon']:
 schemas[name]['currency']=['currency']
schemas['account']['ticketCreation']=['ticket_creation']
# Explicit integer wire conversions, including nullable prices (null means unavailable).
for name,fields in {
 'plan':['id','deviceLimit','remainingCapacity','monthlyPrice','quarterlyPrice','semiannualPrice','annualPrice','biennialPrice','triennialPrice','creditPrice','resetPrice'],
 'account':['id','balance','commissionBalance','planId','deviceLimit'],
 'order':['planId','totalAmount','discountAmount','creditOffset','refundAmount','balanceOffset','handlingAmount','paymentId','creditedAmount','depositBonus'],
 'paymentMethod':['id','fixedFee'], 'credit':['id','price'], 'commission':['id','orderAmount','amount'],
 'subscription':['planId','deviceLimit','onlineDevices','resetDay'], 'node':['id','port'], 'banner':['id'],
 'ticket':['id'],'notification':['id','version'],'article':['id'],'message':['id','ticketId'],
 'reset':['available'],'resetCredit':['id','remaining'],'resetHistory':['id','quantity'], 'invitation':['id']
}.items():
 for field in fields: schemas[name][field].append('integer')
for name,fields in {
 'plan':['speedLimitMbps','resetMethod'], 'account':['discountPercent','commissionRate'],
 'paymentMethod':['percentageFee'], 'node':['rate'], 'traffic':['rate'], 'coupon':['value'],
 'preferences':['commissionLevelOne','commissionLevelTwo','commissionLevelThree']
}.items():
 for field in fields: schemas[name][field].append('number')
schema('browserSession','accountId:accountId authenticated:authenticated:boolean csrfToken:csrfToken expiresAt:expiresAt')
outputs={
 'Passport/BrowserSessionController@show':'browserSession','Passport/BrowserSessionController@migrate':'browserSession',
 'Guest/FastaiController@entrypoints':'signedEntrypoints',
 'Guest/FastaiController@release':'fastaiRelease',
 'User/UserController@info':'account', 'User/UserController@getSubscribe':'subscription',
 'User/UserController@getActiveSession':'dictionary:session','User/UserController@checkLogin':'loginState',
 'User/PlanController@fetch':'flex:plan','User/OrderController@fetch':'array:order','User/OrderController@detail':'order',
 'User/OrderController@getPaymentMethod':'array:paymentMethod','User/OrderController@save':'orderCreated',
 'User/OrderController@check':'orderStatus','User/OrderController@checkout':'payment',
 'User/PlanController@credits':'array:credit','User/AppleAccountController@fetch':'array:apple',
 'User/UsageResetController@fetch':'reset','User/UsageResetController@consume':'resetResult',
 'User/NoticeController@fetch':'flex:notification','User/NoticeController@inbox':'inbox',
 'User/TicketController@fetch':'flex:ticket','User/TicketController@save':'ticket','User/TicketController@withdraw':'ticket','Passport/CommController@sendEmailVerify':'task','User/ServerController@fetch':'array:node',
 'User/StatController@getTrafficLog':'array:traffic','User/InviteController@details':'array:commission',
 'User/InviteController@sendEmail':'invitation','User/InviteController@emailHistory':'array:invitation',
 'User/InviteController@fetch':'referrals','User/UserController@getStat':'summary',
 'User/KnowledgeController@fetch':'articles','User/KnowledgeController@getCategory':'strings',
 'User/CommController@config':'preferences','User/TelegramController@getBotInfo':'bot',
 'User/CouponController@check':'coupon','Guest/CommController@config':'publicSettings',
 'Guest/BannerController@fetch':'array:banner','Client/AppController@getVersion':'applicationVersion'}
inputs.update({field:field for field in ['codeChallenge','state','redirectUri','authorizationCode','codeVerifier']})
allowed.update({'Passport/ClientAuthorizationController@create':'codeChallenge state redirectUri platform', 'Passport/ClientAuthorizationController@exchange':'authorizationCode codeVerifier redirectUri'})
outputs.update({'Passport/ClientAuthorizationController@create':'clientAuthorization', 'Passport/ClientAuthorizationController@details':'clientAuthorizationDetails', 'Passport/ClientAuthorizationController@approve':'clientAuthorizationApproval', 'Passport/ClientAuthorizationController@exchange':'authentication'})
schemas.update({
 'clientAuthorization':{'authorizationId':['authorizationId'],'authorizationUrl':['authorizationUrl'],'expiresAt':['expiresAt','time']},
 'clientAuthorizationDetails':{'platform':['platform'],'expiresAt':['expiresAt','time']},
 'clientAuthorizationApproval':{'callbackUrl':['callbackUrl']},
})
contracts={};controllers={};routes=['<?php','// Explicit V10 resources. Administrative and node routes remain unchanged.']
for i,e in enumerate(entries):
 k=key(e);name=e['method'].lower()+''.join(x[0].upper()+x[1:] for x in re.findall(r'[A-Za-z0-9]+',e['path']));area,action=k.split('@');controller=area.replace('/','')
 raw=e.get('raw',False) or e['scope']=='client' and not k.endswith('getVersion') or k.startswith('Guest/Payment') or k.startswith('Guest/Telegram') or k.endswith('BannerController@image')
 names=allowed.get(k,'').split();imap={n:inputs[n] for n in names}
 if k=='User/PlanController@fetch':imap={'planId':'id'}
 if k=='User/NoticeController@fetch':imap.update({'pageSize':'pageSize'})
 if e['scope']=='client':imap={'format':'flag','language':'language'}
 if k=='Client/ClientController@authenticatedConfig':imap={'clientVersion':'client_version','platform':'platform','architecture':'architecture'}
 imap={public:internal for public,internal in imap.items() if internal not in e['bindings'].values()}
 if k.startswith('Guest/Telegram'):imap={} # Signed provider payload, native protocol.
 out=outputs.get(k,'authentication' if k in ['Passport/AuthController@login','Passport/AuthController@register','Passport/AuthController@token2Login'] else 'scalar')
 contracts[name]={'input':imap,'output':out,'role':e['role'],'status':e['status'],'raw':raw,'bindings':e['bindings'],'path':e['path'],'method':e['method'],'key':k}
 if e.get('description'): contracts[name]['description']=e['description']
 params=[];args=[]
 for p in e['parameters']:
  typ=p['type'];pn=p['name']
  if typ and (typ=='Illuminate\\Http\\Request' or 'Http\\Requests' in typ):
   args.append('$this->businessRequest($request, \\'+typ+'::class)')
  elif typ:params.append('\\'+typ+' $'+pn);args.append('$'+pn)
  else:
   routevar=next((x for x,v in e['bindings'].items() if v==pn),pn)
   args.append('$request->route('+repr(routevar)+')')
 service='App\\Services\\Actions\\'+area.replace('/','\\').replace('Controller','Actions')
 body='    public function '+name+'(\\Illuminate\\Http\\Request $request'+(' ,'+', '.join(params) if params else '')+')\n    {\n        $this->prepare($request, '+repr(name)+');\n        $result = app(\\'+service+'::class)->'+action+'('+', '.join(args)+');\n        return $this->respond($request, $result, '+repr(name)+');\n    }\n'
 controllers.setdefault(controller,[]).append(body)
 methods=e.get('methods',[e['method']]);
 if e['method']=='GET' and not e['path'].startswith('webhooks/'): methods=[*methods,'HEAD']
 route='\\Illuminate\\Support\\Facades\\Route::match('+str(methods).replace('"',"'")+", "+repr(e['path'])+", [\\App\\Http\\Controllers\\V10\\"+controller+"::class, "+repr(name)+"])"

 if e['middleware']:route+='->middleware('+str(e['middleware'])+')'
 route+='->name('+repr('v10.'+name)+');';routes.append(route)
for c,b in controllers.items():write('app/Http/Controllers/V10/'+c+'.php','<?php\nnamespace App\\Http\\Controllers\\V10;\nclass '+c+' extends ResourceController\n{\n'+''.join(b)+'}\n')
write('routes/v10.php','\n'.join(routes)+'\n')
write('docs/api-v10/contracts.json',json.dumps({'schemas':schemas,'endpoints':contracts},ensure_ascii=False,indent=2))
write('frontend/src/shared/v10-contracts.json',json.dumps({'schemas':schemas,'endpoints':contracts,'routes':{e['legacy']:e['method'].lower()+''.join(x[0].upper()+x[1:] for x in re.findall(r'[A-Za-z0-9]+',e['path'])) for i,e in enumerate(entries) if e.get('legacy') and not e.get('legacyQuery')},'details':{e['legacy']:e['method'].lower()+''.join(x[0].upper()+x[1:] for x in re.findall(r'[A-Za-z0-9]+',e['path'])) for i,e in enumerate(entries) if e.get('legacyQuery')}},ensure_ascii=False,indent=2))

frontend_path=root/'frontend/src/shared/v10-contracts.json'
frontend=json.loads(frontend_path.read_text(encoding='utf-8'))
frontend['methodRoutes']={e['legacyMethod']+' '+e['legacy']:e['method'].lower()+''.join(x[0].upper()+x[1:] for x in re.findall(r'[A-Za-z0-9]+',e['path'])) for e in entries if e.get('legacy') and not e.get('legacyQuery')}
write('frontend/src/shared/v10-contracts.json',json.dumps(frontend,ensure_ascii=False,indent=2))
