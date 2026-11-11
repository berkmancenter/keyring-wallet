#!/usr/bin/env bash
# Build card-verify and card-verify-v047 ONCE per VTI pin, for macOS, and record
# them in DIST.json. bifold's VTI conformance job downloads these binaries
# instead of compiling upstream's code on every run: at vta-service-v0.79.0 one
# dependency (trust-tasks-rs 0.37.2) needs more than 14 GB to compile, more than
# GitHub's standard runners have (11-11).
#
# Run it after any change to PINS.json's two VTI pins or to either checker's
# sources, from a checkout whose external/ clones are at the pins
# (node scripts/openvtc/setup-external.mjs, from an up-to-date tree), on an
# Apple-silicon Mac:
#
#   scripts/openvtc/card-verify-dist/build.sh            → build, write DIST.json (urls point at the release below)
#   scripts/openvtc/card-verify-dist/build.sh --publish  → also create the release and upload the binaries
#
# Then commit DIST.json in a PR. The conformance job refuses a binary whose
# sha256, VTI pin or source digest (digest.mjs) does not match.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
openvtc="$(cd "$here/.." && pwd -P)"
root="$(cd "$openvtc/../.." && pwd -P)"
publish=0
[ "${1:-}" = "--publish" ] && publish=1

[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || { echo "build.sh: needs an Apple-silicon Mac (the job runs on macos-15)" >&2; exit 1; }

pin_of() { node -e "process.stdout.write(require('$openvtc/PINS.json').repos['$1'].sha)"; }
vti="$(pin_of verifiable-trust-infrastructure)"
vti047="$(pin_of verifiable-trust-infrastructure-v047)"
tag="card-verify-dist-${vti:0:9}-${vti047:0:9}"
repo="berkmancenter/keyring-wallet"
out="${CARD_VERIFY_DIST_OUT:-$HOME/.keyring-gate/cvbuild/dist/$tag}"
mkdir -p "$out"

export MACOSX_DEPLOYMENT_TARGET=14.0
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"
# trust-tasks-rs 0.37.2 alone takes most of a 16-24 GB Mac's memory to compile,
# and macOS swaps to the same disk: on 11-11 a build here took the disk from 11
# to under 4 GiB in 20 minutes. Run it as the machine's only heavy job; this
# watchdog stops the build if free disk falls below the floor.
target_root="${CARGO_TARGET_ROOT:-$HOME/.keyring-gate/cvbuild}"
floor_gib="${CARD_VERIFY_DISK_FLOOR_GIB:-8}"
( while sleep 20; do
    free_kb="$(df -k / | awk 'NR==2{print $4}')"
    if [ "$free_kb" -lt $((floor_gib * 1024 * 1024)) ]; then
      echo "build.sh: free disk under ${floor_gib} GiB, stopping the build" >&2
      pkill -TERM -f "$target_root/target-" || true
      exit 0
    fi
  done ) &
watchdog=$!
trap 'kill $watchdog 2>/dev/null || true' EXIT

entries=()
for name in card-verify card-verify-v047; do
  if [ "$name" = card-verify ]; then pin="$vti"; clone="verifiable-trust-infrastructure"; else pin="$vti047"; clone="verifiable-trust-infrastructure-v047"; fi
  head="$(git -C "$root/external/$clone" rev-parse HEAD)"
  case "$head" in "$pin"*) ;; *) echo "build.sh: external/$clone is at $head, not the pin $pin; run setup-external.mjs from an up-to-date tree" >&2; exit 1;; esac
  target="$target_root/target-$name"
  ( cd "$openvtc/$name" && CARGO_TARGET_DIR="$target" cargo build --release --locked )
  bin="$target/release/$name"
  # Only system libraries: a Homebrew or local dylib would not exist on the runner.
  if otool -L "$bin" | tail -n +2 | awk '{print $1}' | grep -vE '^(/usr/lib/|/System/Library/)'; then
    echo "build.sh: $name links a library outside /usr/lib and /System" >&2; exit 1
  fi
  cp "$bin" "$out/$name"
  sha="$(shasum -a 256 "$out/$name" | awk '{print $1}')"
  digest="$(node "$here/digest.mjs" "$openvtc/$name" "$pin")"
  url="https://github.com/$repo/releases/download/$tag/$name"
  entries+=("\"$name\": {\"vtiPin\": \"$pin\", \"sourceDigest\": \"$digest\", \"sha256\": \"$sha\", \"url\": \"$url\", \"target\": \"aarch64-apple-darwin\", \"minMacOS\": \"$MACOSX_DEPLOYMENT_TARGET\"}")
done

{
  echo "{"
  echo "  \"note\": \"Prebuilt checkers for bifold's VTI conformance job. Written by build.sh; do not edit by hand. Rebuild after a VTI pin bump or a change to either checker's sources.\","
  echo "  \"release\": \"$tag\","
  echo "  \"builtAt\": \"$(date -u +%FT%TZ)\","
  echo "  \"rustc\": \"$(rustc --version)\","
  echo "  \"checkers\": {"
  echo "    ${entries[0]},"
  echo "    ${entries[1]}"
  echo "  }"
  echo "}"
} > "$here/DIST.json"
node -e "JSON.parse(require('fs').readFileSync('$here/DIST.json','utf8'))"
echo "wrote $here/DIST.json ($tag)"

if [ "$publish" = 1 ]; then
  if gh release view "$tag" -R "$repo" >/dev/null 2>&1; then
    gh release upload "$tag" "$out/card-verify" "$out/card-verify-v047" -R "$repo" --clobber
  else
    gh release create "$tag" "$out/card-verify" "$out/card-verify-v047" -R "$repo" --prerelease --target main \
      --title "card-verify $tag" --notes "Prebuilt VTI checkers for bifold's conformance job (macOS arm64). Not an app release. See scripts/openvtc/card-verify-dist/."
  fi
  echo "published $tag"
fi
