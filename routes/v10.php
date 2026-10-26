<?php
\Illuminate\Support\Facades\Route::get('public/analytics/configuration', [\App\Http\Controllers\V10\ProductAnalyticsController::class,'configuration'])->middleware('throttle:60,1,product-analytics:')->name('v10.getPublicAnalyticsConfiguration');
\Illuminate\Support\Facades\Route::post('public/analytics/events', [\App\Http\Controllers\V10\ProductAnalyticsController::class,'store'])->middleware('throttle:60,1,product-analytics:')->name('v10.postPublicAnalyticsEvents');
// Explicit V10 resources. Administrative and legacy node routes remain available separately.
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'subscriptions/{subscriptionToken}', [\App\Http\Controllers\V10\ClientClientController::class, 'getSubscriptionsSubscriptionToken'])->name('v10.getSubscriptionsSubscriptionToken');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'subscriptions/{subscriptionToken}/application-config', [\App\Http\Controllers\V10\ClientAppController::class, 'getSubscriptionsSubscriptionTokenApplicationConfig'])->name('v10.getSubscriptionsSubscriptionTokenApplicationConfig');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'subscriptions/{subscriptionToken}/application-version', [\App\Http\Controllers\V10\ClientAppController::class, 'getSubscriptionsSubscriptionTokenApplicationVersion'])->name('v10.getSubscriptionsSubscriptionTokenApplicationVersion');
\Illuminate\Support\Facades\Route::match(['POST'], 'webhooks/telegram', [\App\Http\Controllers\V10\GuestTelegramController::class, 'postWebhooksTelegram'])->name('v10.postWebhooksTelegram');
\Illuminate\Support\Facades\Route::match(['GET', 'POST'], 'webhooks/payments/{provider}/{endpointId}', [\App\Http\Controllers\V10\GuestPaymentController::class, 'getWebhooksPaymentsProviderEndpointId'])->name('v10.getWebhooksPaymentsProviderEndpointId');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'public/banners', [\App\Http\Controllers\V10\GuestBannerController::class, 'getPublicBanners'])->name('v10.getPublicBanners');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'public/banner-images/{name}', [\App\Http\Controllers\V10\GuestBannerController::class, 'getPublicBannerImagesName'])->name('v10.getPublicBannerImagesName');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'public/settings', [\App\Http\Controllers\V10\GuestCommController::class, 'getPublicSettings'])->name('v10.getPublicSettings');
\Illuminate\Support\Facades\Route::match(['POST'], 'auth/registrations', [\App\Http\Controllers\V10\PassportAuthController::class, 'postAuthRegistrations'])->name('v10.postAuthRegistrations');
\Illuminate\Support\Facades\Route::match(['POST'], 'auth/sessions', [\App\Http\Controllers\V10\PassportAuthController::class, 'postAuthSessions'])->middleware(['throttle:30,1'])->name('v10.postAuthSessions');
\Illuminate\Support\Facades\Route::match(['POST'], 'auth/session-exchanges', [\App\Http\Controllers\V10\PassportAuthController::class, 'postAuthSessionExchanges'])->name('v10.postAuthSessionExchanges');
\Illuminate\Support\Facades\Route::match(['POST'], 'auth/password-resets', [\App\Http\Controllers\V10\PassportAuthController::class, 'postAuthPasswordResets'])->name('v10.postAuthPasswordResets');
\Illuminate\Support\Facades\Route::match(['POST'], 'auth/login-links', [\App\Http\Controllers\V10\PassportAuthController::class, 'postAuthLoginLinks'])->name('v10.postAuthLoginLinks');
\Illuminate\Support\Facades\Route::match(['POST'], 'auth/email-verifications', [\App\Http\Controllers\V10\PassportCommController::class, 'postAuthEmailVerifications'])->name('v10.postAuthEmailVerifications');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/download-accounts', [\App\Http\Controllers\V10\UserAppleAccountController::class, 'getMeDownloadAccounts'])->middleware(['throttle:10,1'])->name('v10.getMeDownloadAccounts');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/usage-resets', [\App\Http\Controllers\V10\UserUsageResetController::class, 'getMeUsageResets'])->name('v10.getMeUsageResets');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/usage-resets/consumptions', [\App\Http\Controllers\V10\UserUsageResetController::class, 'postMeUsageResetsConsumptions'])->middleware(['throttle:20,1'])->name('v10.postMeUsageResetsConsumptions');
\Illuminate\Support\Facades\Route::delete('me/sessions', [\App\Http\Controllers\V10\UserUserController::class, 'deleteMeSessions'])->middleware(['throttle:10,1'])->name('v10.deleteMeSessions');
\Illuminate\Support\Facades\Route::match(['DELETE'], 'me/session', [\App\Http\Controllers\V10\UserUserController::class, 'deleteMeSession'])->name('v10.deleteMeSession');
\Illuminate\Support\Facades\Route::match(['DELETE'], 'me/integrations/telegram', [\App\Http\Controllers\V10\UserUserController::class, 'deleteMeIntegrationsTelegram'])->name('v10.deleteMeIntegrationsTelegram');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/subscription/credential-rotations', [\App\Http\Controllers\V10\UserUserController::class, 'postMeSubscriptionCredentialRotations'])->name('v10.postMeSubscriptionCredentialRotations');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me', [\App\Http\Controllers\V10\UserUserController::class, 'getMe'])->name('v10.getMe');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/subscription/period-advances', [\App\Http\Controllers\V10\UserUserController::class, 'postMeSubscriptionPeriodAdvances'])->name('v10.postMeSubscriptionPeriodAdvances');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/gift-card-redemptions', [\App\Http\Controllers\V10\UserUserController::class, 'postMeGiftCardRedemptions'])->name('v10.postMeGiftCardRedemptions');
\Illuminate\Support\Facades\Route::match(['PATCH'], 'me/password', [\App\Http\Controllers\V10\UserUserController::class, 'patchMePassword'])->name('v10.patchMePassword');
\Illuminate\Support\Facades\Route::match(['PATCH'], 'me', [\App\Http\Controllers\V10\UserUserController::class, 'patchMe'])->name('v10.patchMe');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/subscription', [\App\Http\Controllers\V10\UserUserController::class, 'getMeSubscription'])->name('v10.getMeSubscription');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/summary', [\App\Http\Controllers\V10\UserUserController::class, 'getMeSummary'])->name('v10.getMeSummary');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/session', [\App\Http\Controllers\V10\UserUserController::class, 'getMeSession'])->name('v10.getMeSession');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/commission-transfers', [\App\Http\Controllers\V10\UserUserController::class, 'postMeCommissionTransfers'])->name('v10.postMeCommissionTransfers');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/login-links', [\App\Http\Controllers\V10\UserUserController::class, 'postMeLoginLinks'])->name('v10.postMeLoginLinks');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/sessions', [\App\Http\Controllers\V10\UserUserController::class, 'getMeSessions'])->name('v10.getMeSessions');
\Illuminate\Support\Facades\Route::match(['DELETE'], 'me/sessions/{sessionId}', [\App\Http\Controllers\V10\UserUserController::class, 'deleteMeSessionsSessionId'])->name('v10.deleteMeSessionsSessionId');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/orders', [\App\Http\Controllers\V10\UserOrderController::class, 'postMeOrders'])->name('v10.postMeOrders');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/orders/{orderNumber}/payments', [\App\Http\Controllers\V10\UserOrderController::class, 'postMeOrdersOrderNumberPayments'])->name('v10.postMeOrdersOrderNumberPayments');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/orders/{orderNumber}/status', [\App\Http\Controllers\V10\UserOrderController::class, 'getMeOrdersOrderNumberStatus'])->name('v10.getMeOrdersOrderNumberStatus');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/orders/{orderNumber}', [\App\Http\Controllers\V10\UserOrderController::class, 'getMeOrdersOrderNumber'])->name('v10.getMeOrdersOrderNumber');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/orders', [\App\Http\Controllers\V10\UserOrderController::class, 'getMeOrders'])->name('v10.getMeOrders');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'payment-methods', [\App\Http\Controllers\V10\UserOrderController::class, 'getPaymentMethods'])->name('v10.getPaymentMethods');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/orders/{orderNumber}/cancellation', [\App\Http\Controllers\V10\UserOrderController::class, 'postMeOrdersOrderNumberCancellation'])->name('v10.postMeOrdersOrderNumberCancellation');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'credit-packages', [\App\Http\Controllers\V10\UserPlanController::class, 'getCreditPackages'])->name('v10.getCreditPackages');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'plans', [\App\Http\Controllers\V10\UserPlanController::class, 'getPlans'])->name('v10.getPlans');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/referrals', [\App\Http\Controllers\V10\UserInviteController::class, 'getMeReferrals'])->name('v10.getMeReferrals');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/commissions', [\App\Http\Controllers\V10\UserInviteController::class, 'getMeCommissions'])->name('v10.getMeCommissions');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/invitations', [\App\Http\Controllers\V10\UserInviteController::class, 'postMeInvitations'])->middleware(['throttle:10,1'])->name('v10.postMeInvitations');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/invitations', [\App\Http\Controllers\V10\UserInviteController::class, 'getMeInvitations'])->name('v10.getMeInvitations');
\Illuminate\Support\Facades\Route::post('me/notifications/ticket-read-receipts', [\App\Http\Controllers\V10\UserNoticeController::class, 'postMeTicketReadReceipts'])->middleware(['throttle:120,1'])->name('v10.postMeTicketReadReceipts');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/notifications', [\App\Http\Controllers\V10\UserNoticeController::class, 'getMeNotifications'])->name('v10.getMeNotifications');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/notifications/read-receipts', [\App\Http\Controllers\V10\UserNoticeController::class, 'postMeNotificationsReadReceipts'])->middleware(['throttle:120,1'])->name('v10.postMeNotificationsReadReceipts');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'announcements', [\App\Http\Controllers\V10\UserNoticeController::class, 'getAnnouncements'])->name('v10.getAnnouncements');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/tickets/{ticketId}/messages', [\App\Http\Controllers\V10\UserTicketController::class, 'postMeTicketsTicketIdMessages'])->name('v10.postMeTicketsTicketIdMessages');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/tickets/{ticketId}/closure', [\App\Http\Controllers\V10\UserTicketController::class, 'postMeTicketsTicketIdClosure'])->name('v10.postMeTicketsTicketIdClosure');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/tickets', [\App\Http\Controllers\V10\UserTicketController::class, 'postMeTickets'])->name('v10.postMeTickets');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/tickets', [\App\Http\Controllers\V10\UserTicketController::class, 'getMeTickets'])->name('v10.getMeTickets');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/commission-withdrawals', [\App\Http\Controllers\V10\UserTicketController::class, 'postMeCommissionWithdrawals'])->name('v10.postMeCommissionWithdrawals');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/nodes', [\App\Http\Controllers\V10\UserServerController::class, 'getMeNodes'])->name('v10.getMeNodes');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/node-previews', [\App\Http\Controllers\V10\UserServerController::class, 'getMeNodePreviews'])->name('v10.getMeNodePreviews');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/integrations/telegram', [\App\Http\Controllers\V10\UserTelegramController::class, 'getMeIntegrationsTelegram'])->name('v10.getMeIntegrationsTelegram');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/preferences/options', [\App\Http\Controllers\V10\UserCommController::class, 'getMePreferencesOptions'])->name('v10.getMePreferencesOptions');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'payment-methods/{paymentId}/public-key', [\App\Http\Controllers\V10\UserCommController::class, 'getPaymentMethodsPaymentIdPublicKey'])->name('v10.getPaymentMethodsPaymentIdPublicKey');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'knowledge-articles', [\App\Http\Controllers\V10\UserKnowledgeController::class, 'getKnowledgeArticles'])->name('v10.getKnowledgeArticles');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'knowledge-categories', [\App\Http\Controllers\V10\UserKnowledgeController::class, 'getKnowledgeCategories'])->name('v10.getKnowledgeCategories');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/traffic-records', [\App\Http\Controllers\V10\UserStatController::class, 'getMeTrafficRecords'])->name('v10.getMeTrafficRecords');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/tickets/{ticketId}', [\App\Http\Controllers\V10\UserTicketController::class, 'getMeTicketsTicketId'])->name('v10.getMeTicketsTicketId');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'knowledge-articles/{articleId}', [\App\Http\Controllers\V10\UserKnowledgeController::class, 'getKnowledgeArticlesArticleId'])->name('v10.getKnowledgeArticlesArticleId');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'plans/{planId}', [\App\Http\Controllers\V10\UserPlanController::class, 'getPlansPlanId'])->name('v10.getPlansPlanId');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'announcements/{notificationId}', [\App\Http\Controllers\V10\UserNoticeController::class, 'getAnnouncementsNotificationId'])->name('v10.getAnnouncementsNotificationId');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'public/client-installers/{installerId}/content', [\App\Http\Controllers\V10\PublicMirrorController::class, 'getPublicClientInstallersInstallerIdContent'])->name('v10.getPublicClientInstallersInstallerIdContent');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/client-config', [\App\Http\Controllers\V10\ClientClientController::class, 'getMeClientConfig'])->middleware(['throttle:30,1'])->name('v10.getMeClientConfig');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'public/fastai/releases/latest', [\App\Http\Controllers\V10\GuestFastaiController::class, 'getPublicFastaiReleasesLatest'])->middleware(['throttle:30,1'])->name('v10.getPublicFastaiReleasesLatest');
\Illuminate\Support\Facades\Route::match(['POST'], 'auth/client-authorizations', [\App\Http\Controllers\V10\PassportClientAuthorizationController::class, 'postAuthClientAuthorizations'])->middleware(['throttle:20,1'])->name('v10.postAuthClientAuthorizations');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'me/client-authorizations/{authorizationId}', [\App\Http\Controllers\V10\PassportClientAuthorizationController::class, 'getMeClientAuthorizationsAuthorizationId'])->middleware(['throttle:30,1'])->name('v10.getMeClientAuthorizationsAuthorizationId');
\Illuminate\Support\Facades\Route::match(['POST'], 'me/client-authorizations/{authorizationId}/approval', [\App\Http\Controllers\V10\PassportClientAuthorizationController::class, 'postMeClientAuthorizationsAuthorizationIdApproval'])->middleware(['throttle:30,1'])->name('v10.postMeClientAuthorizationsAuthorizationIdApproval');
\Illuminate\Support\Facades\Route::match(['POST'], 'auth/client-session-exchanges', [\App\Http\Controllers\V10\PassportClientAuthorizationController::class, 'postAuthClientSessionExchanges'])->middleware(['throttle:20,1'])->name('v10.postAuthClientSessionExchanges');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'auth/browser-session', [\App\Http\Controllers\V10\PassportBrowserSessionController::class, 'getAuthBrowserSession'])->middleware(['throttle:30,1'])->name('v10.getAuthBrowserSession');
\Illuminate\Support\Facades\Route::match(['DELETE'], 'auth/browser-session', [\App\Http\Controllers\V10\PassportBrowserSessionController::class, 'deleteAuthBrowserSession'])->middleware(['throttle:30,1'])->name('v10.deleteAuthBrowserSession');
\Illuminate\Support\Facades\Route::match(['GET', 'HEAD'], 'public/fastai/entrypoints', [\App\Http\Controllers\V10\GuestFastaiController::class, 'getPublicFastaiEntrypoints'])->middleware(['throttle:60,1'])->name('v10.getPublicFastaiEntrypoints');

// Node machine API: independent bearer authentication; legacy V2Node remains supported.
\Illuminate\Support\Facades\Route::get('server/target-statistics/policy', [\App\Http\Controllers\V10\NodeController::class, 'targetStatisticsPolicy'])->middleware(\App\Http\Middleware\NodeV10::class)->name('v10.server.targetStatisticsPolicy');
\Illuminate\Support\Facades\Route::post('server/target-statistics', [\App\Http\Controllers\V10\NodeController::class, 'targetStatistics'])->middleware([\App\Http\Middleware\NodeV10::class,\App\Http\Middleware\NodeTargetStatistics::class])->name('v10.server.targetStatistics');
\Illuminate\Support\Facades\Route::get('server/configuration', [\App\Http\Controllers\V10\NodeController::class, 'configuration'])->middleware(\App\Http\Middleware\NodeV10::class)->name('v10.server.configuration');
\Illuminate\Support\Facades\Route::get('server/users', [\App\Http\Controllers\V10\NodeController::class, 'users'])->middleware(\App\Http\Middleware\NodeV10::class)->name('v10.server.users');
\Illuminate\Support\Facades\Route::get('server/online-counts', [\App\Http\Controllers\V10\NodeController::class, 'onlineCounts'])->middleware(\App\Http\Middleware\NodeV10::class)->name('v10.server.onlineCounts');
\Illuminate\Support\Facades\Route::post('server/traffic', [\App\Http\Controllers\V10\NodeController::class, 'traffic'])->middleware(\App\Http\Middleware\NodeV10::class)->name('v10.server.traffic');
\Illuminate\Support\Facades\Route::post('server/online-users', [\App\Http\Controllers\V10\NodeController::class, 'onlineUsers'])->middleware(\App\Http\Middleware\NodeV10::class)->name('v10.server.onlineUsers');
\Illuminate\Support\Facades\Route::post('server/capabilities', [\App\Http\Controllers\V10\NodeController::class, 'capabilities'])->middleware(\App\Http\Middleware\NodeV10::class)->name('v10.server.capabilities');

\Illuminate\Support\Facades\Route::post('/server/addresses', [\App\Http\Controllers\V10\NodeAddressController::class, 'store'])->middleware('throttle:12,1')->name('nodeAddresses');

\Illuminate\Support\Facades\Route::get('server/traffic-budget', [\App\Http\Controllers\V10\NodeController::class, 'trafficBudget'])->middleware(\App\Http\Middleware\NodeV10::class)->name('v10.server.trafficBudget');

\Illuminate\Support\Facades\Route::post('me/diagnostic-reports', [\App\Http\Controllers\V10\UserDiagnosticController::class, 'postMeDiagnosticReports'])->middleware(['throttle:20,1'])->name('v10.postMeDiagnosticReports');

\Illuminate\Support\Facades\Route::post('me/client-events', [\App\Http\Controllers\V10\UserDiagnosticController::class, 'postMeClientEvents'])->middleware(['throttle:20,1'])->name('v10.postMeClientEvents');

\Illuminate\Support\Facades\Route::post('me/integrations/telegram/binding-links', [\App\Http\Controllers\V10\UserTelegramController::class, 'postMeIntegrationsTelegramBindingLinks'])->middleware(['throttle:6,1'])->name('v10.postMeIntegrationsTelegramBindingLinks');

\Illuminate\Support\Facades\Route::post('me/integrations/telegram/confirmation', [\App\Http\Controllers\V10\UserTelegramController::class, 'postMeIntegrationsTelegramConfirmation'])->middleware(['throttle:6,1'])->name('v10.postMeIntegrationsTelegramConfirmation');

\Illuminate\Support\Facades\Route::post('me/integrations/telegram/group-invitations', [\App\Http\Controllers\V10\UserTelegramController::class, 'postMeIntegrationsTelegramGroupInvitations'])->middleware(['throttle:6,1'])->name('v10.postMeIntegrationsTelegramGroupInvitations');

\Illuminate\Support\Facades\Route::post('webhooks/mail/{provider}', [\App\Http\Controllers\V10\MailController::class,'webhook'])->where('provider','mailgun|resend|ses')->middleware('throttle:600,1')->name('v10.postWebhooksMailProvider');
\Illuminate\Support\Facades\Route::get('mail/unsubscribe/{token}', [\App\Http\Controllers\V10\MailController::class,'unsubscribe'])->middleware('throttle:60,1')->name('v10.getMailUnsubscribeToken');
\Illuminate\Support\Facades\Route::post('mail/unsubscribe/{token}', [\App\Http\Controllers\V10\MailController::class,'unsubscribe'])->middleware('throttle:60,1')->name('v10.postMailUnsubscribeToken');
\Illuminate\Support\Facades\Route::get('me/coupons', [\App\Http\Controllers\V10\UserCouponController::class, 'getMeCoupons'])->middleware(['throttle:30,1'])->name('v10.getMeCoupons');
\Illuminate\Support\Facades\Route::get('me/coupon-offers', [\App\Http\Controllers\V10\UserCouponController::class, 'getMeCouponOffers'])->middleware(['throttle:30,1'])->name('v10.getMeCouponOffers');
\Illuminate\Support\Facades\Route::post('me/coupon-claims', [\App\Http\Controllers\V10\UserCouponController::class, 'postMeCouponClaims'])->middleware(['throttle:30,1'])->name('v10.postMeCouponClaims');

\Illuminate\Support\Facades\Route::get('me/security/mfa', [\App\Http\Controllers\V10\MfaController::class, 'state'])->name('v10.getMeMfa');
\Illuminate\Support\Facades\Route::post('me/security/mfa/challenges', [\App\Http\Controllers\V10\MfaController::class, 'start'])->middleware('throttle:10,1')->name('v10.postMeMfaChallenges');
\Illuminate\Support\Facades\Route::post('auth/mfa/emails', [\App\Http\Controllers\V10\MfaController::class, 'sendEmail'])->middleware('throttle:10,1')->name('v10.postMfaEmails');
\Illuminate\Support\Facades\Route::post('auth/mfa/verifications', [\App\Http\Controllers\V10\MfaController::class, 'finish'])->middleware('throttle:30,1')->name('v10.postMfaVerifications');

// Passkey ceremonies retain browser CSRF and scoped HttpOnly session grants.
\Illuminate\Support\Facades\Route::get('me/security/passkeys', [\App\Http\Controllers\V10\PasskeyController::class, 'state'])->middleware('throttle:10,1,passkey:')->name('v10.getMePasskeys');
\Illuminate\Support\Facades\Route::post('me/security/passkeys/registration-options', [\App\Http\Controllers\V10\PasskeyController::class, 'options'])->middleware('throttle:10,1,passkey:')->name('v10.postMePasskeyRegistrationOptions');
\Illuminate\Support\Facades\Route::post('me/security/passkeys', [\App\Http\Controllers\V10\PasskeyController::class, 'store'])->middleware('throttle:10,1,passkey:')->name('v10.postMePasskeys');
\Illuminate\Support\Facades\Route::delete('me/security/passkeys/{passkeyId}', [\App\Http\Controllers\V10\PasskeyController::class, 'remove'])->middleware('throttle:10,1,passkey:')->name('v10.deleteMePasskey');
\Illuminate\Support\Facades\Route::post('auth/passkeys/options', [\App\Http\Controllers\V10\PasskeyController::class, 'loginOptions'])->middleware('throttle:10,1,passkey:')->name('v10.postAuthPasskeyOptions');
\Illuminate\Support\Facades\Route::post('auth/passkeys/sessions', [\App\Http\Controllers\V10\PasskeyController::class, 'login'])->middleware('throttle:10,1,passkey:')->name('v10.postAuthPasskeySessions');

\Illuminate\Support\Facades\Route::get('me/account-deletion', [\App\Http\Controllers\V10\AccountDeletionController::class,'state'])->name('v10.getMeAccountDeletion');
\Illuminate\Support\Facades\Route::delete('me', [\App\Http\Controllers\V10\AccountDeletionController::class,'remove'])->middleware('throttle:10,1,account-deletion:')->name('v10.deleteMe');

\Illuminate\Support\Facades\Route::get('public/node-deployment/bootstrap', [\App\Http\Controllers\V10\NodeDeploymentController::class,'bootstrap'])->middleware('throttle:30,1,node-bootstrap:')->name('v10.nodeDeployment.bootstrap');
\Illuminate\Support\Facades\Route::post('server/enrollments/redeem', [\App\Http\Controllers\V10\NodeDeploymentController::class,'redeem'])->middleware('throttle:60,1,node-enrollment:')->name('v10.nodeDeployment.redeem');
\Illuminate\Support\Facades\Route::post('server/enrollments/progress', [\App\Http\Controllers\V10\NodeDeploymentController::class,'progress'])->middleware('throttle:120,1,node-deployment-progress:')->name('v10.nodeDeployment.progress');
