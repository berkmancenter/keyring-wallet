#!/usr/bin/env bash
# Offline tests for up.sh's guards. Nothing real is started: every case runs
# against an empty temp STACK_DIR and an empty temp VTI_SRC, so up.sh either
# refuses or stops at "missing: <binary>", before it touches a process.
#
#   ./test-up.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
ok()  { echo "  ok   $*"; }
bad() { echo "  FAIL $*"; fails=$((fails+1)); }

run_up() { # extra env assignments as args; runs up.sh, sets $out and $rc
  out=$(env -i PATH="$PATH" HOME="$T/home" STACK_DIR="$T/stack" VTI_SRC="$T/vti" \
    WEBVH_SRC="$T/webvh" TDK_SRC="$T/tdk" PNM_BIN="$T/none/pnm" "$@" "$HERE/up.sh" 2>&1); rc=$?
}
mkdir -p "$T/home" "$T/stack"

echo "guard: no ngrok.yml, no override"
run_up
[ "$rc" = 2 ] && ok "exit code 2" || bad "exit code $rc, expected 2"
for want in "refusing to start" "README.md" "ngrok-lab-config.sh" "someone else's running stack" "LAB_ALLOW_LIVE_DOMAINS=1"; do
  case "$out" in *"$want"*) ok "message mentions: $want" ;; *) bad "message lacks: $want" ;; esac
done
case "$out" in *missing:*) bad "went on to the binary check" ;; *) ok "stopped before the binary check" ;; esac
[ -z "$(ls -A "$T/stack")" ] && ok "STACK_DIR untouched" || bad "STACK_DIR was written to"

echo "guard: LAB_ALLOW_LIVE_DOMAINS=1 passes the guard"
run_up LAB_ALLOW_LIVE_DOMAINS=1
case "$out" in *"refusing to start"*) bad "still refused" ;; *) ok "no refusal" ;; esac
case "$out" in *"missing: $T/vti/target/debug/vta"*) ok "reached the next stage (binary check)" ;; *) bad "did not reach the next stage: $out" ;; esac
[ "$rc" = 1 ] && ok "next stage's own exit code (1)" || bad "exit code $rc"

echo "guard: a present ngrok.yml passes the guard"
: > "$T/stack/ngrok.yml"
run_up
case "$out" in *"refusing to start"*) bad "refused despite ngrok.yml" ;; *) ok "no refusal" ;; esac
case "$out" in *missing:*) ok "reached the binary check" ;; *) bad "$out" ;; esac

[ "$fails" = 0 ] && { echo "all passed"; exit 0; } || { echo "$fails failed"; exit 1; }
