#!/bin/sh
# One-use grant via --deploy-token (legacy stdin supported); never a long-lived key.
set +x
set -eu
__NODE_PREREQUISITES__
# The downloaded entry point works with sh even if bash was initially absent.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -o pipefail
umask 077
[[ ! -L /etc/v2box && ! -L /etc/v2box/.bootstrap.lock ]] || { echo 'Refusing symlinked deployment directory or lock' >&2; exit 1; }
install -d -m 755 /etc/v2box
exec 9>/etc/v2box/.bootstrap.lock
flock -n 9 || { echo 'Another deployment is running; wait for it to finish.' >&2; exit 1; }
if [[ "${1:-}" == --install ]]; then
  shift
  stage=$(mktemp -d)
  trap 'rm -rf -- "$stage"' EXIT
  curl -fSL --proto '=https' --connect-timeout 10 --max-time 120 https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.13/script/install.sh -o "$stage/install.sh"
  V2BOX_BOOTSTRAP_LOCK_HELD=1 bash "$stage/install.sh" "$@" 9>&-
  exit
fi
# Install the panel-shipped workflow independently of the pinned node binary.
install_helper() {
  install -d -m 755 /usr/local/lib/v2box
  helper_stage=$(mktemp /usr/local/lib/v2box/.panel-deploy.XXXXXXXX)
  cat > "$helper_stage" <<'V2BOARD_DEPLOY_PY'
__NODE_DEPLOY_HELPER__
V2BOARD_DEPLOY_PY
  chmod 755 "$helper_stage"
  mv -f -- "$helper_stage" /usr/local/lib/v2box/panel-deploy.py
}
programs_ready() {
  [[ -x /usr/local/lib/v2box/v2box && -s /usr/local/lib/v2box/manager.sh && -s /usr/local/lib/v2box/install.sh && -s /usr/local/lib/v2box/node-network.py && -s /usr/local/lib/v2box/node-credentials.py && -x /usr/local/bin/v2box ]]
}
refuse_live_repair() {
  if { command -v systemctl >/dev/null && systemctl is-active --quiet v2box; } || { ! command -v systemctl >/dev/null && command -v rc-service >/dev/null && rc-service v2box status >/dev/null 2>&1; }; then
    echo 'Running V2Box has missing program files. Repair or upgrade it in a maintenance window first; existing nodes and authorization were preserved.' >&2
    exit 1
  fi
}
require_support() {
  timeout -k 2 10 /usr/local/lib/v2box/v2box capabilities | jq -e '.features | index("multi-panel-v1") != null and index("reload-signal-v1") != null' >/dev/null || {
    echo 'Installed V2Box does not support independent multi-panel deployment. Upgrade the node in a maintenance window first; authorization and existing settings were preserved.' >&2; exit 1;
  }
  timeout -k 2 10 python3 /usr/local/lib/v2box/node-network.py capabilities | jq -e '.features | index("report-multi-target-v1") != null' >/dev/null || {
    echo 'IP reporting helper does not support multiple targets. Upgrade the node scripts first; existing settings were preserved.' >&2; exit 1;
  }
  local sharing="${shared_listener:-}"
  if [[ -z "$sharing" && -n "${deployment_state:-}" && -f "$deployment_state" ]]; then sharing=$(jq -r '.sharedListener // ""' "$deployment_state"); fi
  if [[ -n "$sharing" ]]; then
    timeout -k 2 10 /usr/local/lib/v2box/v2box capabilities | jq -e '.features | index("shared-listener-v1") != null' >/dev/null || { echo 'Shared listeners requires a newer node program; authorization preserved.' >&2; exit 1; }
    /usr/local/bin/v2box check-runtime shared-listener-v1 | grep -qx shared-listener-v1 || { echo 'Running program or management script lacks shared listeners support; upgrade first.' >&2; exit 1; }
  else /usr/local/bin/v2box check-runtime; fi
}
select_resume_state() {
  shopt -s nullglob
  local states=(/etc/v2box/deployment-state*.json)
  ((${#states[@]} == 1)) || { echo 'More than one pending deployment (or none). Re-run the original panel command to resume its specific node; no state was changed.' >&2; exit 1; }
  deployment_state=${states[0]}
}
# Resume can follow uninstall: restore programs before invoking the helper.
restore_programs() {
  [[ -f ${deployment_state:-/etc/v2box/deployment-state.json} && ! -L ${deployment_state:-/etc/v2box/deployment-state.json} ]] || { echo 'No private deployment state found. Generate a deployment command in the panel.' >&2; exit 1; }
  [[ $(stat -c '%a' "${deployment_state:-/etc/v2box/deployment-state.json}") == 600 ]] || { echo 'Deployment state must have mode 600. Run chmod 600 ${deployment_state:-/etc/v2box/deployment-state.json}, then resume.' >&2; exit 1; }
  if ! programs_ready; then
    refuse_live_repair
    echo 'Deployment recovery: restoring missing V2Box programs; configuration and certificates are retained.'
    stage=$(mktemp -d)
    trap 'rm -rf -- "$stage"' EXIT
    curl -fSL --proto '=https' --connect-timeout 10 --max-time 120 https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.13/script/install.sh -o "$stage/install.sh" || { echo 'Program download failed. Check HTTPS access to GitHub, then run this script with --resume.' >&2; exit 1; }
    V2BOX_BOOTSTRAP_LOCK_HELD=1 bash "$stage/install.sh" v1.0.13 </dev/null 9>&- || { echo 'Program restoration failed. Configuration and certificates retained; fix the installer error above, then --resume.' >&2; exit 1; }
    programs_ready || { echo 'Program restoration is incomplete. Check disk space, permissions and release files, then run --resume; do not remove configuration or certificates.' >&2; exit 1; }
    rm -rf -- "$stage"
    trap - EXIT
  fi
}
if [[ "${1:-}" == --resume ]]; then
  [[ $# -eq 1 ]] || { echo 'Use --resume without other arguments' >&2; exit 1; }
  select_resume_state
  restore_programs
  require_support
  install_helper
  exec python3 /usr/local/lib/v2box/panel-deploy.py "$deployment_state"
fi
requested_id=''
shared_listener=''
grant=''
network_only=false
server_only=false
if (($#)); then
  panel_url=''
  while (($#)); do
    if [[ "$1" == --network-only ]]; then network_only=true; shift; continue; fi
    (($# >= 2)) || { echo 'Missing deployment argument' >&2; exit 1; }
    case "$1" in
      --api-host) panel_url=$2;;
      --node-id) requested_id=$2;;
      --shared-listener) shared_listener=$2;;
      --server-id) requested_id=$2; server_only=true; network_only=true;;
      --deploy-token) grant=$2;;
      *) echo 'Unknown deployment argument' >&2; exit 1;;
    esac
    shift 2
  done
  [[ "$requested_id" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid node ID' >&2; exit 1; }
  if [[ -z "$grant" ]]; then IFS= read -r grant; fi
else
  # Compatibility with previously copied URL/grant stdin commands.
  IFS= read -r panel_url
  IFS= read -r grant
fi
[[ -z "$shared_listener" || "$shared_listener" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$ ]] || { echo 'Invalid shared listener group' >&2; exit 1; }
if $network_only && [[ -n "$shared_listener" ]]; then echo 'Shared listener is only supported for node deployment.' >&2; exit 1; fi
[[ $EUID -eq 0 && $(uname -s) == Linux ]] || { echo 'Run as root on Linux' >&2; exit 1; }
[[ "$panel_url" =~ ^https://[^/?#[:space:]@]+(/[^?#[:space:]]*)?$ && "$grant" =~ ^n[ds]_[a-f0-9]{64}$ ]] || { echo 'Invalid deployment authorization' >&2; exit 1; }
if $network_only; then
  # Only configure the independent reporter. Never install/restart V2Box or change its key.
  if ! $server_only; then
  [[ -f /etc/v2box/config.json && ! -L /etc/v2box/config.json ]] || { echo 'Install V2Box on this server before configuring reporting.' >&2; exit 1; }
  jq -e --arg host "$panel_url" --argjson id "$requested_id" '.Nodes | any(.NodeType == "v2box" and .NodeID == $id and .ApiHost == $host)' /etc/v2box/config.json >/dev/null || { echo 'This server configuration does not match the selected panel and node; preserved.' >&2; exit 1; }
  fi
  [[ ! -L /etc/node-network && ! -L /etc/node-network/enrollment-state.json ]] || { echo 'Refusing symlinked reporting state' >&2; exit 1; }
  install -d -m 700 /etc/node-network
  stage=$(mktemp -d)
  trap 'rm -rf -- "$stage"' EXIT
  # Download and validate prerequisites before consuming the one-use grant.
  curl -fsS --proto '=https' --connect-timeout 10 --max-time 120 https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.13/script/node-network.py -o "$stage/node-network.py"
  python3 -m py_compile "$stage/node-network.py"
  python3 "$stage/node-network.py" capabilities | jq -e '.features | index("report-multi-target-v1") != null' >/dev/null || { echo 'Downloaded reporting helper lacks multi-target support; no authorization was consumed.' >&2; exit 1; }
  install_helper
  if $server_only; then python3 /usr/local/lib/v2box/panel-deploy.py --check-report-identity "$panel_url" "$requested_id"; fi
  install -m 755 "$stage/node-network.py" /usr/local/lib/v2box/node-network.py
  network_state="/etc/node-network/enrollment-state-$(printf '%s|%s|%s' "$panel_url" "$server_only" "$requested_id" | sha256sum | cut -d ' ' -f 1).json"

  validate_network_response() {
    jq -e --arg host "$panel_url" --argjson id "$requested_id" --argjson server "$server_only" '.data | (if $server then .purpose == "server" and .serverId == $id else .purpose == "network" and .nodeType == "v2box" and .nodeId == $id end) and .apiHost == $host and (has("apiKey") | not) and (.networkReport.token | test("^[a-f0-9]{64}$")) and (.networkReport.family | . == "ipv4" or . == "ipv6" or . == "dual")' "$1" >/dev/null
  }
  if [[ -f /etc/node-network/enrollment-state.json && ! -L /etc/node-network/enrollment-state.json ]] && validate_network_response /etc/node-network/enrollment-state.json; then
    network_state=/etc/node-network/enrollment-state.json
  fi
  [[ ! -L "$network_state" ]] || { echo 'Refusing symlinked reporting state' >&2; exit 1; }
  if [[ -e "$network_state" ]]; then
    [[ $(stat -c '%a' "$network_state") == 600 ]] || { echo 'Reporting state must have mode 600' >&2; exit 1; }
    validate_network_response "$network_state" || { echo 'Pending reporting setup belongs to another node; preserved.' >&2; exit 1; }
  else
    printf 'header = "Authorization: Bearer %s"\n' "$grant" > "$stage/authorization"
    unset grant
    curl -fsS --proto '=https' --connect-timeout 10 --max-time 30 --config "$stage/authorization" --header 'Content-Type: application/json' --data '{}' \
      "$panel_url/api/v10/server/enrollments/redeem" -o "$stage/response.json"
    validate_network_response "$stage/response.json" || { echo 'Invalid reporting setup response' >&2; exit 1; }
    state_stage=$(mktemp /etc/node-network/.enrollment.XXXXXXXX)
    cp "$stage/response.json" "$state_stage"
    chmod 600 "$state_stage"
    mv -f -- "$state_stage" "$network_state"
  fi
  python3 /usr/local/lib/v2box/panel-deploy.py --configure-report "$network_state" || {
    echo 'IP reporting setup incomplete. Re-run the same panel command to resume its saved target; other reporting settings were retained.' >&2; exit 1;
  }
  rm -f -- "$network_state"
  echo 'IP reporting configured and first report accepted. Check DNS synchronization in the panel.'
  exit
fi
[[ ! -L /etc/v2box && ! -L /etc/v2box/config.json && ! -L /etc/v2box/.deployment-pending ]] || { echo 'Refusing symlinked configuration' >&2; exit 1; }
deployment_state="/etc/v2box/deployment-state-$(printf '%s|%s' "$panel_url" "$requested_id" | sha256sum | cut -d ' ' -f 1).json"
if [[ -f /etc/v2box/deployment-state.json && ! -L /etc/v2box/deployment-state.json ]] && jq -e --arg host "$panel_url" --arg id "$requested_id" '.data.apiHost == $host and ($id == "" or (.data.nodeId | tostring) == $id)' /etc/v2box/deployment-state.json >/dev/null; then
  deployment_state=/etc/v2box/deployment-state.json
fi
grant_hash=$(printf '%s' "$grant" | sha256sum | cut -d ' ' -f 1)
if [[ -e "$deployment_state" ]]; then
  [[ ! -L "$deployment_state" ]] || exit 1
  jq -e --arg host "$panel_url" --arg id "$requested_id" '.data.apiHost == $host and ($id == "" or (.data.nodeId | tostring) == $id)' "$deployment_state" >/dev/null || { echo 'Pending deployment belongs to another node; preserved.' >&2; exit 1; }
  if [[ -n "$shared_listener" ]] && ! jq -e --arg shared "$shared_listener" '.sharedListener == $shared' "$deployment_state" >/dev/null; then echo 'Pending deployment has a different sharing selection; preserved.' >&2; exit 1; fi
  if jq -e --arg hash "$grant_hash" '.grantHash == $hash' "$deployment_state" >/dev/null; then
    restore_programs
    require_support
    install_helper
    exec python3 /usr/local/lib/v2box/panel-deploy.py "$deployment_state"
  fi
  echo 'New deployment authorization supplied; previous state retained until redemption succeeds.'
fi
existing_install=false
if [[ -e /etc/v2box/config.json ]]; then
  if jq -e '.Nodes | length == 1 and .[0].ApiKey == "REPLACE_ME" and .[0].ApiHost == "https://panel.example.com"' /etc/v2box/config.json >/dev/null; then
    :
  else
    jq -e '.Nodes | type == "array" and length > 0 and all(.[]; type == "object" and ((.NodeType // "v2node") == "v2box" or (.NodeType // "v2node") == "v2node") and (.ApiHost | type == "string" and test("^https://")) and (.NodeID | type == "number" and . > 0 and floor == .))' /etc/v2box/config.json >/dev/null || { echo 'Existing node configuration is invalid; preserved.' >&2; exit 1; }
    existing_install=true
  fi
fi
install -d -m 755 /etc/v2box
stage=$(mktemp -d)
config_stage=''
trap 'rm -rf -- "$stage"; [[ -z "$config_stage" ]] || rm -f -- "$config_stage"' EXIT
if ! $existing_install || ! programs_ready; then
  if $existing_install; then refuse_live_repair; fi
  echo 'Checking installation: installing or repairing V2Box program files; existing configuration and certificates are retained.'
  : > /etc/v2box/.deployment-pending
  curl -fSL --proto '=https' --connect-timeout 10 --max-time 120 https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.13/script/install.sh -o "$stage/install.sh"
  V2BOX_BOOTSTRAP_LOCK_HELD=1 bash "$stage/install.sh" v1.0.13 </dev/null 9>&-
  programs_ready || { echo 'Installation is incomplete. Check disk space, permissions and release files, then rerun this command. Deployment authorization has not been consumed.' >&2; exit 1; }
fi
require_support
install_helper
completed_state=${deployment_state/deployment-state/deployment-completed}
if [[ -n "$requested_id" ]] && python3 /usr/local/lib/v2box/panel-deploy.py --completed "$completed_state" /etc/v2box/config.json "$panel_url" "$requested_id" "$grant_hash"; then
  if [[ -n "$shared_listener" ]] && ! jq -e --arg host "$panel_url" --argjson id "$requested_id" --arg shared "$shared_listener" '.Nodes | any(.ApiHost == $host and .NodeID == $id and .SharedListener == $shared)' /etc/v2box/config.json >/dev/null; then
    echo 'Enrollment already completed. Use v2box share-listener to change existing local selections; credentials preserved.' >&2; exit 1
  fi
  echo 'This deployment command already completed for the configured node. Existing nodes, certificates and reporting settings were not changed.'
  exit
fi
printf 'header = "Authorization: Bearer %s"\n' "$grant" > "$stage/authorization"
unset grant
curl -fsS --proto '=https' --connect-timeout 10 --max-time 30 --config "$stage/authorization" --header 'Content-Type: application/json' --header 'X-Deployment-Capabilities: runtime-ready-v1' --data '{}' \
  "$panel_url/api/v10/server/enrollments/redeem" -o "$stage/response.json" || { echo 'Authorization redemption failed. Existing deployment state and configuration were retained. For an expired or used grant, generate a new command in the panel; use --resume only for the existing valid task. Check HTTPS/gateway access if the request cannot reach the panel.' >&2; exit 1; }
jq -e --arg host "$panel_url" --arg expected "$requested_id" '.data | ($expected == "" or (.nodeId | tostring) == $expected) and .nodeType == "v2box" and .apiHost == $host and (.nodeId | type == "number" and . > 0 and floor == .) and (.apiKey | test("^nk_[a-f0-9]{32}\\.[a-f0-9]{64}$"))' "$stage/response.json" >/dev/null || { echo 'Invalid deployment response' >&2; exit 1; }
if [[ -z "$requested_id" ]]; then
  resolved_id=$(jq -r '.data.nodeId' "$stage/response.json")
  if [[ ! -f "$deployment_state" ]] || ! jq -e --arg host "$panel_url" --argjson id "$resolved_id" '.data.apiHost == $host and .data.nodeId == $id' "$deployment_state" >/dev/null; then
    deployment_state="/etc/v2box/deployment-state-$(printf '%s|%s' "$panel_url" "$resolved_id" | sha256sum | cut -d ' ' -f 1).json"
  fi
fi
# Preserve enrollment only in a private local file so a consumed grant can be resumed.
[[ ! -L "$deployment_state" ]] || exit 1
config_stage=$(mktemp /etc/v2box/.deployment-state.XXXXXXXX)
jq --arg hash "$grant_hash" --arg shared "$shared_listener" '. + {grantHash:$hash, replaceCredential:true, sharedListener:$shared}' "$stage/response.json" > "$config_stage"
chmod 600 "$config_stage"
mv -f -- "$config_stage" "$deployment_state"
config_stage=''
install_helper
python3 /usr/local/lib/v2box/panel-deploy.py "$deployment_state"
