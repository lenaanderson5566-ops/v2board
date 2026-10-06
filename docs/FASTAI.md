# FastAI releases and website sign-in

FastAI's public release API is
`GET /api/v10/public/fastai/releases/latest?platform=windows&architecture=x64`.
The generated V10 OpenAPI and frontend types declare the request and response.
There is no database migration or dependency on upstream FlClash's release feed.

Manage the catalog in **System configuration → 客户端下载 → FastAI 客户端下载与更新**.
The download tab uses per-platform and per-architecture forms in place of the old Windows/macOS/Android version and download fields. iOS recommendations and Apple download accounts remain unchanged.

The authenticated administrative config API also accepts `fastai_releases` and
`fastai_enabled` on its existing contract. A catalog entry has these fields:

| Field | Meaning |
| --- | --- |
| platform | windows / android / macos / linux |
| architecture | x64 / arm64 / arm / x86 |
| channel | stable |
| latestVersion | Stable semantic version, e.g. 1.0.0 |
| latestBuild | Positive monotonically increasing build counter |
| minimumVersion | Oldest supported FastAI semantic version |
| downloadUrl | Actual HTTPS installer URL without embedded credentials |
| sha256 | Actual lowercase SHA-256 of the published installation package |
| publishedAt | UTC timestamp, e.g. 2026-10-06T00:00:00Z |
| releaseNotes | Optional plain text |

The catalog starts empty. Missing targets return `404 RELEASE_UNAVAILABLE`;
do not populate it with dummy download URLs or hashes. Validation rejects
duplicate targets, invalid versions and minimum versions above the latest release.
Configuration requests use the matching release's minimum version, and return
`409 CLIENT_VERSION_TOO_LOW` without invalidating the user's session. Existing
custom subscriptions/open-source client policies remain independent. Native
configuration requests retain structured success/failure logs without tokens,
codes or configuration bodies.

Website login reuses `POST /api/v10/me/login-links` and
`POST /api/v10/auth/session-exchanges`. An authenticated app obtains a random
one-time code with a 60-second lifetime. Only that code enters the browser URL
fragment; the website removes it before exchanging it in a JSON request body.
Redemption uses a cache lock plus pull, checks bans, and generates a separate
browser session. Replays are rejected. Configure `app_url` to the same HTTPS
origin as the client's `V2BOARD_WEBSITE`; keep the shared Redis cache enabled
across application workers. The React website now processes this flow at startup.

Deploy backend and freshly built `public/console` together, refresh configuration
cache and restart long-lived workers. Publish signed, tested client packages and
their hashes before raising minimum supported versions. Git push alone does not
deploy the production website or publish an app release.

Local checks: `tests/fastai-client-config.php`, `tests/fastai-release-login.php`,
`tests/api-v10.php`, `tests/api-v10-inventory.php`; frontend `npm run build` and
V10/admin-field Vitest suites. Local integration tests use an isolated array cache
and roll back database transactions; production must retain the shared cache.
