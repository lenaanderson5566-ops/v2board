# Legacy → V10 mapping

Browser `POST /auth/registrations` grants a scoped HttpOnly cookie and returns only `browserSession` metadata; native registration retains `authentication` Bearer output. Browser registration requires the same CSRF and exact Origin checks as login. All authenticated user resources, including `/me`, plans and knowledge articles, return `Cache-Control: private, no-store`. Resource ownership always comes from the verified session and path binding, never from caller-supplied user/role fields.

Payment methods expose category (regular/crypto), asset, assetIconUrl, network, networkName and networkIconUrl. Existing channels default to regular. No provider config or credentials are exposed; paymentMethodId remains the channel identifier. Order-currency fees and channel payment amount/currency come from server quotes and saved snapshots; CNY and USD are supported as described below.

Account notification preference: `GET/PATCH /me` exposes boolean `serviceNotifications`, mapped to shared `remind_service` (default true).

Admin, operations/risk and supported node APIs retain their API versions. The unfinished staff API is retired. Retired standalone node management and communication routes are removed as described below. Legacy symbols are historical mappings, not a list of callable routes. Only the explicit retained-endpoints allowlist remains callable. See contracts.json for exact field projections.

Unified subscription checkout adds `POST /api/v10/me/checkout-quotes`, explicitly routed to the V10 order controller and shared read-only order preparation. It has no legacy HTTP endpoint. The browser alias `user/order/quote` is an internal transport key only. Order creation accepts a bound quote plus UUID request key; payment initiation accepts its own UUID request key. Existing request bodies remain compatible when these optional fields are absent.

Plan resources add optional read-only `effectiveResetMethod` (0–4 or null), mapped to `effective_reset_traffic_method`. It resolves `resetMethod=null` through `v2board.reset_traffic_method` with default 0, matching the traffic reset scheduler. Explicit plan policies take precedence, including 0; unsupported values project null. The stored `resetMethod` remains unchanged, including its inheritance meaning. The same projection applies to catalog/detail and embedded plan resources; reads do not update plans, calculate future reset dates, or change entitlement/reset behavior.
Optional analytics adds `payment_open` only for explicit payment-entry clicks. It carries the existing anonymous page/device/session envelope, never payment URLs, order identifiers, amounts or channel data; it does not assert app opening/payment success or advance page views/purchase funnels. Existing consent, GPC/DNT, retention and sampling limits apply.


<!-- operation-table -->

V2Box support: administrative `server/v2box/{save,update,copy,drop}` routes use the existing admin prefix. Node config `/api/v2/server/config` and retained UniProxy endpoints accept `node_type=v2box`. V10 subscription paths and resource shapes are unchanged; node identities use `v2box` exclusively. See [V2Box integration](../v2box.md).

Naive is a V2Box-only protocol value on the same routes/table. V10 subscriptions export sing-box Naive outbounds or General naive+https links; native node protocol strings may now contain `naive`. No new endpoint or authentication contract is introduced. HTTPS/HTTP2 with validated certificates is required; see the V2Box integration guide and `tests/naive.php`.

Standalone legacy node types (vmess, vless, shadowsocks, trojan, hysteria, tuic, anytls) are retired as management types. Only V2Box is listed, subscribed, sorted and accepted by node communication. Underlying protocols remain available within V2Box. Removed old admin CRUD routes and Deepbwork/Tidalab routes; the seven retired node configuration tables are dropped by the targeted migration; shared accounting records are retained. Node communication now uses explicit GET user/alivelist/config and POST push/alive routes.

## V2Box node V10 API

Explicitly configured legacy V2Box installations retain their existing routes. These new machine endpoints use a separate bearer credential. See node-api.json for schemas.

<!-- node-table -->

`GET /api/v10/me/preferences/options` exposes boolean `couponsAvailable`. It is true only when an enabled coupon is within its validity period and has remaining uses (or unlimited uses). No coupon codes are disclosed.

### Subscription client policy
`GET /api/v10/subscriptions/{subscriptionToken}` retains its existing transport and format parameter. An empty, unknown or disabled client User-Agent returns HTTP 403 with the existing `FORBIDDEN` problem schema. Selecting `format` does not establish client identity. Application and requested format policies both apply. Dedicated authenticated `/me/client-config` continues to use its separate release policy. No frontend user transport type changes are required.
The token-based `/subscriptions/{subscriptionToken}/application-config` endpoint applies the same UA whitelist and 403 problem response; it cannot bypass the subscription whitelist.

Configuration downloads require a recognized client UA with subscription access enabled. Legacy whitelist restrictions are preserved until the first strategy save imports them into per-client access switches. General is no longer a public format or fallback. Explicit canonical formats must match a compatible client family; invalid formats return 422. `SubscriptionClientRegistry` owns canonical IDs; legacy storage aliases are migrated. All token subscription endpoints and custom subscription middleware share per-IP and per-account fixed-window limits; 429 responses include Retry-After. IP and exact-UA-hash blacklist entries are enforced before configuration export. The user response schema is unchanged; no frontend transport type change is needed.

### Administrative connection logs
The existing operations endpoint `log/user-connection/fetch` now adds nullable `email` to each connection record, resolved from the current user without exposing other user fields. The existing `email` search parameter performs a partial match before counting and pagination, combined with user ID, IP and retention filters. Deleted users retain historical records with a null email. No user-facing V10 schema or frontend transport changes are required.

Subscription format names additionally accept `clash-party`, `throne`, `nekobox` and `husi`. All newly recognized clients default to denied until explicitly enabled. Retired flag parameters and legacy format names return 422; generated Mihomo imports use `format=mihomo` on both V10 and custom paths. Shared URI rendering does not expose `uri` or `general` as public fallback formats. The user response schema is unchanged; frontend import URL tests cover canonical output.

Client identity migration now consolidates old strategy keys and log identities. The public `format` field maps directly to internal `format`; `flag` is rejected even when format is also supplied. Canonical format enums and frontend types are updated. Authenticated native configuration remains unchanged.

支付回调加固（2026-10-12）：V10 与保留的旧支付回调继续共用 PaymentActions，原生响应及路径不变。EPay、Paytaro、StripeCheckout 核对金额、币种和已选择渠道；历史快照允许先前选择的渠道延迟到账。没有新用户 JSON 字段，前端传输类型保持不变。

### FastAI access policy
`GET /api/v10/me/client-config` uses the independent `fastai` client strategy for enablement and its application minimum version, evaluated using the validated `clientVersion`. Existing platform release minimums still apply. First creation inherits `fastai_enabled`; after creation, the strategy row is authoritative and the old general-settings toggle is hidden. Native subscription logs use `fastai`; historical `FastAI/...` UA observations previously stored as `flclash` are grouped under `fastai` without rewriting audit records. FastAI is a native client identity, not an additional token-subscription format. Client defaults and managed-profile synchronization request `core=sing-box`; public sing-box and FlClash policies do not govern FastAI. Response schemas and frontend transport fields are unchanged.

### Display-only route preview contract
`GET /api/v10/me/node-previews` maps to `UserServerController@getMeNodePreviews` and `ServerActions::previews`. It requires a non-banned authenticated user, but no active subscription. The `nodePreview` projection contains only names, region labels, tags and stable display identities for visible nodes. It has no host, port, UUID, secret, transport or group membership fields. `/me/client-config` retains its entitlement and FastAI access checks. Previews cannot be used to establish a connection.


### PaytaroQR settlement verification

Both current V10 and retained legacy callbacks use the shared payment action. After X-App-Secret verification, PaytaroQR requires `order_amount` (positive decimal, maximum two decimal places) and `order_currency`; `Money::parseMinor` converts the provider amount into integer minor units. `pay_amount` and `pay_currency` describe the customer's payment asset and are not used as the settlement amount. The shared action compares against the selected channel snapshot's payment amount/currency (PaytaroQR collection is currently CNY), including converted USD orders and QR retries. Legacy orders without conversion snapshots fall back to order total plus the stored fee and order currency. Matching retries preserve `success` without another settlement job. Missing/malformed amounts or currency and mismatches return HTTP 500 with native `fail`, with no new settlement. There are no browser transport changes; callback fields remain provider-native.

Provider reference: https://v3.paytaro.com/#/docs/api-notify and https://v3.paytaro.com/#/docs/api-pay (checked 2026-10-13).

## Client diagnostics

POST /api/v10/me/diagnostic-reports accepts manual, user-approved check results only. The server derives account identity and returns reportId. Five reports/account/hour; default retention 30 days, configurable under log settings.

## Client runtime events

POST /api/v10/me/client-events accepts opt-in, account-linked version/platform and bounded connection/synchronization outcomes, durations and error categories. At most 30 events/batch, 12 batches/account/hour and 16 KiB/body; default retention 30 days. No browsing history, addresses, credentials or configuration content. The previous diagnostic endpoint remains compatible with installed older clients.


## Telegram community

Binding uses a 10-minute one-time deep link, bot acknowledgement and an authenticated website confirmation with the expected Telegram ID. Subscription URLs are never binding credentials. Group invitation links require join approval; entitlement is a non-banned bound account with a plan and an unexpired term or configured grace (default 3 days). Traffic exhaustion is not a group removal condition.


## Mail streams and feedback

- `GET/PATCH /me`: boolean `announcementEmails` maps to `announcement_email`; explicit opt-in, default false, separate from transactional preferences.
- `POST /webhooks/mail/{provider}`: native signed Mailgun, Resend and SES/SNS payloads; public transport, authenticated by provider signature. Request size limit 128 KiB; no raw payload logging.
- `GET /mail/unsubscribe/{token}`: read-only confirmation HTML. `POST` with `List-Unsubscribe=One-Click` updates only announcement preference; scoped HMAC token, no account session or login credential.
- Admin `mail-logs/health`, `mail-logs/suppressions`, `mail-logs/release` retain the existing admin prefix and middleware. Release requires `verified=true`, hash-based row identifier, review audit and cannot directly release complaints.


## 工单回复通知

`GET /api/v10/me/notifications` 在公告列表之外返回 `ticketReplies`（最多 20 个未读工单，每个只保留最新客服回复的 ticketId/messageId/createdAt）与 `ticketUnread`。仅属于当前用户的工单可返回，不含回复正文、邮箱或其他用户资料。

`POST /api/v10/me/notifications/ticket-read-receipts` 接收 `{ticketId, version}`；version 为已展示的客服 messageId。验证当前用户所有权和回复归属，读回执只前进；204 成功，404 无权访问，422 错误消息版本。浏览器遵守现有会话及 CSRF 规则，GET 不标记已读。旧客户端忽略新增字段即可继续显示公告。

## Coupon wallet and independent CNY / USD billing

- `GET /api/v10/me/coupons`: authenticated wallet (up to 100 entries).
- `GET /api/v10/me/coupon-offers`: claimable percentage offers; no business mutation.
- `POST /api/v10/me/coupon-claims` with `couponId`: atomic, idempotent claim per template/account.
- Order creation accepts `walletCouponId` only. Legacy coupon-code parameters are rejected with 422, and the former coupon-validation endpoint has been removed.
- `GET /api/v10/payment-methods?orderNumber=…` returns payment currency, quoted amount, order-currency fee and rate time. Cross-currency checkout must echo `expectedPaymentAmount` and `expectedPaymentCurrency`; a changed quote returns 409.
- Existing CNY prices/assets are unchanged. New accounts inherit `new_user_currency` once; account and order currencies cannot be edited. USD plan prices are independent. Balances never exchange automatically.
- Every payment channel has immutable per-order payment amount/currency snapshots. Old callbacks without conversion snapshots use order amount, original handling fee and stored order currency, defaulting to CNY only when currency is absent.

## Coupon activities and localization

`GET /api/v10/me/coupon-offers` supplies localized activityTitle, activityDescription and name for the activity center. Claiming stays POST; checkout reads owned coupons only. `GET /api/v10/me/coupons` localizes frozen wallet names. Both negotiate Accept-Language and use no-store. Admin copy configuration stays on existing admin coupon-presentation/fetch and coupon-presentation/save contracts.

## Optional MFA

GET /me/security/mfa reads default-off email/TOTP state. POST /me/security/mfa/challenges stages changes after password and current factor proof. POST /auth/mfa/emails sends a purpose-scoped code; POST /auth/mfa/verifications completes a single-use challenge. POST /auth/sessions returns either authentication or mfaChallenge. Browser grants remain cookie-only; administrator settings stay on the retained admin contract. See docs/mfa.md.

- `user/logoutAll` is a frontend transport alias only: `DELETE /api/v10/me/sessions`, 204. Revokes all caller login sessions, including the current browser; does not rotate subscription credentials. No V1 route is introduced.

## Website analytics

New first-party resources (no legacy V1 alias): `GET /api/v10/public/analytics/configuration` and `POST /api/v10/public/analytics/events`. Explicit anonymous event schema; credentials omitted. The historical `/public/page-views` invitation counter is retired (404); current analytics events are unaffected. Admin report/settings remain under the existing protected V1 admin prefix at `/analytics/report` (GET) and `/analytics/settings` (POST).

Analytics source extension: optional attributionVersion=1 and sourceDomain on the existing public event contract. Hostname-only allowlist; no URLs, campaign parameters, account IDs or payment attribution. First accepted event fixes the session source. Existing clients may omit both fields. Migration 2026_10_17_000002 adds source fields; without it ordinary analytics continues and the admin report exposes sourcesReady=false. Report sources are the top 50 domains within the same time/device scope, with ordered browser funnel counts and sourceGroups. Historical sessions remain distinct from direct/unknown traffic. Sources follow session retention. Consent revision 3 re-prompts prior allows while preserving valid prior denials; eight-language disclosure updated.

Account deletion: GET /me/account-deletion and DELETE /me are native V10 resources, default disabled by account_deletion_enable. DELETE requires current password, DELETE confirmation, recent full authentication, and no funds/unsettled orders or commissions. Account identity is anonymized and access revoked; a pseudonymous user ID remains for accounting and necessary security retention. No V1 self-deletion route is introduced.

Billing history: `GET /me/orders` optionally combines `status`, exact `orderNumber`, inclusive `createdFrom` and exclusive `createdBefore` before pagination. Dates require UTC ISO 8601 with a `Z` suffix and may include one to three fractional-second digits; the upper bound must be strictly after the lower bound. Stored order times have second precision, so both bounds round up to the next stored second when fractional digits are nonzero. Results are always scoped to the authenticated owner, sorted by creation time descending and then ID descending; `meta.pagination.total` counts the filtered owner-only collection. Unknown and other-account order numbers both return the same empty collection. Invalid filters return 422 field errors, and history reads do not mutate orders or balances. The transport maps existing `order_number`, `created_from` and `created_before` view-model inputs to these declared public query fields.


Node target telemetry performance: nodes advertising `target-statistics-policy-v2` may receive the optional `X-Target-Statistics-Policy` JSON header on configuration 200/304 responses. It does not affect the configuration ETag. Reuse only the remaining original lease; fall back to GET `/server/target-statistics/policy` if the header is absent, invalid or nearly expired. POST `/server/target-statistics` accepts uncompressed JSON up to 256 KiB with a node-specific 30/minute quota after bearer authentication (shared source IPs have independent quotas). Malformed JSON, oversized bodies, unsupported encoding/media type and rate limiting produce 400/413/415/429. Existing request/response bodies and v1 node capability remain compatible.


Optional node policy field `reportIntervalSeconds`: 30/60/120/300, default 60 on older panels. New nodes advertise `target-statistics-interval-v1`; old nodes retain their fixed cadence. Upload cadence does not extend the maximum 120-second collection lease: refresh policy at most every 60 seconds plus jitter, and retry failed pending batches after 30 seconds. Administrative interval-only updates preserve enabled/version and existing aggregates; switch-only updates preserve the interval. No billing cadence change.


Node deployment enrollment: GET `/public/node-deployment/bootstrap` serves the static Linux shell entry point, including pinned v1.0.13 installation/upgrade, scoped multi-panel enrollment. POST `/server/enrollments/redeem` accepts only a 10-minute one-use deployment grant and an empty JSON body; identity and host come from the grant. Admin creation uses protected `/server/credentials/deployment` without a separate password prompt. Creating a command never rotates credentials; redemption burns its grant before issuing the scoped node key. Expiry, changed credential policy, administrator demotion/password change or node deletion invalidate authority. Sensitive responses are private, no-store; credentials never enter request URLs or logs. Existing nodes and other panels are preserved by the bootstrap's merge and rollback workflow.



Bootstrap readiness negotiation: `X-Deployment-Capabilities: runtime-ready-v1` on enrollment redemption requests a runtime-only `deployment` workflow for nodes without managed DNS. `accessMode=unmanaged` skips DNS and uses fresh scoped-key/configuration acknowledgements before completion; it cannot publish domains or submit DNS verification states. Legacy clients without the capability retain their original unmanaged response. A failed new-node application removes only its unchanged appended Nodes entry, retaining other backends and reporting identities.

Subscription reset status: `GET /me/subscription` returns only the authenticated owner's reset information. `resetAt` is a UTC ISO 8601 instant and `resetTimezone` is the IANA zone of the reset business rule; `displayTimeZone` changes presentation only. Optional nullable `resetState` is `scheduled` for a future reset, or `pending`/`failed` for a due but unfinished reset at `resetAt` (which may be in the past). No applicable reset yields null for `resetAt` and `resetState`; older servers may omit `resetState`. A subscription GET never resets traffic, writes completion records or grants quota. The status describes the existing scheduler and does not change its retry or reset policy.
