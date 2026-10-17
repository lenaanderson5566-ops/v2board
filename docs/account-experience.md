# Account experience and service notifications

## Redemption

The billing page opens a dedicated gift-card dialog: recipient account, code, eligibility note, pending state, recoverable error, then a persistent success confirmation. Trim surrounding whitespace without changing code case. Prevent concurrent submission and closing while pending. Clear read caches and reload account/subscription after success. The V10 endpoint returns a boolean; do not describe every card as a wallet top-up or invent an amount.

The shared redemption action locks the recipient and card within the existing transaction. It accepts historical double-encoded recipient lists and normal JSON arrays, and rejects missing plans before granting plan cards. Existing five card types and eligibility rules remain authoritative.

Design references: [Apple redemption](https://support.apple.com/en-gb/118242), [OpenAI account confirmation](https://help.openai.com/en/articles/20001491-buying-and-redeeming-openai-gift-cards), [Netflix gift cards](https://www.netflix.com/gift-cards). Borrow the focused account/code/confirmation sequence, not their product-specific redemption rules.

## Email preferences and delivery

`GET/PATCH /api/v10/me` exposes boolean `serviceNotifications`, mapped to internal `remind_service`. Default on for existing and new accounts. Notifications settings provides separate service, expiry, and allowance switches. New frontend copy and both mail templates support all eight locales; Persian uses RTL.

`serviceActivated` covers paid new/switch service orders and plan gift cards. `serviceRenewed` covers renewal orders and duration gift cards. Wallet deposits, independent credit purchases, allowance gifts and reset purchases do not trigger service-success mail. Schedule only on the transition to fulfilled, within its transaction, enqueue after commit. Rolled-back and repeated fulfillment does not enqueue a new notification. The mail worker rechecks the preference and banned/deleted account before delivery. Delivery uses the existing queue, retry and rate-limit infrastructure; an enqueue failure is logged without undoing committed service activation. There is no historical backfill.

Mail intentionally contains a generic service confirmation and account link, without configuration credentials or gift codes. View live entitlement details in the account. “额度提醒” concerns **plan allowance**; its threshold remains 95%, separate from independent purchased credits.

## Account navigation

New accounts keep **Choose a plan / Documentation**. Configuration is useful after activation; linking there before purchase adds an empty step. The explanatory sequence is **Choose a plan → Confirm and pay → Configuration center**. Account security shares the account pages' width, outer heading and section cards; remove its extra dashboard-back level. Session revocation and password/subscription reset behavior remain unchanged.

## Deployment and validation

Apply `database/migrations/2026_10_08_000001_add_service_notifications.php` before serving the new code, then restart queue workers. The approved updater includes the migration; the installation SQL also includes the field. A Git pull alone does not apply database changes.

Relevant checks: `tests/service-notifications.php`, `tests/product-mail.php`, `tests/api-v10.php`, `tests/update-script.sh`, frontend GiftCardRedemption/UsageBilling/Notifications/AccountControls/AccountSessions/AccountEntry tests and production build. Mail tests use fakes and never send real messages.

## 隐私偏好入口

- 访问统计偏好使用共享入口：落地页并入现有页脚，登录及授权页使用紧凑页脚，已登录页面置于主内容区页脚；移除独立通栏及固定 90px 留白。
- 账户设置保留普通设置行作为辅助入口。匿名、账户受限和内嵌浏览器提示页面仍可访问偏好；移动端沿用主内容区的底部导航安全间距。
- 页脚采用低强调文本按钮，保留盾牌图标、44px 点击高度和键盘焦点。首次确认横幅、拒绝和撤回机制、采集范围及本地偏好有效期保持原有规则。
