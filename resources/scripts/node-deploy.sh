#!/bin/sh
# One-use grant on stdin; no long-lived key in shell arguments or command history.
set +x
set -eu
__NODE_PREREQUISITES__
# The downloaded entry point works with sh even if bash was initially absent.
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -o pipefail
umask 077
if [[ "${1:-}" == --install ]]; then
  shift
  stage=$(mktemp -d)
  trap 'rm -rf -- "$stage"' EXIT
  curl -fSL --proto '=https' --connect-timeout 10 --max-time 120 https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.2/script/install.sh -o "$stage/install.sh"
  bash "$stage/install.sh" "$@"
  exit
fi
requested_id=''
if (($#)); then
  panel_url=''
  while (($#)); do
    (($# >= 2)) || { echo 'Missing deployment argument' >&2; exit 1; }
    case "$1" in
      --api-host) panel_url=$2;;
      --node-id) requested_id=$2;;
      *) echo 'Unknown deployment argument' >&2; exit 1;;
    esac
    shift 2
  done
  [[ "$requested_id" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid node ID' >&2; exit 1; }
  IFS= read -r grant
else
  # Compatibility with previously copied URL/grant stdin commands.
  IFS= read -r panel_url
  IFS= read -r grant
fi
[[ $EUID -eq 0 && $(uname -s) == Linux ]] || { echo 'Run as root on Linux' >&2; exit 1; }
[[ "$panel_url" =~ ^https://[^/?#[:space:]@]+(/[^?#[:space:]]*)?$ && "$grant" =~ ^nd_[a-f0-9]{64}$ ]] || { echo 'Invalid deployment authorization' >&2; exit 1; }
[[ ! -L /etc/v2box && ! -L /etc/v2box/config.json && ! -L /etc/v2box/.deployment-pending ]] || { echo 'Refusing symlinked configuration' >&2; exit 1; }
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
curl -fSL --proto '=https' --connect-timeout 10 --max-time 120 https://raw.githubusercontent.com/lenaanderson5566-ops/v2box/v1.0.2/script/install.sh -o "$stage/install.sh"
bash "$stage/install.sh" v1.0.2 </dev/null
printf 'header = "Authorization: Bearer %s"\n' "$grant" > "$stage/authorization"
unset grant
curl -fsS --proto '=https' --connect-timeout 10 --max-time 30 --config "$stage/authorization" --header 'Content-Type: application/json' --data '{}' \
  "$panel_url/api/v10/server/enrollments/redeem" -o "$stage/response.json"
jq -e --arg host "$panel_url" --arg expected "$requested_id" '.data | ($expected == "" or (.nodeId | tostring) == $expected) and .nodeType == "v2box" and .apiHost == $host and (.nodeId | type == "number" and . > 0 and floor == .) and (.apiKey | test("^nk_[a-f0-9]{32}\\.[a-f0-9]{64}$"))' "$stage/response.json" >/dev/null || { echo 'Invalid deployment response' >&2; exit 1; }
# Atomic same-directory write; the secret is never passed as an argument.
config_stage=$(mktemp /etc/v2box/.config.XXXXXXXX)
jq '.data | {Log:{Level:"info"},Nodes:[{NodeType:.nodeType,ApiHost:.apiHost,NodeID:.nodeId,ApiKey:.apiKey,ApiVersion:"v10",Timeout:15,RetryCount:1,LandingPage:{Enabled:false,Directory:""}}]}' "$stage/response.json" > "$config_stage"
chmod 600 "$config_stage"
mv -f -- "$config_stage" /etc/v2box/config.json
config_stage=''
rm -f /etc/v2box/.deployment-pending
v2box restart
echo 'Installation complete. Check node authentication and runtime status in the panel.'
