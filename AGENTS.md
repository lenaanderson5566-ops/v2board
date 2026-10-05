# Agent rules

## API contracts
- New user-facing product APIs belong under /api/v10. Administrative, operations/risk and staff APIs remain on their existing contracts and must not be migrated by this change. Register explicit resource routes; do not dynamically dispatch controllers or proxy requests to /api/v1.
- Legacy user business/public APIs were explicitly retired. Preserve only the routes in docs/api-v10/retained-legacy.json, administrative/operations/staff APIs, node communication, and configured custom subscriptions. Do not reintroduce retired routes. Mirror downloads use /api/v10/public/client-installers/{installerId}/content; the old /client-mirrors path is retired.
- Keep shared business actions in App/Services/Actions; V1 and V10 controllers must use the same transactions, validation, session revocation and entitlement rules.
- Use GET for reads, POST for creation/business operations, PATCH for partial changes and DELETE for deletion. GET must not mutate business records.
- V10 browser authentication requires Authorization: Bearer. Never accept browser credentials from query parameters. Authentication failures are 401; authorization failures are 403.
- Define explicit request and resource schemas with camelCase semantic names. Never expose models or automatically camel-case arbitrary keys. Monetary amounts are integer minor units with a currency; byte counts are integers; timestamps are UTC ISO 8601; business statuses are string enums.
- Successful JSON uses data and optional meta. Pagination uses page/pageSize, default 20, max 100, with meta.pagination. Use 201 for creation, 202 for queued jobs, 204 for no-content operations.
- Errors use application/problem+json with stable code and requestId. Never return stack traces or internal paths, even in debug mode.
- Language negotiation uses Accept-Language; return Content-Language. Binary downloads, CSV, client configuration and provider webhooks retain their native protocols.
- Log route names, request IDs, statuses and duration only. Redact credentials, subscription tokens, passwords, verification codes, account credentials and callback secrets.
- Changes must update docs/api-v10/openapi.json, endpoint mappings, frontend transport types and contract tests. Keep old/new interoperability tests.
- Never commit Dockerfile.local, LOCAL-RUN.txt, local-seed.php, environment secrets or runtime installer files.

- Default subscriptions always use /api/v10/subscriptions/{subscriptionToken}, including links generated outside V10 requests. /api/v1/client/subscribe is retired; preserve administrator-defined custom links via CustomSubscriptionController and the shared subscription action.

- Payment initiation and administrative callback displays use /api/v10/webhooks/payments/{provider}/{endpointId}, including custom notify domains. Retain old payment callbacks for in-flight orders. User payment APIs stay on V10; do not modify provider SDK signing or native responses for API versioning.

- Currency phase 1 is CNY-only. Existing integers are fen, never relabel CNY assets as USD using global display settings. Orders persist currency; future USD requires independent prices, wallets, payment verification and a separate release. Preserve payment SDK signing and provider contracts.
