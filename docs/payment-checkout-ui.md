# Checkout UI and API audit

The checkout, order receipt and billing navigation use the existing V10 contract.
No endpoints, provider signing, monetary rules or wire schemas are changed.

| Operation | V10 route | UI responsibility |
| --- | --- | --- |
| Create order | POST `/api/v10/me/orders` | Keep server discounts, balance offsets and replacement transactions authoritative. |
| Order detail | GET `/api/v10/me/orders/{orderNumber}` | Render persisted amounts, currency, order kind and timestamps. Retain checkout state during refresh; reset on a different order. |
| Payment methods | GET `/api/v10/payment-methods?orderNumber=…` | Use enabled methods in backend sort order; display configured names without guessing provider capabilities. |
| Start payment | POST `/api/v10/me/orders/{orderNumber}/payments` | Prevent duplicate requests. Handle confirmed, pending, redirect and QR responses independently. Only order status proves completion. |
| Check status | GET `/api/v10/me/orders/{orderNumber}/status` | Poll while waiting or processing; pause in hidden tabs and stop after 60 attempts. Provide manual retry. |
| Cancel | POST `/api/v10/me/orders/{orderNumber}/cancellation` | Require confirmation; backend allows unpaid orders only and returns deducted account balance atomically. Never promise external refunds. |

Fee preview uses the server quote from `PaymentQuote::make`: convert the order base into the channel payment currency, then add round(converted base × percentage / 100) plus the fixed fee in that payment currency. The fee is also converted back to order currency for accounting. CNY and USD amounts are integer minor units; never infer currency from the UI language or a global symbol.

Once issued, the same order/channel reuses its saved quote even after fee or exchange-rate changes. Choosing a different channel can create a separate snapshot. Cross-currency initiation echoes `expectedPaymentAmount` and `expectedPaymentCurrency`; 409 requires refreshing the quote and obtaining confirmation again, not automatically retrying payment.

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
