<?php
namespace App\Http\Routes\V1;

use Illuminate\Contracts\Routing\Registrar;

class AdminRoute
{
    public function map(Registrar $router)
    {
        $router->group([
            'prefix' => config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key')))),
            'middleware' => ['admin', 'log'],
        ], function ($router) {
            $router->get('/dictionary/fetch', 'V1\\Admin\\NodeDictionaryController@fetch');
            $router->post('/dictionary/save', 'V1\\Admin\\NodeDictionaryController@save')->middleware('throttle:30,1,node-dictionary:');
            $router->get('/analytics/report', 'V1\\Admin\\ProductAnalyticsController@report')->middleware('throttle:30,1,analytics-report:');
            $router->get('/analytics/operations', 'V1\\Admin\\ProductAnalyticsController@operations')->middleware('throttle:30,1,analytics-operations:');
            $router->get('/analytics/journey', 'V1\\Admin\\ProductAnalyticsController@journey')->middleware('throttle:30,1,analytics-journey:');
            $router->get('/analytics/settings', 'V1\\Admin\\ProductAnalyticsController@configuration')->middleware('throttle:30,1,analytics-settings-read:');
            $router->post('/analytics/settings', 'V1\\Admin\\ProductAnalyticsController@settings')->middleware('throttle:10,1,analytics-settings:');
            $router->post('/config/testAppleAccount', 'V1\\Admin\\ConfigController@testAppleAccount')->middleware('throttle:10,1');
            $router->post('/config/testFastaiEntrypoint', 'V1\\Admin\\ConfigController@testFastaiEntrypoint')->middleware('throttle:10,1');
            $router->get('/client-diagnostics/fetch', 'V1\\Admin\\ClientDiagnosticController@fetch');
            $router->get('/fastai-installers/fetch', 'V1\\Admin\\FastaiInstallerController@fetch');
            $router->post('/fastai-installers/create', 'V1\\Admin\\FastaiInstallerController@create')->middleware('throttle:10,1');
            $router->post('/fastai-installers/chunk', 'V1\\Admin\\FastaiInstallerController@chunk')->middleware('throttle:1200,1');
            $router->post('/fastai-installers/complete', 'V1\\Admin\\FastaiInstallerController@complete')->middleware('throttle:20,1');
            $router->get('/invitation-emails/fetch', 'V1\\Admin\\InvitationEmailController@fetch')->middleware('throttle:60,1');
            $router->get('/invitation-review/fetch', 'V1\\Admin\\InvitationReviewController@fetch');
            $router->post('/invitation-review/review', 'V1\\Admin\\InvitationReviewController@review');
            $router->get('/mail-blocklist/fetch', 'V1\\Admin\\MailBlocklistController@fetch');
            $router->get('/mail-blocklist/history', 'V1\\Admin\\MailBlocklistController@history');
            $router->post('/mail-blocklist/add', 'V1\\Admin\\MailBlocklistController@add')->middleware('throttle:30,1');
            $router->post('/mail-blocklist/import', 'V1\\Admin\\MailBlocklistController@import')->middleware('throttle:5,1');
            $router->post('/mail-blocklist/change', 'V1\\Admin\\MailBlocklistController@change')->middleware('throttle:30,1');
            $router->get('/mail-logs/fetch', 'V1\\Admin\\MailLogController@fetch');
            $router->get('/mail-logs/health', 'V1\\Admin\\MailLogController@health');
            $router->get('/mail-logs/suppressions', 'V1\\Admin\\MailLogController@suppressions');
            $router->post('/mail-logs/release', 'V1\\Admin\\MailLogController@release')->middleware('throttle:10,1');
            $router->get('/security/mfa', 'V1\\Admin\\MfaController@state');
            $router->post('/security/mfa/challenges', 'V1\\Admin\\MfaController@start')->middleware('throttle:10,1');
            // Config
            $router->get ('/config/fetch', 'V1\\Admin\\ConfigController@fetch');
            $router->post('/config/save', 'V1\\Admin\\ConfigController@save');
            $router->get ('/config/getEmailTemplate', 'V1\\Admin\\ConfigController@getEmailTemplate');
            $router->get ('/console/nodeSchema', 'V1\\Admin\\ConsoleController@nodeSchema');
            $router->get ('/console/configSchema', 'V1\\Admin\\ConsoleController@configSchema');
            $router->get('/telegram/status', 'V1\\Admin\\TelegramController@status');
            $router->post('/telegram/inspect', 'V1\\Admin\\TelegramController@inspect')->middleware('throttle:6,1');
            $router->post('/telegram/import', 'V1\\Admin\\TelegramController@import')->middleware('throttle:6,1');
            $router->post('/config/setTelegramWebhook', 'V1\\Admin\\ConfigController@setTelegramWebhook');
            $router->post('/config/testSendMail', 'V1\\Admin\\ConfigController@testSendMail')->middleware('throttle:3,1');
            $router->post('/config/previewMail', 'V1\\Admin\\ConfigController@previewMail');
            $router->post('/ops/i18n/content/generate', 'V1\\Admin\\ContentTranslationController@generate')->middleware('throttle:30,1');
            // Plan
            $router->get ('/plan/fetch', 'V1\\Admin\\PlanController@fetch');
            $router->post('/plan/save', 'V1\\Admin\\PlanController@save');
            $router->post('/plan/drop', 'V1\\Admin\\PlanController@drop');
            $router->post('/plan/update', 'V1\\Admin\\PlanController@update');
            $router->post('/plan/sort', 'V1\\Admin\\PlanController@sort');
            $router->get ('/ops/i18n/plan/locales', 'V1\Admin\PlanI18nController@locales');
            $router->get ('/ops/i18n/plan/fetch', 'V1\Admin\PlanI18nController@fetch');
            $router->post('/ops/i18n/plan/save', 'V1\Admin\PlanI18nController@save');
            $router->post('/ops/i18n/plan/generate', 'V1\Admin\PlanI18nController@generate')->middleware('throttle:10,1');
            // Server
            $router->get('/server/ddns/fetch', 'V1\\Admin\\NodeDdnsController@fetch');
            $router->get('/server/ddns/events', 'V1\\Admin\\NodeDdnsController@events');
            $router->post('/server/ddns/credentials/save', 'V1\\Admin\\NodeDdnsController@saveCredential');
            $router->post('/server/ddns/credentials/drop', 'V1\\Admin\\NodeDdnsController@dropCredential');
            $router->post('/server/ddns/assignments/save', 'V1\\Admin\\NodeDdnsController@saveAssignment');
            $router->post('/server/ddns/assignments/drop', 'V1\\Admin\\NodeDdnsController@dropAssignment');
            $router->post('/server/ddns/assignments/rotate', 'V1\\Admin\\NodeDdnsController@rotate');
            $router->get ('/server/group/fetch', 'V1\\Admin\\Server\\GroupController@fetch');
            $router->post('/server/group/save', 'V1\\Admin\\Server\\GroupController@save');
            $router->post('/server/group/drop', 'V1\\Admin\\Server\\GroupController@drop');
            $router->get ('/server/route/fetch', 'V1\\Admin\\Server\\RouteController@fetch');
            $router->post('/server/route/save', 'V1\\Admin\\Server\\RouteController@save');
            $router->post('/server/route/drop', 'V1\\Admin\\Server\\RouteController@drop');
            $router->get('/server/lightsail/fetch', 'V1\\Admin\\LightsailController@fetch');
            $router->get('/server/lightsail/inspect', 'V1\\Admin\\LightsailController@inspect')->middleware('throttle:20,1');
            $router->post('/server/lightsail/save', 'V1\\Admin\\LightsailController@save');
            $router->post('/server/lightsail/drop', 'V1\\Admin\\LightsailController@drop');
            $router->post('/server/lightsail/operate', 'V1\\Admin\\LightsailController@operate')->middleware('throttle:5,1');
            $router->get('/server/traffic-budget/fetch', 'V1\\Admin\\ServerTrafficBudgetController@fetch');
            $router->post('/server/traffic-budget/save', 'V1\\Admin\\ServerTrafficBudgetController@save');
            $router->get('/server/manage/runtime', 'V1\\Admin\\Server\\ManageController@runtime')->middleware('throttle:60,1');
            $router->get ('/server/manage/getNodes', 'V1\\Admin\\Server\\ManageController@getNodes');
            $router->post('/server/manage/sort', 'V1\\Admin\\Server\\ManageController@sort');
            $router->group([
                'prefix' => 'server/v2node'
            ], function ($router) {
                $router->post('save', 'V1\\Admin\\Server\\V2nodeController@save');
                $router->post('drop', 'V1\\Admin\\Server\\V2nodeController@drop');
                $router->post('update', 'V1\\Admin\\Server\\V2nodeController@update');
                $router->post('copy', 'V1\\Admin\\Server\\V2nodeController@copy');
            });
            $router->group([
                'prefix' => 'server/v2box'
            ], function ($router) {
                $router->post('save', 'V1\\Admin\\Server\\V2boxController@save');
                $router->post('drop', 'V1\\Admin\\Server\\V2boxController@drop');
                $router->post('update', 'V1\\Admin\\Server\\V2boxController@update');
                $router->post('copy', 'V1\\Admin\\Server\\V2boxController@copy');
            });
            // Order
            $router->get ('/order/fetch', 'V1\\Admin\\OrderController@fetch');
            $router->post('/order/update', 'V1\\Admin\\OrderController@update');
            $router->post('/order/assign', 'V1\\Admin\\OrderController@assign');
            $router->post('/order/paid', 'V1\\Admin\\OrderController@paid');
            $router->post('/order/cancel', 'V1\\Admin\\OrderController@cancel');
            $router->post('/order/detail', 'V1\\Admin\\OrderController@detail');
            // User
            $router->get('/user/usageResetPreview', 'V1\\Admin\\UserController@usageResetPreview');
            $router->post('/user/usageReset', 'V1\\Admin\\UserController@usageReset')->middleware('throttle:10,1');
            $router->get ('/user/fetch', 'V1\\Admin\\UserController@fetch');
            $router->post('/user/update', 'V1\\Admin\\UserController@update');
            $router->get ('/user/getUserInfoById', 'V1\\Admin\\UserController@getUserInfoById');
            $router->get('/mail-campaigns/fetch', 'V1\\Admin\\MailCampaignController@fetch');
            $router->post('/user/previewMailAudience', 'V1\\Admin\\UserController@previewMailAudience')->middleware('throttle:20,1');
            $router->post('/user/sendMail', 'V1\\Admin\\UserController@sendMail');
            $router->post('/user/ban', 'V1\\Admin\\UserController@ban');
            $router->post('/user/resetSecret', 'V1\\Admin\\UserController@resetSecret');
            $router->post('/user/delUser', 'V1\\Admin\\UserController@delUser');
            $router->post('/user/allDel', 'V1\\Admin\\UserController@allDel');
            // Stat
            $router->get ('/stat/getOverride', 'V1\\Admin\\StatController@getOverride');
            $router->get ('/stat/getServerLastRank', 'V1\\Admin\\StatController@getServerLastRank');
            $router->get ('/stat/getServerTodayRank', 'V1\\Admin\\StatController@getServerTodayRank');
            $router->get ('/stat/getUserLastRank', 'V1\\Admin\\StatController@getUserLastRank');
            $router->get ('/stat/getUserTodayRank', 'V1\\Admin\\StatController@getUserTodayRank');
            $router->get ('/stat/getOrder', 'V1\\Admin\\StatController@getOrder');
            $router->get ('/stat/getStatUser', 'V1\\Admin\\StatController@getStatUser');
            // Banners
            $router->get('/banner/fetch', 'V1\\Admin\\BannerController@fetch');
            $router->post('/banner/save', 'V1\\Admin\\BannerController@save');
            $router->post('/banner/show', 'V1\\Admin\\BannerController@show');
            $router->post('/banner/drop', 'V1\\Admin\\BannerController@drop');
            $router->post('/banner/upload', 'V1\\Admin\\BannerController@upload')->middleware('throttle:20,1');
            // Notice
            $router->get ('/notice/fetch', 'V1\\Admin\\NoticeController@fetch');
            $router->post('/notice/save', 'V1\\Admin\\NoticeController@save');
            $router->post('/notice/drop', 'V1\\Admin\\NoticeController@drop');
            $router->post('/notice/show', 'V1\\Admin\\NoticeController@show');
            // Ticket
            $router->get ('/ticket/fetch', 'V1\\Admin\\TicketController@fetch');
            $router->post('/ticket/reply', 'V1\\Admin\\TicketController@reply');
            $router->post('/ticket/close', 'V1\\Admin\\TicketController@close');
            $router->get('/billing-currency/fetch', 'V1\\Admin\\BillingCurrencyController@fetch');
            $router->post('/billing-currency/refresh', 'V1\\Admin\\BillingCurrencyController@refresh')->middleware('throttle:2,1');
            $router->post('/billing-currency/prices', 'V1\\Admin\\BillingCurrencyController@prices');
            // Coupon
            $router->get('/coupon-presentation/fetch', 'V1\\Admin\\CouponPresentationController@fetch');
            $router->post('/coupon-presentation/save', 'V1\\Admin\\CouponPresentationController@save')->middleware('throttle:20,1');
            $router->post('/coupon-campaign/preview', 'V1\\Admin\\CouponCampaignController@preview')->middleware('throttle:5,1');
            $router->post('/coupon-campaign/confirm', 'V1\\Admin\\CouponCampaignController@confirm')->middleware('throttle:5,1');
            $router->post('/coupon-campaign/cancel', 'V1\\Admin\\CouponCampaignController@cancel')->middleware('throttle:5,1');
            $router->get('/coupon-campaign/fetch', 'V1\\Admin\\CouponCampaignController@fetch');
            $router->get('/coupon-campaign/recipients', 'V1\\Admin\\CouponCampaignController@recipients');
            $router->post('/coupon/issue', 'V1\\Admin\\CouponController@issue')->middleware('throttle:20,1');
            $router->get ('/coupon/fetch', 'V1\\Admin\\CouponController@fetch');
            $router->post('/coupon/generate', 'V1\\Admin\\CouponController@generate');
            $router->post('/coupon/drop', 'V1\\Admin\\CouponController@drop');
            $router->post('/coupon/show', 'V1\\Admin\\CouponController@show');
            // Giftcard
            $router->get ('/giftcard/fetch', 'V1\\Admin\\GiftcardController@fetch');
            $router->post('/giftcard/generate', 'V1\\Admin\\GiftcardController@generate');
            $router->post('/giftcard/drop', 'V1\\Admin\\GiftcardController@drop');
            // Knowledge
            $router->get ('/knowledge/fetch', 'V1\\Admin\\KnowledgeController@fetch');
            $router->get ('/knowledge/getCategory', 'V1\\Admin\\KnowledgeController@getCategory');
            $router->post('/knowledge/save', 'V1\\Admin\\KnowledgeController@save');
            $router->post('/knowledge/show', 'V1\\Admin\\KnowledgeController@show');
            $router->post('/knowledge/drop', 'V1\\Admin\\KnowledgeController@drop');
            $router->post('/knowledge/sort', 'V1\\Admin\\KnowledgeController@sort');
            // Payment
            $router->get ('/payment/fetch', 'V1\\Admin\\PaymentController@fetch');
            $router->get ('/payment/getPaymentMethods', 'V1\\Admin\\PaymentController@getPaymentMethods');
            $router->post('/payment/getPaymentForm', 'V1\\Admin\\PaymentController@getPaymentForm');
            $router->post('/payment/save', 'V1\\Admin\\PaymentController@save');
            $router->post('/payment/drop', 'V1\\Admin\\PaymentController@drop');
            $router->post('/payment/show', 'V1\\Admin\\PaymentController@show');
            $router->post('/payment/sort', 'V1\\Admin\\PaymentController@sort');
            // System
            $router->get('/system/health', 'V1\\Admin\\SystemController@health')->middleware('throttle:20,1');
            $router->get ('/system/getSystemStatus', 'V1\\Admin\\SystemController@getSystemStatus');
            $router->get ('/system/getQueueStats', 'V1\\Admin\\SystemController@getQueueStats');
            $router->get ('/system/getQueueWorkload', 'V1\\Admin\\SystemController@getQueueWorkload');
            $router->get ('/system/getQueueMasters', 'V1\\Admin\\SystemController@getQueueMasters');
            $router->get ('/system/getSystemLog', 'V1\\Admin\\SystemController@getSystemLog');
            $router->get('/system/logRetention', 'V1\\Admin\\SystemController@getLogRetention');
            $router->post('/system/logRetention', 'V1\\Admin\\SystemController@saveLogRetention');
        });
    }
}
