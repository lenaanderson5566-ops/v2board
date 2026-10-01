# V2Board React console

React + TypeScript + Vite provide the user workspace and unified admin console.
Laravel retains all authentication, billing, node, risk and persistence logic.

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
