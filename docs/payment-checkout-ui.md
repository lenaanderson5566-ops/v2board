# Checkout UI and API audit

The checkout, order receipt and billing navigation use the existing V10 contract.
No endpoints, provider signing, monetary rules or wire schemas are changed.

| Operation | V10 route | UI responsibility |
| --- | --- | --- |
| Create order | POST `/api/v10/me/orders` | Keep server discounts, balance offsets and replacement transactions authoritative. |
| Order detail | GET `/api/v10/me/orders/{orderNumber}` | Render persisted amounts, currency, order kind and timestamps. Retain checkout state during refresh; reset on a different order. |
| Payment methods | GET `/api/v10/payment-methods` | Use enabled methods in backend sort order; display configured names without guessing provider capabilities. |
| Start payment | POST `/api/v10/me/orders/{orderNumber}/payments` | Prevent duplicate requests. Handle confirmed, pending, redirect and QR responses independently. Only order status proves completion. |
| Check status | GET `/api/v10/me/orders/{orderNumber}/status` | Poll while waiting or processing; pause in hidden tabs and stop after 60 attempts. Provide manual retry. |
| Cancel | POST `/api/v10/me/orders/{orderNumber}/cancellation` | Require confirmation; backend allows unpaid orders only and returns deducted account balance atomically. Never promise external refunds. |

Fee preview matches `OrderActions::checkout`: round(base amount × percentage / 100
+ fixed fee), with all amounts in CNY minor units. Once a payment is issued, retain
the persisted fee even if the provider is removed or its fees change. Explicitly
restarting payment returns to current method prices without charging immediately.

The product summary reconstructs the original order price from persisted amounts,
not current catalog prices. Subscription, credit, reset and deposit orders keep
their existing completion destinations. Deposit bonuses use server detail fields.

UI states: initial loading, method loading/error/empty, ready, submitting, waiting
for payment, QR, card dialog, processing, completed, cancelled, discounted and
unknown status. Unknown status offers refresh and cannot initiate payment.
The pending checkout has one prominent payable total; receipts retain a total.
Zero fees are omitted. Mobile controls stay in document flow to avoid covering
payment content or conflicting with navigation and dialogs.
