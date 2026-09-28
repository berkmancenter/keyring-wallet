#!/usr/bin/env bash
# Sign a lab tool build with the one fixed local identity and point its stable
# path at it, so the login Keychain's "Always Allow" survives every rebuild.
#
#   scripts/openvtc/sign-lab-tool.sh pnm|openvtc [--build]
#
# An ad hoc build (what cargo produces) has a new code identity each time, so
# every rebuild re-prompts for each Keychain item it opens. Signed with the
# "Keyring lab tools" identity under identifier org.keyring.lab.<tool>, its
# designated requirement stays the same across rebuilds, and an item granted
# once stays granted. The harness defaults to the stable paths:
#   ~/vti-stack/bin/pnm      → ~/vti-stack/bin/pnm-<rev>
#   ~/vti-stack/bin/openvtc  → ~/vti-stack/bin/openvtc-<rev>
# Never run target/debug/pnm (or any ad hoc build) against the Keychain.
#
# Sources (override with the env var):
#   pnm      VTI_SRC      (default ~/Documents/vti-main), binary target/debug/pnm
#   openvtc  OPENVTC_SRC  (default ~/Documents/openvtc-build), binary
#            $CARGO_TARGET_DIR/debug/openvtc (default ~/Documents/keyring-wallet/external/openvtc/target)
# --build runs `cargo build --bin <tool>` there first. SIGN_IDENTITY overrides
# the identity (a name or a SHA-1 from `security find-identity -p codesigning`).
set -euo pipefail

TOOL="${1:-}"
BUILD=0
[ "${2:-}" = --build ] && BUILD=1
BIN_DIR="${LAB_BIN_DIR:-$HOME/vti-stack/bin}"
IDENTITY_NAME="${SIGN_IDENTITY:-Keyring lab tools}"

case "$TOOL" in
  pnm)
    SRC="${VTI_SRC:-$HOME/Documents/vti-main}"
    TARGET_DIR="$SRC/target"
    ;;
  openvtc)
    SRC="${OPENVTC_SRC:-$HOME/Documents/openvtc-build}"
    TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/Documents/keyring-wallet/external/openvtc/target}"
    ;;
  *)
    echo "usage: $0 pnm|openvtc [--build]" >&2
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

mkdir -p "$BIN_DIR"
DEST="$BIN_DIR/$TOOL-$REV"
# Replace by rename, never overwrite a binary in place (a running copy hangs).
cp -p "$BUILT" "$DEST.new"
codesign --force -s "$IDENTITY" -i "org.keyring.lab.$TOOL" "$DEST.new"
REQ=$(codesign -d -r- "$DEST.new" 2>&1 | grep '^designated')
case "$REQ" in
  *"identifier \"org.keyring.lab.$TOOL\""*"certificate leaf"*) ;;
  *) echo "signature check failed: $REQ" >&2; rm -f "$DEST.new"; exit 1 ;;
esac
mv -f "$DEST.new" "$DEST"

# Repoint the stable path (-h: replace the link itself, not what it points to).
ln -sfh "$DEST" "$BIN_DIR/$TOOL"
echo "$TOOL → $(readlink "$BIN_DIR/$TOOL")"
echo "  $REQ"
