# 后台之外的保留接口

此清单由实际注册路由生成：`php tests/api-route-audit.php --write-inventory`。不包含 V10 新接口、管理/风控/客服后台接口。GET 路由同时支持 HEAD，表中省略 HEAD。旧接口不设自动停用日期；保留不代表推荐新功能继续使用。

## 旧登录与注册接口（7 条路由）

| 方法 | 保留路径 | V10 对应入口 |
|---|---|---|
| POST | `/api/v1/passport/auth/register` | POST /api/v10/auth/registrations |
| POST | `/api/v1/passport/auth/login` | POST /api/v10/auth/sessions |
| GET | `/api/v1/passport/auth/token2Login` | POST /api/v10/auth/session-exchanges |
| POST | `/api/v1/passport/auth/forget` | POST /api/v10/auth/password-resets |
| POST | `/api/v1/passport/auth/getQuickLoginUrl` | POST /api/v10/auth/login-links |
| POST | `/api/v1/passport/comm/sendEmailVerify` | POST /api/v10/auth/email-verifications |
| POST | `/api/v1/passport/comm/pv` | POST /api/v10/public/page-views |

## 旧用户接口（49 条路由）

| 方法 | 保留路径 | V10 对应入口 |
|---|---|---|
| GET | `/api/v1/user/apple-account` | GET /api/v10/me/download-accounts |
| GET | `/api/v1/user/usage/reset` | GET /api/v10/me/usage-resets |
| POST | `/api/v1/user/usage/reset` | POST /api/v10/me/usage-resets/consumptions |
| POST | `/api/v1/user/logout` | DELETE /api/v10/me/session |
| GET | `/api/v1/user/unbindTelegram` | DELETE /api/v10/me/integrations/telegram |
| GET | `/api/v1/user/resetSecurity` | POST /api/v10/me/subscription/credential-rotations |
| POST | `/api/v1/user/resetSecurity` | POST /api/v10/me/subscription/credential-rotations |
| GET | `/api/v1/user/info` | GET /api/v10/me |
| POST | `/api/v1/user/newPeriod` | POST /api/v10/me/subscription/period-advances |
| POST | `/api/v1/user/redeemgiftcard` | POST /api/v10/me/gift-card-redemptions |
| POST | `/api/v1/user/changePassword` | PATCH /api/v10/me/password |
| POST | `/api/v1/user/update` | PATCH /api/v10/me |
| GET | `/api/v1/user/getSubscribe` | GET /api/v10/me/subscription |
| GET | `/api/v1/user/getStat` | GET /api/v10/me/summary |
| GET | `/api/v1/user/checkLogin` | GET /api/v10/me/session |
| POST | `/api/v1/user/transfer` | POST /api/v10/me/commission-transfers |
| POST | `/api/v1/user/getQuickLoginUrl` | POST /api/v10/me/login-links |
| GET | `/api/v1/user/getActiveSession` | GET /api/v10/me/sessions |
| POST | `/api/v1/user/removeActiveSession` | DELETE /api/v10/me/sessions/{sessionId} |
| POST | `/api/v1/user/order/save` | POST /api/v10/me/orders |
| POST | `/api/v1/user/order/checkout` | POST /api/v10/me/orders/{orderNumber}/payments |
| GET | `/api/v1/user/order/check` | GET /api/v10/me/orders/{orderNumber}/status |
| GET | `/api/v1/user/order/detail` | GET /api/v10/me/orders/{orderNumber} |
| GET | `/api/v1/user/order/fetch` | GET /api/v10/me/orders |
| GET | `/api/v1/user/order/getPaymentMethod` | GET /api/v10/payment-methods |
| POST | `/api/v1/user/order/cancel` | POST /api/v10/me/orders/{orderNumber}/cancellation |
| GET | `/api/v1/user/credit/fetch` | GET /api/v10/credit-packages |
| GET | `/api/v1/user/plan/fetch` | GET /api/v10/plans<br>GET /api/v10/plans/{planId} |
| GET | `/api/v1/user/invite/save` | POST /api/v10/me/invitations/retired-codes |
| GET | `/api/v1/user/invite/fetch` | GET /api/v10/me/referrals |
| GET | `/api/v1/user/invite/details` | GET /api/v10/me/commissions |
| POST | `/api/v1/user/invite/email/send` | POST /api/v10/me/invitations |
| GET | `/api/v1/user/invite/email/fetch` | GET /api/v10/me/invitations |
| GET | `/api/v1/user/notice/inbox` | GET /api/v10/me/notifications |
| POST | `/api/v1/user/notice/read` | POST /api/v10/me/notifications/read-receipts |
| GET | `/api/v1/user/notice/fetch` | GET /api/v10/announcements<br>GET /api/v10/announcements/{notificationId} |
| POST | `/api/v1/user/ticket/reply` | POST /api/v10/me/tickets/{ticketId}/messages |
| POST | `/api/v1/user/ticket/close` | POST /api/v10/me/tickets/{ticketId}/closure |
| POST | `/api/v1/user/ticket/save` | POST /api/v10/me/tickets |
| GET | `/api/v1/user/ticket/fetch` | GET /api/v10/me/tickets<br>GET /api/v10/me/tickets/{ticketId} |
| POST | `/api/v1/user/ticket/withdraw` | POST /api/v10/me/commission-withdrawals |
| GET | `/api/v1/user/server/fetch` | GET /api/v10/me/nodes |
| POST | `/api/v1/user/coupon/check` | POST /api/v10/me/coupon-validations |
| GET | `/api/v1/user/telegram/getBotInfo` | GET /api/v10/me/integrations/telegram |
| GET | `/api/v1/user/comm/config` | GET /api/v10/me/preferences/options |
| POST | `/api/v1/user/comm/getStripePublicKey` | GET /api/v10/payment-methods/{paymentId}/public-key |
| GET | `/api/v1/user/knowledge/fetch` | GET /api/v10/knowledge-articles<br>GET /api/v10/knowledge-articles/{articleId} |
| GET | `/api/v1/user/knowledge/getCategory` | GET /api/v10/knowledge-categories |
| GET | `/api/v1/user/stat/getTrafficLog` | GET /api/v10/me/traffic-records |

## 旧公共接口与回调（5 条路由）

| 方法 | 保留路径 | V10 对应入口 |
|---|---|---|
| POST | `/api/v1/guest/telegram/webhook` | POST /api/v10/webhooks/telegram |
| GET/POST | `/api/v1/guest/payment/notify/{method}/{uuid}` | GET/POST /api/v10/webhooks/payments/{provider}/{endpointId} |
| GET | `/api/v1/guest/banner/fetch` | GET /api/v10/public/banners |
| GET | `/api/v1/guest/banner/image/{name}` | GET /api/v10/public/banner-images/{name} |
| GET | `/api/v1/guest/comm/config` | GET /api/v10/public/settings |

## 旧订阅与客户端接口（3 条路由）

| 方法 | 保留路径 | V10 对应入口 |
|---|---|---|
| GET | `/api/v1/client/subscribe` | GET /api/v10/subscriptions/{subscriptionToken} |
| GET | `/api/v1/client/app/getConfig` | GET /api/v10/subscriptions/{subscriptionToken}/application-config |
| GET | `/api/v1/client/app/getVersion` | GET /api/v10/subscriptions/{subscriptionToken}/application-version |

## 节点通信（继续使用，不迁移）

V1 实际注册通配路由 `/api/v1/server/{class}/{action}`，支持 GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS。下表列出当前控制器自身声明的业务方法，不代表新增静态路由，也不包括构造函数或框架继承方法。认证仍由各节点控制器校验节点凭证。

| 控制器段 | 业务 action |
|---|---|
| `deepbwork` | `user`, `submit`, `config` |
| `shadowsocksTidalab` | `user`, `submit` |
| `trojanTidalab` | `user`, `submit`, `config` |
| `uniProxy` | `user`, `push`, `alivelist`, `alive`, `config` |

V2 保留 `/api/v2/server/config`（同样接受以上方法），使用节点 token 和 node_id；当前没有 V2 用户接口。

## 其他保留入口

| 方法 | 路径 | 用途与条件 |
|---|---|---|
| GET/HEAD | 管理员配置的 `subscribe_path` | 自定义订阅路径，使用原 token 规则；与默认旧路径及 V10 同时可用 |
| GET/HEAD | `/client-mirrors/{id}` | 已发布安装包文件下载，UUID 标识，无 JSON 包装 |

`/` 与 `/app` 是网页入口而非 API，也继续保留。后台安全路径、运营路径和客服 `/api/v1/staff/*` 不在本清单范围内。

## 兼容说明

- 上表旧用户/登录/公共/客户端路由共 64 条；前端用户业务已通过集中传输层使用 V10，旧入口保留给历史版本和已有链接。
- 旧 `invite/save` 保留原来的 410（功能已退役），不代表恢复邀请码注册。
- 支付与 Telegram 的旧回调继续验证原签名并返回供应商要求的响应；新生成地址使用 V10。
- 旧接口中的 GET 写操作保持历史契约；对应 V10 已使用 POST/DELETE，不应在新调用中继续使用旧 GET。
- 原节点动态分发属于明确保留的历史协议，未将这种设计带入 V10。
