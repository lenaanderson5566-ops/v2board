# FastAI sing-box configuration

FastAI requests `GET /api/v10/me/client-config?clientVersion=...&platform=windows&architecture=x64&core=sing-box` using its native bearer session. The default `core=mihomo` and existing YAML / JSON contracts remain compatible.

The JSON response contains `data.configVersion`, `core`, `coreVersion`, `configuration`, and stable `nodes` metadata. Response marker: `X-FastAI-Config-Version: 3`. Authentication, entitlement, account restrictions and minimum app version checks remain shared with Mihomo.

The app-specific template is `resources/rules/default.fastai.sing-box.json`. To customize it, create `resources/rules/custom.fastai.sing-box.json`. Public sing-box subscriptions continue to use `default.sing-box.json` / `custom.sing-box.json`. Templates must keep the `节点选择` selector and `自动选择` urltest group for generated nodes. Do not reuse stable `node_*` identities as template tags.

The app owns listener ports, TUN and controller lifecycle. Remote rule-set downloads are rejected. The initial template sends private addresses directly and other traffic through the selected group; it does not reproduce the Mihomo bundled China Geo rules.

The integrated stable core is sing-box 1.14.3. The first enabled platform is Windows. Windows builds enable Naive with `with_naive_outbound,with_purego` and bundle the pinned Cronet DLL. The core verifies and loads that DLL before reporting local Naive support. The backend always exports all sing-box nodes; the client filters unsupported nodes and updates their groups locally. No capability parameter is sent to the backend. If no compatible proxy remains or a custom route depends on a removed node, the client keeps its previous configuration and reports the compatibility issue. Missing or modified DLLs never fall back to an arbitrary PATH library. Public subscriptions are unaffected. Android and other platforms continue to use Mihomo until their native VPN integration is implemented and tested.

Windows FastAI defaults to sing-box when no core choice is saved, while explicit Mihomo selections remain respected. The API default stays `mihomo` for compatibility; the app explicitly requests `core=sing-box`. Android integration follows Windows and currently continues to request Mihomo.
