# Order payment snapshot

Orders retain a whitelist snapshot of channel name, provider, asset, network and fee. No attempt table, timeline or extra merchant reference is used. Providers receive the original order number.

While unpaid, an internal channel-keyed map retains original terms for selected channels. Re-selecting a channel reuses its original snapshot and fee. This allows late callbacks from previously selected channels to retain correct attribution without an attempt log. The first successful callback atomically freezes its snapshot and fee; the map is discarded. Later callbacks cannot overwrite settlement.

Admin list/detail expose payment_display; detail also exposes payment_provider. Legacy orders show explicitly labelled current channel information. No historical facts are fabricated. No secrets or payment URLs are saved. User API schemas are unchanged. Deploy with update.sh to apply 2026_10_10_000001_add_order_payment_snapshot.php; fresh install schema is also included.
