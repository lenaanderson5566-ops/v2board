# Removed payment gateways

Epusdt and BEasyPaymentUSDT implementations are removed. New gateway selection, user payment lists, gateway construction and administrative re-enablement reject these methods. Existing configurations and historical orders are retained for audit/cleanup; administrators can disable or delete an old configuration.

Deploy with `php artisan migrate --force` to disable existing gateway records, and restart long-lived PHP/queue workers. No frontend rebuild is required because gateway options come from the backend catalog. Removed gateways no longer process callbacks, including pending transactions created before deployment; reconcile those transactions with the provider before removal. Other payment providers retain their existing callback contracts.

Regression test: `php tests/retired-payments.php` (local environment only).
