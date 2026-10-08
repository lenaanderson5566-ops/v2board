# FastAI service entrypoints

Manage origins in administrative System settings → Service entrypoints. Add an HTTPS domain, check its service identity, then publish. New enabled origins require a successful check within ten minutes; existing enabled origins can retain their priority or be disabled. Checks resolve public IPv4 addresses and pin the outbound connection to an inspected address, disable redirects/proxies and retain TLS verification. They cannot confirm reachability from a user's network.

## Provision signing trust

As the backend application user on the production backend run `php scripts/create-entrypoint-key.php`, then rebuild the Laravel configuration cache and restart backend workers normally. The script creates `storage/app/fastai-entrypoint.seed` with restricted permissions and prints only the public key; it never overwrites an existing seed. Alternatively configure a base64 32-byte seed with `FASTAI_ENTRYPOINT_SIGNING_SEED`. Keep the same private seed across every instance and retain it through deployment; never commit it or put it in a frontend/build file.

Build FastAI with `--dart-define=FASTAI_ENTRYPOINT_PUBLIC_KEY=<public key>` (or this public value in the existing build define JSON). Never put the signing seed in App defines. A build without this public key uses only its embedded HTTPS origins and ignores dynamic catalogs. Key rotation requires a coordinated App update. Do not generate separate keys on each backend host.

The public signed envelope is available at `/api/v10/public/fastai/entrypoints`. It includes a service identity, monotonic publication version, seven-day validity and enabled origins in priority order. The signature covers the exact decoded payload bytes. App verifies the pinned key, identity, freshness and version before accepting domains, and persists its highest observed version to reject rollback. Roll back operational configuration by publishing the previous origins as a new version.

## Recovery and deployment

The App embeds `https://fastdog.ws`, `https://fastdog.me`, `https://fastdog66.com`; override backups with `FASTAI_SERVICE_ORIGINS` if needed. The last successful origin is tried first. Healthy requests check for catalog updates at most every six hours; a successful failover forces a check. Failed updates preserve valid cached configuration. Expired catalogs lose dynamic trust and return to embedded origins. GET/HEAD may retry once after transport failure; business mutations are never replayed. Existing proxy configurations/connections are not cleared by this mechanism.

For independent recovery distribution, mirror the entire signed envelope to independently hosted HTTPS URLs and embed them with comma-separated `FASTAI_ENTRYPOINT_SOURCES`. Static copies expire after seven days and need regular republishing. Every source is untrusted until the payload passes signature verification. If all embedded origins and independent sources are inaccessible, the App cannot discover new domains.

All service domains must provide the full user site and same-origin `/api/v10`, use the same account database/session cache/application key/signing seed, and preserve the external HTTPS Host correctly through reverse proxies. Login-link and browser-authorization URLs use the incoming origin only when it is an enabled configured service domain; arbitrary hosts are never reflected. Add actual browser website origins separately to `FRONTEND_ALLOWED_ORIGINS`. Cookie allowlists are not automatically expanded from the service catalog, and unrelated domains do not share Cookies. Native sessions retain their token across trusted service origins.

No database migration is required. Backend checks support IPv4 destinations; IPv6-only hosts are not currently eligible for publication. No production DNS, CDN, signing secret or browser-origin configuration is altered by this code change.

## Troubleshooting

Run `php scripts/check-entrypoint-config.php` to report extension availability, file readability and effective seed validity without printing the private seed. CLI and PHP-FPM may use different PHP versions/extensions/users. Ensure the seed file is owned by the application user with mode 0600; do not make it world-readable. An explicit nonempty environment seed takes precedence and does not read the private file. If the file is unreadable and no environment seed exists, signing remains unconfigured instead of breaking configuration bootstrap. Rebuild the config cache and restart PHP-FPM/backend workers after correcting configuration; never clear shared session caches.
