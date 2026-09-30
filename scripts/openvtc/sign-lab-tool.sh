#!/usr/bin/env bash
# Sign a lab tool build with the one fixed local identity and point its stable
# path at it, so the login Keychain's "Always Allow" survives every rebuild.
#
#   scripts/openvtc/sign-lab-tool.sh <tool> [--build]
#   scripts/openvtc/sign-lab-tool.sh all          # every lab binary below, as built
#
# Tools: pnm, cnm, openvtc (CLIs; each also gets a stable ~/vti-stack/bin link)
# and vta, vtc, mediator, did-hosting-daemon (the lab's services, signed in
# place where restart.sh runs them).
#
# An ad hoc build (what cargo produces) has a new code identity each time, so
# every rebuild re-prompts for each Keychain item it opens. Signed with the
# "Keyring lab tools" identity under identifier org.keyring.lab.<tool>, its
# designated requirement stays the same across rebuilds, and an item granted
# once stays granted. The harness defaults to the stable paths:
#   ~/vti-stack/bin/pnm      → ~/vti-stack/bin/pnm-<rev>
#   ~/vti-stack/bin/openvtc  → ~/vti-stack/bin/openvtc-<rev>
# The cargo output itself (target/debug/<tool>) is signed in place too, so a
# script or a long-running server that still calls it by path never meets an
# ad hoc build (every rebuild would otherwise re-prompt for each Keychain item).
#
# Sources (override with the env var):
#   pnm      VTI_SRC      (default ~/Documents/vti-main), binary target/debug/pnm
#   openvtc  OPENVTC_SRC  (default ~/Documents/openvtc-build), binary
#            $CARGO_TARGET_DIR/debug/openvtc (default ~/Documents/keyring-wallet/external/openvtc/target)
# --build runs `cargo build --bin <tool>` there first. SIGN_IDENTITY overrides
# the identity (a name or a SHA-1 from `security find-identity -p codesigning`).
set -euo pipefail

TOOL="${1:-}"
if [ "$TOOL" = all ]; then
  rc=0
  for t in pnm cnm openvtc vta vtc mediator did-hosting-daemon; do "$0" "$t" || rc=1; done
  exit $rc
fi
BUILD=0
[ "${2:-}" = --build ] && BUILD=1
BIN_DIR="${LAB_BIN_DIR:-$HOME/vti-stack/bin}"
IDENTITY_NAME="${SIGN_IDENTITY:-Keyring lab tools}"

case "$TOOL" in
  pnm|cnm|vta|vtc)
    SRC="${VTI_SRC:-$HOME/Documents/vti-main}"
    TARGET_DIR="$SRC/target"
    ;;
  mediator)
    SRC="${TDK_SRC:-$HOME/Documents/affinidi-tdk-rs}"
    TARGET_DIR="$SRC/target"
    ;;
  did-hosting-daemon)
    SRC="${WEBVH_SRC:-$HOME/Documents/affinidi-webvh-service}"
    TARGET_DIR="$SRC/target"
    ;;
  openvtc)
    SRC="${OPENVTC_SRC:-$HOME/Documents/openvtc-build}"
    TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/Documents/keyring-wallet/external/openvtc/target}"
    ;;
  *)
    echo "usage: $0 pnm|cnm|openvtc|vta|vtc|mediator|did-hosting-daemon|all [--build]" >&2
    exit 2
    ;;
esac

if [ "$BUILD" = 1 ]; then
  (cd "$SRC" && CARGO_TARGET_DIR="$TARGET_DIR" cargo build --bin "$TOOL")
fi

BUILT="$TARGET_DIR/debug/$TOOL"
[ -x "$BUILT" ] || { echo "no build at $BUILT (run with --build)" >&2; exit 1; }
REV=$(git -C "$SRC" rev-parse --short=7 HEAD)

# The identity by SHA-1: an untrusted self-signed identity signs fine by hash.
if [[ "$IDENTITY_NAME" =~ ^[0-9A-Fa-f]{40}$ ]]; then
  IDENTITY="$IDENTITY_NAME"
else
  IDENTITY=$(security find-identity -p codesigning 2>/dev/null | awk -v n="\"$IDENTITY_NAME\"" 'index($0, n) {print $2; exit}')
fi
[ -n "$IDENTITY" ] || { echo "no code-signing identity named \"$IDENTITY_NAME\" in the login keychain" >&2; exit 1; }

# Sign by rename, never in place on a file that may be running (a running copy
# hangs): copy, sign, check the designated requirement, move over.
sign_copy() { # src dest
  cp -p "$1" "$2.signed.new"
  codesign --force -s "$IDENTITY" -i "org.keyring.lab.$TOOL" "$2.signed.new"
  REQ=$(codesign -d -r- "$2.signed.new" 2>&1 | grep '^designated')
  case "$REQ" in
    *"identifier \"org.keyring.lab.$TOOL\""*"certificate leaf"*) mv -f "$2.signed.new" "$2" ;;
    *) echo "signature check failed for $2: $REQ" >&2; rm -f "$2.signed.new"; exit 1 ;;
  esac
}

# The cargo output itself, which restart.sh (services) and stray scripts run.
sign_copy "$BUILT" "$BUILT"
echo "$TOOL: $BUILT signed in place"
echo "  $REQ"

# CLIs also get a revisioned copy and a stable ~/vti-stack/bin link, which the
# harness defaults to (-h on ln: replace the link itself).
case "$TOOL" in
  pnm|cnm|openvtc)
    mkdir -p "$BIN_DIR"
    DEST="$BIN_DIR/$TOOL-$REV"
    sign_copy "$BUILT" "$DEST"
    ln -sfh "$DEST" "$BIN_DIR/$TOOL"
    echo "  $TOOL → $(readlink "$BIN_DIR/$TOOL")"
    ;;
esac
