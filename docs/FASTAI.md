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
| architecture | A published ABI, or `universal` for Windows, macOS and Linux (x64, arm64) or Android (arm, arm64, x64). Existing legacy entries may use x86. |
| channel | stable |
| latestVersion | Stable semantic version, e.g. 1.0.0 |
| latestBuild | Positive monotonically increasing build counter |
| minimumVersion | Oldest supported FastAI semantic version |
| downloadUrl | Actual HTTPS installer URL without embedded credentials |
| sha256 | Actual lowercase SHA-256 of the published installation package |
| publishedAt | UTC timestamp, e.g. 2026-10-06T00:00:00Z |
| releaseNotes | Optional plain text |

Publish a universal installer once under its platform. The download page selects that file directly. Existing clients still query their running ABI and receive that ABI in the response. When a per-ABI release and a universal release coexist, the update service selects the higher semantic version, then the higher build number. An exact tie uses the per-ABI installer. The higher of the two minimum versions applies to that ABI, and the client access policy continues to enforce its own version floor. An older per-ABI entry can stay in the catalog during migration. Unsupported ABIs never receive a universal fallback.

For an Android universal APK, set `latestBuild` to the manifest's actual versionCode. Use the established application ID and signing certificate and a versionCode higher than every previously distributed split APK. The Windows installer, macOS PKG and Linux `.run` installer each include x64 and arm64 payloads. The `.run` upload format is available for the Linux universal target.

The FastAI downloads page displays terminal installation instructions for a universal Linux release whose link ends in `.run`, or whose matching server upload records a ready `.run` with the published SHA-256. Other extensions and unidentified external links receive the regular download button.

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
