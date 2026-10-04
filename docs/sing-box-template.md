# sing-box template requirements

The default template requires sing-box 1.14.0 or newer. Remote rule sets use an explicit shared HTTP client (`rule-download`) routed through the selected proxy group, replacing deprecated `download_detour`.

References:
- https://sing-box.sagernet.org/configuration/rule-set/
- https://sing-box.sagernet.org/configuration/shared/http-client/

After deployment, refresh the remote profile in the client. Existing downloaded profiles are not changed until refreshed.

If `resources/rules/custom.sing-box.json` exists on the server, it takes precedence over the default template. Update its remote rule sets to use `http_client`, and define the corresponding top-level `http_clients` and `route.default_http_client`, preserving the intended outbound. Updating the default alone does not update a custom template.

Hiddify is hidden from device selection, including alternatives. Existing import URL helpers and backend subscription format handling remain available; compatibility with a particular installed Hiddify core version is not guaranteed by hiding its entry.
