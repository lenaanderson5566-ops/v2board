# V2Board React console

React + TypeScript + Vite provide the user workspace and unified admin console.
Laravel retains all authentication, billing, node, risk and persistence logic.

The public `/` route displays the Studio assistant-themed landing page. The
examples use predefined translated text and do not call a model. Account pages
live under `/app#/dashboard`; existing `/#/…` bookmarks redirect to `/app`.
The landing page and its metadata use neutral standalone copy in eight languages.
Custom footer HTML remains on account pages and is excluded from the public page.

Admin setting controls follow the authenticated `console/configSchema` endpoint.
Boolean settings use switches; event modes and reset periods use explicit choices.
Node group and route arrays use multi-select controls, and related plans and groups
use options loaded from existing admin APIs.

Dependent settings appear only when their controlling feature is active; hidden
values are retained and settings saves submit only changed active fields. SMTP
encryption suggests a standard port while preserving custom ports. Gift-card and
coupon forms adjust units, required plans and batch options by type. Assigning a
user plan fills its limits without changing the entered balance or expiration.
Node protocol, TLS, Reality/ECH and transport selections control their structured
fields; advanced JSON parameters are preserved. Payment gateway changes load the
selected gateway's schema without carrying over another gateway's credentials.

## Build

```sh
cd frontend
npm ci
npm run build
npm test
```

The build writes `public/console` and its Vite manifest. These production assets
are checked into Git so PHP deployments do not require Node.js. Rebuild and
commit the generated files whenever frontend source changes. `routes/web.php`
renders both interfaces from the same build with separate authentication storage.

After deployment, run `php artisan console:verify` to check every manifest asset
and the landing, account and admin page actions. Use `--host=your.domain` to test
the visitor hostname against safe mode. This check works while maintenance is
enabled; it does not disable domain protection or replace a PHP-FPM/HTTP check.
The branch already includes production JS/CSS, so no ZIP upload is required.

For local iteration, `npm run dev` starts Vite with `/api` proxied to port 8080.
Open `http://127.0.0.1:5173/` for the user interface, or
`http://127.0.0.1:5173/?mode=admin&adminPath=admin` for the configured admin path.
Production-shell testing uses the Laravel URL after `npm run build`.

## Pages

User: dashboard, subscription links and nodes, plans, checkout, orders, traffic,
knowledge, ticket conversations, invitations, profile and active sessions.

Admin: overview, users, plans, nodes and routing, payments, coupons, gift cards,
notices, knowledge, ticket conversations, translations, client strategies, risk
rules and settings, IP/UA blacklists, online users, usage and logs, system settings.
The previous `/ops-center/*` bookmarks redirect to the matching admin hash route.

Theme discovery, selection and theme configuration routes have been removed.
Custom footer HTML is available in System Settings → 页脚 HTML, persisted as
`v2board.custom_footer_html`, and rendered only in the user shell. During upgrade,
the old selected theme's `custom_html` is used until the independent footer setting
has been saved. Administrator-provided footer scripts retain their original behavior.
Article and plan HTML is separately sanitized with DOMPurify.

## Languages and mobile UI

The user portal includes Simplified Chinese, Traditional Chinese, English,
Japanese, Korean, Vietnamese, Russian and Persian. `react-i18next` manages
reactive switching, English fallback, whole-message interpolation and plurals.
The language picker is available before and after sign-in. A saved choice takes
priority over browser language, and `html` language/direction follows that choice.
Persian uses RTL layout. Dates and numbers use `Intl` for the selected locale.
The admin console keeps its Chinese interface independently of the user's choice.

Language files are in `src/locales`. Translation keys are complete source messages;
do not concatenate translated sentence fragments. Use named interpolation values
and `count` for quantities. Translations are plain text escaped by React.
The translation source tables in `scripts` generate the five additional locales
and server errors; `npm run locales:generate` also generates Traditional Chinese.
Update the English and Simplified Chinese catalogs and translation tables together.
`npm test` verifies coverage, interpolation parameters, plural forms and source keys.

Requests carry `Content-Language`, which Laravel consumes for validation
messages and plan translations. Plan names, descriptions and knowledge articles
remain administrator-authored content: add their translations in the admin console.
Changing the interface language also selects the knowledge article language; it
can be overridden independently in the article filter.

Both interfaces share neutral surfaces, a compact sidebar and restrained controls.
At 800px and below, the user portal has fixed bottom navigation, safe-area padding,
44px touch targets, form inputs that avoid iOS zoom, readable table cards and bottom
sheets. Navigation drawers and dialogs manage focus, isolate the background and
support Escape. Reduced-motion preferences are respected.

## Subscription import

Quick import is available on the dashboard and subscription page. It supports
Clash/Mihomo, Hiddify, sing-box, Shadowrocket, Surge, Quantumult X, Stash and Surfboard.
The selection sheet offers direct app links, a QR code and a copy/manual fallback.
It preserves existing URL parameters, replaces format flags, validates HTTP(S)
subscription URLs and uses UTF-8 URL-safe base64 for Shadowrocket. No external
subscription converter receives the link. App launch requires an installed client;
the browser cannot reliably confirm import completion.

Protocol references: [Clash Verge](https://www.clashverge.dev/guide/url_schemes.html)
and [Hiddify](https://github.com/hiddify/hiddify-app/wiki/URL-Scheme); other schemes
retain the project's previous client integration. Do not publish real subscription
links or QR codes in screenshots, logs, analytics or tests.

## Verification

```sh
php tests/console-smoke.php
```

Run only against a configured local database. It creates a temporary transactional
admin, checks access control, page shells, removed theme endpoints, eight node
schemas, operations APIs, real MMDB queries and footer save/render. It restores the
config file, configuration cache, sessions and database state after execution.

GeoLite2 databases are committed under `storage/geoip`. Their release source and
attribution are in `storage/geoip/SOURCE.txt`; hashes are in `SHA256SUMS.txt`.
