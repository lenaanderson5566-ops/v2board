# Account experience and service notifications

## Redemption

The billing page opens a dedicated gift-card dialog: recipient account, code, eligibility note, pending state, recoverable error, then a persistent success confirmation. Trim surrounding whitespace without changing code case. Prevent concurrent submission and closing while pending. Clear read caches and reload account/subscription after success. The V10 endpoint returns a boolean; do not describe every card as a wallet top-up or invent an amount.

The shared redemption action locks the recipient and card within the existing transaction. It accepts historical double-encoded recipient lists and normal JSON arrays, and rejects missing plans before granting plan cards. Existing five card types and eligibility rules remain authoritative.

Design references: [Apple redemption](https://support.apple.com/en-gb/118242), [OpenAI account confirmation](https://help.openai.com/en/articles/20001491-buying-and-redeeming-openai-gift-cards), [Netflix gift cards](https://www.netflix.com/gift-cards). Borrow the focused account/code/confirmation sequence, not their product-specific redemption rules.

## Email preferences and delivery

`GET/PATCH /api/v10/me` exposes the boolean `serviceNotifications`, mapped to `remind_service`. It defaults to on. Notification settings provide separate switches for service activation and renewal, expiry reminders, and plan allowance reminders. Service emails use the recipient’s language preference when available. [Mail language selection](../app/Services/Mail/ProductMail.php)

`serviceActivated` covers fulfilled new/switch service orders, independent credit orders, and plan gift cards. Customer purchases and administrator-confirmed credit orders use the same confirmation email after the credits are granted. `serviceRenewed` covers renewal orders and duration gift cards. Wallet deposits, allowance gifts and reset purchases do not trigger service-success mail. Schedule only on the transition to fulfilled, within its transaction, and enqueue after commit. Rolled-back and repeated fulfillment does not enqueue a new notification. The mail worker rechecks the preference and banned/deleted account before delivery. Delivery uses the existing queue, retry and rate-limit infrastructure. Enqueue failures are logged without undoing committed service activation. There is no historical backfill.

Mail intentionally contains a generic service confirmation and account link, without configuration credentials or gift codes. View live entitlement details in the account. “额度提醒” concerns **plan allowance**; its threshold remains 95%, separate from independent purchased credits.

## Account navigation

After successful registration, an account whose authoritative service state is `new` goes directly to the existing plan catalog. An explicit purchase, coupon or client-authorization return takes priority. Accounts with trial/usable service keep the dashboard destination, as do ordinary sign-ins. No plan, order, discount or payment is selected automatically.

When a user without service returns to the dashboard, check existing orders before showing **Choose a plan / Documentation**. An unpaid order offers **Continue payment** through its existing checkout; a processing order offers its activation progress. Reuse the existing cancellation confirmation, server order amounts and ownership checks. A failed or incomplete order lookup provides retry instead of treating unknown state as an empty history. Deposits and credit orders keep their own order destination and do not promise subscription activation.

The billing page explains to accounts without a plan that they can pay for a plan directly without first topping up their wallet. A successfully loaded, unfiltered empty history includes a plan-selection link; filtered results, stale failures and active/expired accounts keep their existing behavior. Wallet deposits and gift-card redemption remain available.

After activation, open **Connect & download** to install a client and import the subscription. Users can reset exposed subscription credentials in account security. [Account states and setup](account-entry-states.md#快速开始与账单)

Validate the changes with `UserAuth`, `AccountEntry`, `UsageBilling`, `PendingOrderNotice` and purchase-flow tests. This removes navigation and payment-recovery friction; it does not establish a measured conversion uplift. Use existing mature registration cohorts and registration-to-payment timing for follow-up. Their confirmed-order metrics include wallet/zero-value payments and must not be described as an external-cash first-purchase rate. No new tracking or marketing messages are introduced.

## Deployment and validation

Apply `database/migrations/2026_10_08_000001_add_service_notifications.php` before serving the new code, then restart queue workers. The approved updater includes the migration; the installation SQL also includes the field. A Git pull alone does not apply database changes.

Relevant checks: `tests/service-notifications.php`, `tests/product-mail.php`, `tests/api-v10.php`, `tests/update-script.sh`, frontend GiftCardRedemption/UsageBilling/Notifications/AccountControls/AccountSessions/AccountEntry tests and production build. Mail tests use fakes and never send real messages.

## Analytics preferences

Signed-in users can turn **Analytics preferences** on or off in **Settings** (`#/profile`). The preference is stored in the browser. Collection requires an explicit opt-in and an available site configuration. It stays off when the browser sends Global Privacy Control or Do Not Track, or when the site increases retention beyond the duration the user accepted. The page footer links to the terms of service when the site has configured a URL. [Privacy controls](../frontend/src/user/AnalyticsPrivacy.tsx)
