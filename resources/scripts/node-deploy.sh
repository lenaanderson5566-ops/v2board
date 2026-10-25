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
  curl -fSL --proto '=https' --connect-timeout 10 --max-time 120 https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.11/script/install.sh -o "$stage/install.sh"
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
# Resume can follow uninstall: restore programs before invoking the helper.
restore_programs() {
  [[ -f /etc/v2box/deployment-state.json && ! -L /etc/v2box/deployment-state.json ]] || { echo 'No private deployment state found. Generate a deployment command in the panel.' >&2; exit 1; }
  [[ $(stat -c '%a' /etc/v2box/deployment-state.json) == 600 ]] || { echo 'Deployment state must have mode 600. Run chmod 600 /etc/v2box/deployment-state.json, then resume.' >&2; exit 1; }
  if ! programs_ready; then
    echo 'Deployment recovery: restoring missing V2Box programs; configuration and certificates are retained.'
    stage=$(mktemp -d)
    trap 'rm -rf -- "$stage"' EXIT
    curl -fSL --proto '=https' --connect-timeout 10 --max-time 120 https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.11/script/install.sh -o "$stage/install.sh" || { echo 'Program download failed. Check HTTPS access to GitHub, then run this script with --resume.' >&2; exit 1; }
    V2BOX_BOOTSTRAP_LOCK_HELD=1 bash "$stage/install.sh" v1.0.11 </dev/null 9>&- || { echo 'Program restoration failed. Configuration and certificates retained; fix the installer error above, then --resume.' >&2; exit 1; }
    programs_ready || { echo 'Program restoration is incomplete. Check disk space, permissions and release files, then run --resume; do not remove configuration or certificates.' >&2; exit 1; }
    rm -rf -- "$stage"
    trap - EXIT
  fi
}
if [[ "${1:-}" == --resume ]]; then
  [[ $# -eq 1 ]] || { echo 'Use --resume without other arguments' >&2; exit 1; }
  restore_programs
  install_helper
  exec python3 /usr/local/lib/v2box/panel-deploy.py /etc/v2box/deployment-state.json
fi
requested_id=''
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
[[ $EUID -eq 0 && $(uname -s) == Linux ]] || { echo 'Run as root on Linux' >&2; exit 1; }
[[ "$panel_url" =~ ^https://[^/?#[:space:]@]+(/[^?#[:space:]]*)?$ && "$grant" =~ ^n[ds]_[a-f0-9]{64}$ ]] || { echo 'Invalid deployment authorization' >&2; exit 1; }
if $network_only; then
  # Only configure the independent reporter. Never install/restart V2Box or change its key.
  [[ ! -e /etc/v2box/deployment-state.json ]] || { echo 'Resume the pending node deployment first.' >&2; exit 1; }
  if ! $server_only; then
  [[ -f /etc/v2box/config.json && ! -L /etc/v2box/config.json ]] || { echo 'Install V2Box on this server before configuring reporting.' >&2; exit 1; }
  jq -e --arg host "$panel_url" --argjson id "$requested_id" '.Nodes | any(.NodeType == "v2box" and .NodeID == $id and .ApiHost == $host)' /etc/v2box/config.json >/dev/null || { echo 'This server configuration does not match the selected panel and node; preserved.' >&2; exit 1; }
  fi
  [[ ! -L /etc/node-network && ! -L /etc/node-network/enrollment-state.json ]] || { echo 'Refusing symlinked reporting state' >&2; exit 1; }
  if $server_only && [[ -f /etc/node-network/server-identity && "$(cat /etc/node-network/server-identity)" != "$panel_url/$requested_id" ]]; then
    echo 'This machine belongs to another physical server. No authorization was consumed.' >&2; exit 1
  fi
  install -d -m 700 /etc/node-network
  stage=$(mktemp -d)
  trap 'rm -rf -- "$stage"' EXIT
  # Download and validate prerequisites before consuming the one-use grant.
  curl -fsS --proto '=https' --connect-timeout 10 --max-time 120 https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.11/script/node-network.py -o "$stage/node-network.py"
  python3 -m py_compile "$stage/node-network.py"
  validate_network_response() {
    jq -e --arg host "$panel_url" --argjson id "$requested_id" --argjson server "$server_only" '.data | (if $server then .purpose == "server" and .serverId == $id else .purpose == "network" and .nodeType == "v2box" and .nodeId == $id end) and .apiHost == $host and (has("apiKey") | not) and (.networkReport.token | test("^[a-f0-9]{64}$")) and (.networkReport.family | . == "ipv4" or . == "ipv6" or . == "dual")' "$1" >/dev/null
  }
  if [[ -e /etc/node-network/enrollment-state.json ]]; then
    [[ $(stat -c '%a' /etc/node-network/enrollment-state.json) == 600 ]] || { echo 'Reporting state must have mode 600' >&2; exit 1; }
    validate_network_response /etc/node-network/enrollment-state.json || { echo 'Pending reporting setup belongs to another node; preserved.' >&2; exit 1; }
  else
    printf 'header = "Authorization: Bearer %s"\n' "$grant" > "$stage/authorization"
    unset grant
    curl -fsS --proto '=https' --connect-timeout 10 --max-time 30 --config "$stage/authorization" --header 'Content-Type: application/json' --data '{}' \
      "$panel_url/api/v10/server/enrollments/redeem" -o "$stage/response.json"
    validate_network_response "$stage/response.json" || { echo 'Invalid reporting setup response' >&2; exit 1; }
    state_stage=$(mktemp /etc/node-network/.enrollment.XXXXXXXX)
    cp "$stage/response.json" "$state_stage"
    chmod 600 "$state_stage"
    mv -f -- "$state_stage" /etc/node-network/enrollment-state.json
  fi
  server_id=$(jq -r '.data.networkReport.serverId // empty' /etc/node-network/enrollment-state.json)
  identity="$panel_url/$server_id"
  [[ ! -L /etc/node-network/server-identity ]] || { echo 'Refusing symlinked server identity' >&2; exit 1; }
  if [[ -f /etc/node-network/server-identity && "$(cat /etc/node-network/server-identity)" != "$identity" ]]; then
    echo 'This machine is already bound to another physical server. Existing reporting configuration preserved.' >&2; exit 1
  fi
  jq -r '.data.networkReport.token' /etc/node-network/enrollment-state.json > "$stage/report-key"
  family=$(jq -r '.data.networkReport.family' /etc/node-network/enrollment-state.json)
  if ! python3 "$stage/node-network.py" report-configure --panel-url "$panel_url" --family "$family" --token-file "$stage/report-key"; then
    echo 'IP reporting setup incomplete. Re-run the same command to resume. V2Box was not restarted. If the reporting key was revoked, remove only /etc/node-network/enrollment-state.json and generate a new command.' >&2
    exit 1
  fi
  printf '%s\n' "$identity" > /etc/node-network/server-identity
  chmod 600 /etc/node-network/server-identity
  rm -f -- /etc/node-network/enrollment-state.json
  echo 'IP reporting configured and first report accepted. Check DNS synchronization in the panel.'
  exit
fi
[[ ! -L /etc/v2box && ! -L /etc/v2box/config.json && ! -L /etc/v2box/.deployment-pending ]] || { echo 'Refusing symlinked configuration' >&2; exit 1; }
grant_hash=$(printf '%s' "$grant" | sha256sum | cut -d ' ' -f 1)
if [[ -e /etc/v2box/deployment-state.json ]]; then
  [[ ! -L /etc/v2box/deployment-state.json ]] || exit 1
  jq -e --arg host "$panel_url" --arg id "$requested_id" '.data.apiHost == $host and (.data.nodeId | tostring) == $id' /etc/v2box/deployment-state.json >/dev/null || { echo 'Pending deployment belongs to another node; preserved.' >&2; exit 1; }
  if jq -e --arg hash "$grant_hash" '.grantHash == $hash' /etc/v2box/deployment-state.json >/dev/null; then
    restore_programs
    install_helper
    exec python3 /usr/local/lib/v2box/panel-deploy.py /etc/v2box/deployment-state.json
  fi
  echo 'New deployment authorization supplied; previous state retained until redemption succeeds.'
fi
existing_install=false
if [[ -e /etc/v2box/config.json ]]; then
  if jq -e '.Nodes | length == 1 and .[0].ApiKey == "REPLACE_ME" and .[0].ApiHost == "https://panel.example.com"' /etc/v2box/config.json >/dev/null; then
    :
  else
    jq -e --arg host "$panel_url" --argjson id "$requested_id" '.Nodes | length > 0 and all(.[]; .NodeType == "v2box" and .ApiHost == $host)' /etc/v2box/config.json >/dev/null || { echo 'Existing configuration belongs to another panel or backend; preserved.' >&2; exit 1; }
    existing_install=true
  fi
fi
install -d -m 755 /etc/v2box
stage=$(mktemp -d)
config_stage=''
trap 'rm -rf -- "$stage"; [[ -z "$config_stage" ]] || rm -f -- "$config_stage"' EXIT
if ! $existing_install || ! programs_ready; then
  echo 'Checking installation: installing or repairing V2Box program files; existing configuration and certificates are retained.'
  : > /etc/v2box/.deployment-pending
  curl -fSL --proto '=https' --connect-timeout 10 --max-time 120 https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.11/script/install.sh -o "$stage/install.sh"
  V2BOX_BOOTSTRAP_LOCK_HELD=1 bash "$stage/install.sh" v1.0.11 </dev/null 9>&-
  programs_ready || { echo 'Installation is incomplete. Check disk space, permissions and release files, then rerun this command. Deployment authorization has not been consumed.' >&2; exit 1; }
fi
printf 'header = "Authorization: Bearer %s"\n' "$grant" > "$stage/authorization"
unset grant
curl -fsS --proto '=https' --connect-timeout 10 --max-time 30 --config "$stage/authorization" --header 'Content-Type: application/json' --data '{}' \
  "$panel_url/api/v10/server/enrollments/redeem" -o "$stage/response.json" || { echo 'Authorization redemption failed. Existing deployment state and configuration were retained. For an expired or used grant, generate a new command in the panel; use --resume only for the existing valid task. Check HTTPS/gateway access if the request cannot reach the panel.' >&2; exit 1; }
jq -e --arg host "$panel_url" --arg expected "$requested_id" '.data | ($expected == "" or (.nodeId | tostring) == $expected) and .nodeType == "v2box" and .apiHost == $host and (.nodeId | type == "number" and . > 0 and floor == .) and (.apiKey | test("^nk_[a-f0-9]{32}\\.[a-f0-9]{64}$"))' "$stage/response.json" >/dev/null || { echo 'Invalid deployment response' >&2; exit 1; }
# Preserve enrollment only in a private local file so a consumed grant can be resumed.
[[ ! -L /etc/v2box/deployment-state.json ]] || exit 1
config_stage=$(mktemp /etc/v2box/.deployment-state.XXXXXXXX)
jq --arg hash "$grant_hash" '. + {grantHash:$hash, replaceCredential:true}' "$stage/response.json" > "$config_stage"
chmod 600 "$config_stage"
mv -f -- "$config_stage" /etc/v2box/deployment-state.json
config_stage=''
install_helper
python3 /usr/local/lib/v2box/panel-deploy.py /etc/v2box/deployment-state.json
