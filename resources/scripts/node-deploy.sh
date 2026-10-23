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
  [[ ! -e /etc/v2box/deployment-state.json ]] || { echo 'Resume the pending deployment before upgrading.' >&2; exit 1; }
  shift
  stage=$(mktemp -d)
  trap 'rm -rf -- "$stage"' EXIT
  curl -fSL --proto '=https' --connect-timeout 10 --max-time 120 https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.3/script/install.sh -o "$stage/install.sh"
  bash "$stage/install.sh" "$@" 9>&-
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
if [[ "${1:-}" == --resume ]]; then
  [[ $# -eq 1 ]] || { echo 'Use --resume without other arguments' >&2; exit 1; }
  install_helper
  exec python3 /usr/local/lib/v2box/panel-deploy.py /etc/v2box/deployment-state.json
fi
requested_id=''
grant=''
if (($#)); then
  panel_url=''
  while (($#)); do
    (($# >= 2)) || { echo 'Missing deployment argument' >&2; exit 1; }
    case "$1" in
      --api-host) panel_url=$2;;
      --node-id) requested_id=$2;;
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
[[ "$panel_url" =~ ^https://[^/?#[:space:]@]+(/[^?#[:space:]]*)?$ && "$grant" =~ ^nd_[a-f0-9]{64}$ ]] || { echo 'Invalid deployment authorization' >&2; exit 1; }
[[ ! -L /etc/v2box && ! -L /etc/v2box/config.json && ! -L /etc/v2box/.deployment-pending ]] || { echo 'Refusing symlinked configuration' >&2; exit 1; }
if [[ -e /etc/v2box/deployment-state.json ]]; then
  [[ ! -L /etc/v2box/deployment-state.json ]] || exit 1
  jq -e --arg host "$panel_url" --arg id "$requested_id" '.data.apiHost == $host and (.data.nodeId | tostring) == $id' /etc/v2box/deployment-state.json >/dev/null || { echo 'Pending deployment belongs to another node; preserved.' >&2; exit 1; }
  install_helper
  exec python3 /usr/local/lib/v2box/panel-deploy.py /etc/v2box/deployment-state.json
fi
if [[ -e /etc/v2box/config.json ]]; then
  [[ -f /etc/v2box/.deployment-pending ]] && jq -e '.Nodes | length == 1 and .[0].ApiKey == "REPLACE_ME" and .[0].ApiHost == "https://panel.example.com"' /etc/v2box/config.json >/dev/null || {
    echo 'Existing node configuration preserved. Use the upgrade command or v2box credential.' >&2; exit 1;
  }
fi
install -d -m 755 /etc/v2box
: > /etc/v2box/.deployment-pending
stage=$(mktemp -d)
config_stage=''
trap 'rm -rf -- "$stage"; [[ -z "$config_stage" ]] || rm -f -- "$config_stage"' EXIT
# Finish package download and verification before consuming the grant.
curl -fSL --proto '=https' --connect-timeout 10 --max-time 120 https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.3/script/install.sh -o "$stage/install.sh"
bash "$stage/install.sh" v1.0.3 </dev/null 9>&-
printf 'header = "Authorization: Bearer %s"\n' "$grant" > "$stage/authorization"
unset grant
curl -fsS --proto '=https' --connect-timeout 10 --max-time 30 --config "$stage/authorization" --header 'Content-Type: application/json' --data '{}' \
  "$panel_url/api/v10/server/enrollments/redeem" -o "$stage/response.json"
jq -e --arg host "$panel_url" --arg expected "$requested_id" '.data | ($expected == "" or (.nodeId | tostring) == $expected) and .nodeType == "v2box" and .apiHost == $host and (.nodeId | type == "number" and . > 0 and floor == .) and (.apiKey | test("^nk_[a-f0-9]{32}\\.[a-f0-9]{64}$"))' "$stage/response.json" >/dev/null || { echo 'Invalid deployment response' >&2; exit 1; }
# Preserve enrollment only in a private local file so a consumed grant can be resumed.
[[ ! -L /etc/v2box/deployment-state.json ]] || exit 1
config_stage=$(mktemp /etc/v2box/.deployment-state.XXXXXXXX)
cp "$stage/response.json" "$config_stage"
chmod 600 "$config_stage"
mv -f -- "$config_stage" /etc/v2box/deployment-state.json
config_stage=''
install_helper
python3 /usr/local/lib/v2box/panel-deploy.py /etc/v2box/deployment-state.json
