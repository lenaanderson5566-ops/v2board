# Shared by the copied installation and upgrade commands.
set -eu
[ "$(id -u)" -eq 0 ] || { echo 'Run as root on Linux' >&2; exit 1; }
[ "$(uname -s)" = Linux ] || { echo 'This installer requires Linux' >&2; exit 1; }
missing=false
for tool in curl bash jq unzip sha256sum install python3 openssl flock timeout; do
  command -v "$tool" >/dev/null 2>&1 || missing=true
done
if [ "$missing" = true ]; then
  if command -v apt-get >/dev/null; then
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl bash jq unzip coreutils python3 openssl util-linux
  elif command -v apk >/dev/null; then apk add --no-cache ca-certificates curl bash jq unzip coreutils python3 openssl flock
  elif command -v dnf >/dev/null; then dnf install -y ca-certificates curl bash jq unzip coreutils python3 openssl util-linux
  elif command -v yum >/dev/null; then yum install -y ca-certificates curl bash jq unzip coreutils python3 openssl util-linux
  else echo 'Install curl, bash, jq, unzip, coreutils, python3, openssl and flock first' >&2; exit 1; fi
fi
for tool in curl bash jq unzip sha256sum install python3 openssl flock timeout; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing required command: $tool" >&2; exit 1; }
done
