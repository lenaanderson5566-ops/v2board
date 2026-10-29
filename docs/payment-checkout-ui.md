# Checkout UI and API audit

The subscription catalog opens a dedicated unified checkout page. Period, wallet coupon, payment method and final payable amount are confirmed together before order creation. The existing provider integrations, payment callbacks and order state machine remain in use.

| Operation | V10 route | UI responsibility |
| --- | --- | --- |
| Preview checkout | POST `/api/v10/me/checkout-quotes` | Authenticated five-minute quote; no order, balance reservation, coupon reservation or provider call. |
| Create order | POST `/api/v10/me/orders` | Keep server discounts, balance offsets and replacement transactions authoritative. |
| Order detail | GET `/api/v10/me/orders/{orderNumber}` | Render persisted amounts, currency, order kind and timestamps. Retain checkout state during refresh; reset on a different order. |
| Payment methods | GET `/api/v10/payment-methods?orderNumber=…` | Use enabled methods in backend sort order; display configured names without guessing provider capabilities. |
| Start payment | POST `/api/v10/me/orders/{orderNumber}/payments` | Prevent duplicate requests. Handle confirmed, pending, redirect and QR responses independently. Only order status proves completion. |
| Check status | GET `/api/v10/me/orders/{orderNumber}/status` | Poll while waiting or processing; pause in hidden tabs and stop after 60 attempts. Provide manual retry. |
| Cancel | POST `/api/v10/me/orders/{orderNumber}/cancellation` | Require confirmation; backend allows unpaid orders only and returns deducted account balance atomically. Never promise external refunds. |

Fee preview uses the server quote from `PaymentQuote::make`: convert the order base into the channel payment currency, then add round(converted base × percentage / 100) plus the fixed fee in that payment currency. The fee is also converted back to order currency for accounting. CNY and USD amounts are integer minor units; never infer currency from the UI language or a global symbol.

Once issued, the same order/channel reuses its saved quote even after fee or exchange-rate changes. Choosing a different channel can create a separate snapshot. Confirmed initiation echoes `expectedPaymentAmount` and `expectedPaymentCurrency`; Both same-currency and cross-currency expectations are checked. A 409 requires refreshing the quote and obtaining confirmation again, not automatically retrying payment.

The product summary reconstructs the original order price from persisted amounts,
not current catalog prices. Subscription, credit, reset and deposit orders keep
their existing completion destinations. Deposit bonuses use server detail fields.

UI states: initial loading, method loading/error/empty, ready, submitting, waiting
for payment, QR, card dialog, processing, completed, cancelled, discounted and
unknown status. Unknown status offers refresh and cannot initiate payment.
The pending checkout has one prominent payable total; receipts retain a total.
Zero fees are omitted. Mobile controls stay in document flow to avoid covering
payment content or conflicting with navigation and dialogs.

Order help uses account `ticketCreation` (decoded as `ticket_creation`), matching
`TicketPolicy::creation`. Only an explicit `allowed` result links to order tickets;
purchase-required, closed, loading and failed account reads link to documentation.
The help and cancellation actions share a row in pending checkout.


## Unified subscription checkout

`plan/{planId}?period=…` resumes the configured selection on refresh; optional `replace` identifies an owned, cancellable unpaid order. No arbitrary return URL is accepted. Catalog selections carry the current cycle into the same page without a modal. Reset purchases keep their existing separate entry.

The preview reuses `OrderActions::prepareSubscriptionOrder`, coupon eligibility, VIP discount, order type/surplus calculations and `PaymentQuote`. It calculates a virtual balance offset on an unsaved order. Replacement preview simulates only the owned refundable reserved balance and coupon; it never cancels an order. Usable channel quotes are returned through the public payment resource without provider credentials. The encrypted quote binds the authenticated owner, plan, cycle, wallet entry, replacement, selected channel, monetary breakdown and five-minute expiry. Changes in balance, eligibility, price or fee require a fresh explicit confirmation.

Order creation supplies `quoteToken`, `paymentMethodId` and UUID `requestKey`. Under the existing user lock and database transaction, replacement cancellation, quote revalidation, balance deduction, coupon reservation and order persistence remain atomic. The order stores the request fingerprint and confirmed channel snapshot in its existing hidden payment snapshot. Retrying the same confirmed request returns the original owned order, including after quote expiry; a changed request with that key conflicts. No schema migration is required.

One user confirmation orchestrates order creation followed by the existing payment request; provider calls never run inside the order transaction. A UUID payment request key records the in-flight attempt before contacting a provider, and stores its result afterward. Duplicate requests replay the response or resume status checks. An uncertain or provider-pending result cannot start another attempt through a new key. Callers omitting a key also enter the in-flight guard; result replay requires a stable client key. Validation failures before a provider call can be corrected. Existing order polling, card token collection, redirects, QR display and webhook verification are reused. Card entry or provider authentication can still require user interaction.

During re-quoting, obsolete responses cannot replace the current total and submission is disabled. An uncertain order-creation result freezes purchase inputs and retries the exact same body/key. A conflict loads a new quote and waits for another explicit confirmation. Creation uses the real order route so the URL, shell navigation, breadcrumbs and authentication recovery remain synchronized. A one-minute in-memory handoff carries the recent user confirmation into that order view and is cleared when consumed, on logout or session expiry. Refreshing or returning from a provider opens the persisted order without automatically initiating a payment. All browser order payments carry a request key, including restored orders. Zero-due orders use the existing free checkout path.

When a selected payment channel becomes unavailable, checkout resets the channel request, reloads usable methods and requires explicit confirmation of the new selection. A hidden quote-only snapshot is presented as an unissued payment in administrator history. Production static packages exclude the synthetic account, quote and order fixture data; configured payment icons retain their existing public asset path and fallback.


## Payment method layout

The shared PaymentMethodPicker owns its styles for both unified checkout and existing orders. Wallet rows and asset headers share icon, selection and spacing columns. Expanded assets use compact full-width network rows with a single divider, matching the existing payment presentation. Network icons, full names and protocol tags stay visible on desktop and narrow screens. The chosen network remains in the asset summary when collapsed. Opening a multi-network asset clears the previous method and waits for a specific network; default wallet selection cannot override that deliberate choice during cycle re-quoting.

## Checkout error recovery

A direct checkout first reads owned orders. An unpaid or processing order offers its existing continuation/progress link and confirmed cancellation where supported; no new quote or coupon reads are started while it blocks checkout. An explicitly requested eligible replacement keeps its existing atomic server validation. A later quote conflict rechecks owned orders once, and otherwise offers order history and explicit retry/reselection without cycling between the default channel and a failed quote. Order lookup refreshes preserve the current form until a blocking order is found.

Checkout quotes remain POST reads and do not clear the account read cache or broadcast data-changed events. Rapid selections are debounced before sending, stale responses remain ignored and submission waits for a fresh valid quote. Wallet reads share the existing short-lived memory cache, separated by session and language and invalidated by real mutations/logout. Rate-limit errors carry Retry-After (seconds or HTTP date; a missing/invalid header defaults to 60 seconds), use localized copy, and prevent retry/resume events from bypassing the cooldown. Expiry only enables an explicit retry; it does not submit or retry automatically. Coupon failures use a secondary recovery row while retaining any loaded eligible selection; final coupon validity and all amounts are still checked by the server.


## Page-local quote reuse

A checkout hook keeps up to ten successful quote combinations in memory for the lifetime of that page. Keys include the full submitted selection (plan, cycle, wallet coupon, channel and replacement order), account pricing currency and language. Returning to a matching combination can immediately reuse the original server response and token. Entries expire after 30 seconds or five seconds before the server expiry, whichever comes first; reuse does not extend the original deadline. A displayed quote still follows its server validity period and is not periodically refetched solely because the reuse window elapsed.

Explicit refresh and real data-changed events clear all combinations, invalidate the displayed quote and abort/ignore any earlier request before fetching again. All quote errors clear the cache; 429 cooldown remains enforced across selection changes and invalidation. Session expiry stops reuse and further requests, and unmount releases the cache. No tokens or quote data are written to browser storage or shared between checkout instances. The existing 150 ms debounce applies to misses, and responses arriving after invalidation cannot repopulate the cache.

Order submission still supplies the original encrypted server token and uses the existing transactional revalidation of ownership, eligibility, expiry, balances, totals and channel configuration. A rejected cached quote is discarded and the newly calculated amount requires another explicit confirmation. Cache reuse does not create an order, reserve assets, bypass idempotency or change the gateway protocol.
