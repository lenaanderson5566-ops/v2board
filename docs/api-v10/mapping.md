# Legacy → V10 mapping

Admin, operations/risk, staff and node APIs retain all existing paths and schemas. Legacy symbols are historical mappings, not a list of callable routes. Only the explicit retained-endpoints allowlist remains callable. See contracts.json for exact field projections.

| Existing symbol | V10 method and path | Permission | Resource |
|---|---|---|---|
| `GET client/subscribe` | `GET /api/v10/subscriptions/{subscriptionToken}` | subscription | scalar |
| `GET client/app/getConfig` | `GET /api/v10/subscriptions/{subscriptionToken}/application-config` | subscription | scalar |
| `GET client/app/getVersion` | `GET /api/v10/subscriptions/{subscriptionToken}/application-version` | subscription | applicationVersion |
| `POST guest/telegram/webhook` | `POST /api/v10/webhooks/telegram` | public | scalar |
| `GET guest/payment/notify/{method}/{uuid}` | `GET /api/v10/webhooks/payments/{provider}/{endpointId}` | public | scalar |
| `GET guest/banner/fetch` | `GET /api/v10/public/banners` | public | array:banner |
| `GET guest/banner/image/{name}` | `GET /api/v10/public/banner-images/{name}` | public | scalar |
| `GET guest/comm/config` | `GET /api/v10/public/settings` | public | publicSettings |
| `POST passport/auth/register` | `POST /api/v10/auth/registrations` | public | authentication |
| `POST passport/auth/login` | `POST /api/v10/auth/sessions` | public | authentication |
| `GET passport/auth/token2Login` | `POST /api/v10/auth/session-exchanges` | public | authentication |
| `POST passport/auth/forget` | `POST /api/v10/auth/password-resets` | public | scalar |
| `POST passport/auth/getQuickLoginUrl` | `POST /api/v10/auth/login-links` | user | scalar |
| `POST passport/comm/sendEmailVerify` | `POST /api/v10/auth/email-verifications` | public | task |
| `POST passport/comm/pv` | `POST /api/v10/public/page-views` | public | scalar |
| `GET user/apple-account` | `GET /api/v10/me/download-accounts` | user | array:apple |
| `GET user/usage/reset` | `GET /api/v10/me/usage-resets` | user | reset |
| `POST user/usage/reset` | `POST /api/v10/me/usage-resets/consumptions` | user | resetResult |
| `POST user/logout` | `DELETE /api/v10/me/session` | user | scalar |
| `GET user/unbindTelegram` | `DELETE /api/v10/me/integrations/telegram` | user | scalar |
| `POST user/resetSecurity` | `POST /api/v10/me/subscription/credential-rotations` | user | scalar |
| `GET user/info` | `GET /api/v10/me` | user | account |
| `POST user/newPeriod` | `POST /api/v10/me/subscription/period-advances` | user | scalar |
| `POST user/redeemgiftcard` | `POST /api/v10/me/gift-card-redemptions` | user | scalar |
| `POST user/changePassword` | `PATCH /api/v10/me/password` | user | scalar |
| `POST user/update` | `PATCH /api/v10/me` | user | scalar |
| `GET user/getSubscribe` | `GET /api/v10/me/subscription` | user | subscription |
| `GET user/getStat` | `GET /api/v10/me/summary` | user | summary |
| `GET user/checkLogin` | `GET /api/v10/me/session` | user | loginState |
| `POST user/transfer` | `POST /api/v10/me/commission-transfers` | user | scalar |
| `POST user/getQuickLoginUrl` | `POST /api/v10/me/login-links` | user | scalar |
| `GET user/getActiveSession` | `GET /api/v10/me/sessions` | user | dictionary:session |
| `POST user/removeActiveSession` | `DELETE /api/v10/me/sessions/{sessionId}` | user | scalar |
| `POST user/order/save` | `POST /api/v10/me/orders` | user | orderCreated |
| `POST user/order/checkout` | `POST /api/v10/me/orders/{orderNumber}/payments` | user | payment |
| `GET user/order/check` | `GET /api/v10/me/orders/{orderNumber}/status` | user | orderStatus |
| `GET user/order/detail` | `GET /api/v10/me/orders/{orderNumber}` | user | order |
| `GET user/order/fetch` | `GET /api/v10/me/orders` | user | array:order |
| `GET user/order/getPaymentMethod` | `GET /api/v10/payment-methods` | user | array:paymentMethod |
| `POST user/order/cancel` | `POST /api/v10/me/orders/{orderNumber}/cancellation` | user | scalar |
| `GET user/credit/fetch` | `GET /api/v10/credit-packages` | user | array:credit |
| `GET user/plan/fetch` | `GET /api/v10/plans` | user | flex:plan |
| `GET user/invite/save` | `POST /api/v10/me/invitations/retired-codes` | user | scalar |
| `GET user/invite/fetch` | `GET /api/v10/me/referrals` | user | referrals |
| `GET user/invite/details` | `GET /api/v10/me/commissions` | user | array:commission |
| `POST user/invite/email/send` | `POST /api/v10/me/invitations` | user | invitation |
| `GET user/invite/email/fetch` | `GET /api/v10/me/invitations` | user | array:invitation |
| `GET user/notice/inbox` | `GET /api/v10/me/notifications` | user | inbox |
| `POST user/notice/read` | `POST /api/v10/me/notifications/read-receipts` | user | scalar |
| `GET user/notice/fetch` | `GET /api/v10/announcements` | user | flex:notification |
| `POST user/ticket/reply` | `POST /api/v10/me/tickets/{ticketId}/messages` | user | scalar |
| `POST user/ticket/close` | `POST /api/v10/me/tickets/{ticketId}/closure` | user | scalar |
| `POST user/ticket/save` | `POST /api/v10/me/tickets` | user | ticket |
| `GET user/ticket/fetch` | `GET /api/v10/me/tickets` | user | flex:ticket |
| `POST user/ticket/withdraw` | `POST /api/v10/me/commission-withdrawals` | user | ticket |
| `GET user/server/fetch` | `GET /api/v10/me/nodes` | user | array:node |
| `POST user/coupon/check` | `POST /api/v10/me/coupon-validations` | user | coupon |
| `GET user/telegram/getBotInfo` | `GET /api/v10/me/integrations/telegram` | user | bot |
| `GET user/comm/config` | `GET /api/v10/me/preferences/options` | user | preferences |
| `POST user/comm/getStripePublicKey` | `GET /api/v10/payment-methods/{paymentId}/public-key` | user | scalar |
| `GET user/knowledge/fetch` | `GET /api/v10/knowledge-articles` | user | articles |
| `GET user/knowledge/getCategory` | `GET /api/v10/knowledge-categories` | user | strings |
| `GET user/stat/getTrafficLog` | `GET /api/v10/me/traffic-records` | user | array:traffic |
| `GET user/ticket/fetch` | `GET /api/v10/me/tickets/{ticketId}` | user | flex:ticket |
| `GET user/knowledge/fetch` | `GET /api/v10/knowledge-articles/{articleId}` | user | articles |
| `GET user/plan/fetch` | `GET /api/v10/plans/{planId}` | user | flex:plan |
| `GET user/notice/fetch` | `GET /api/v10/announcements/{notificationId}` | user | flex:notification |
| `New native resource` | `GET /api/v10/public/client-installers/{installerId}/content` | public | scalar |
| `New native resource` | `GET /api/v10/me/client-config` | user | scalar |
| `New native resource` | `GET /api/v10/public/fastai/releases/latest` | public | fastaiRelease |
| `New native resource` | `POST /api/v10/auth/client-authorizations` | public | clientAuthorization |
| `New native resource` | `GET /api/v10/me/client-authorizations/{authorizationId}` | user | clientAuthorizationDetails |
| `New native resource` | `POST /api/v10/me/client-authorizations/{authorizationId}/approval` | user | clientAuthorizationApproval |
| `New native resource` | `POST /api/v10/auth/client-session-exchanges` | public | authentication |
| `New native resource` | `GET /api/v10/auth/browser-session` | public | browserSession |
| `New native resource` | `POST /api/v10/auth/browser-session` | public | browserSession |
| `New native resource` | `DELETE /api/v10/auth/browser-session` | public | scalar |
| `New native resource` | `GET /api/v10/public/fastai/entrypoints` | public | signedEntrypoints |
