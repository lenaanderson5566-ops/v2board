#!/usr/bin/env bash
# One-use grant on stdin; no long-lived key in shell arguments or command history.
set +x
set -euo pipefail
umask 077
IFS= read -r panel_url
IFS= read -r grant
[[ $EUID -eq 0 && $(uname -s) == Linux ]] || { echo 'Run as root on Linux' >&2; exit 1; }
[[ "$panel_url" =~ ^https://[^/?#[:space:]@]+(/[^?#[:space:]]*)?$ && "$grant" =~ ^nd_[a-f0-9]{64}$ ]] || { echo 'Invalid deployment authorization' >&2; exit 1; }
for tool in curl jq unzip sha256sum install; do
  if ! command -v "$tool" >/dev/null; then
    if command -v apt-get >/dev/null; then
      apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl jq unzip coreutils
    elif command -v apk >/dev/null; then apk add --no-cache ca-certificates curl jq unzip coreutils
    elif command -v dnf >/dev/null; then dnf install -y ca-certificates curl jq unzip coreutils
    elif command -v yum >/dev/null; then yum install -y ca-certificates curl jq unzip coreutils
    else echo 'Install curl, jq, unzip and coreutils first' >&2; exit 1; fi
    break
  fi
done
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
jq -e --arg host "$panel_url" '.data | .nodeType == "v2box" and .apiHost == $host and (.nodeId | type == "number" and . > 0 and floor == .) and (.apiKey | test("^nk_[a-f0-9]{32}\\.[a-f0-9]{64}$"))' "$stage/response.json" >/dev/null || { echo 'Invalid deployment response' >&2; exit 1; }
# Atomic same-directory write; the secret is never passed as an argument.
config_stage=$(mktemp /etc/v2box/.config.XXXXXXXX)
jq '.data | {Log:{Level:"info"},Nodes:[{NodeType:.nodeType,ApiHost:.apiHost,NodeID:.nodeId,ApiKey:.apiKey,ApiVersion:"v10",Timeout:15,RetryCount:1,LandingPage:{Enabled:false,Directory:""}}]}' "$stage/response.json" > "$config_stage"
chmod 600 "$config_stage"
mv -f -- "$config_stage" /etc/v2box/config.json
config_stage=''
rm -f /etc/v2box/.deployment-pending
v2box restart
echo 'Installation complete. Check node authentication and runtime status in the panel.'
