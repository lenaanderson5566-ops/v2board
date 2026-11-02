# Shared by the copied installation and upgrade commands.
set -eu
[ "$(id -u)" -eq 0 ] || { echo 'Run as root on Linux' >&2; exit 1; }
[ "$(uname -s)" = Linux ] || { echo 'This installer requires Linux' >&2; exit 1; }
missing=false
for tool in curl bash jq unzip sha256sum install python3 openssl flock timeout; do
  command -v "$tool" >/dev/null 2>&1 || missing=true
done
# Lifecycle cleanup relies on GNU timeout's process groups. BusyBox supplies a
# command of the same name, so presence alone does not establish compatibility.
if ! timeout --foreground -k 1 1 true </dev/null >/dev/null 2>&1; then missing=true; fi
prerequisite_run() {
  result=0
  timeout -k 120 600 "$@" </dev/null 7>&- 8>&- 9>&- || result=$?
  if [ "$result" -ne 0 ]; then
    echo "Dependency setup failed or exceeded 10 minutes ($1, exit $result). Check package-manager locks, network access and disk space, then rerun. Do not delete package-manager locks; deployment authorization has not been consumed." >&2
  fi
  return "$result"
}
if [ "$missing" = true ]; then
  command -v timeout >/dev/null 2>&1 || { echo 'Install coreutils (including timeout) first, then rerun this command. No deployment authorization was consumed.' >&2; exit 1; }
  echo 'Installing required tools with a 10-minute limit per package operation. Existing package-manager locks and configurations are retained.'
  if command -v apt-get >/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    prerequisite_run apt-get -o DPkg::Lock::Timeout=60 -o Acquire::Retries=1 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 update -qq
    prerequisite_run apt-get -o DPkg::Lock::Timeout=60 -o Acquire::Retries=1 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 -o Dpkg::Options::=--force-confold install -y -qq ca-certificates curl bash jq unzip coreutils python3 openssl util-linux
  elif command -v apk >/dev/null; then prerequisite_run apk add --no-cache ca-certificates curl bash jq unzip coreutils python3 openssl flock
  elif command -v dnf >/dev/null; then prerequisite_run dnf -y --setopt=timeout=15 --setopt=retries=1 install ca-certificates curl bash jq unzip coreutils python3 openssl util-linux
  elif command -v yum >/dev/null; then prerequisite_run yum -y --setopt=timeout=15 --setopt=retries=1 install ca-certificates curl bash jq unzip coreutils python3 openssl util-linux
  else echo 'Install curl, bash, jq, unzip, coreutils, python3, openssl and flock first' >&2; exit 1; fi
fi
for tool in curl bash jq unzip sha256sum install python3 openssl flock timeout; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing required command: $tool" >&2; exit 1; }
done
timeout --foreground -k 1 1 true </dev/null >/dev/null 2>&1 || { echo 'GNU coreutils timeout is required. Repair coreutils and PATH before rerunning; deployment authorization has not been consumed.' >&2; exit 1; }
