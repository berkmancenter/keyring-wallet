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

# ---- preflight, with stubbed binaries, redis-cli and lsof (nothing real is touched)
echo "preflight: stubbed environment"
STUB="$T/stubbin"; mkdir -p "$STUB" "$T/vti/target/debug" "$T/tdk/target/debug" "$T/webvh/target/debug"
for b in "$T/vti/target/debug/"{vta,vtc,cnm} "$T/tdk/target/debug/"{mediator,mediator-setup} "$T/webvh/target/debug/did-hosting-daemon" "$STUB/pnm" "$STUB/ngrok"; do
  printf '#!/bin/sh\necho "stub 1.2.3"\n' > "$b"; chmod +x "$b"
done
printf '#!/bin/sh\nexit 0\n' > "$STUB/lsof"; chmod +x "$STUB/lsof"
printf '#!/bin/sh\n[ "$3" = ping ] && echo PONG\nexit "${STUB_REDIS_RC:-0}"\n' > "$STUB/redis-cli"; chmod +x "$STUB/redis-cli"
cat > "$T/stack/ngrok.yml" <<'YML'
version: "3"
agent:
  authtoken: not-a-real-token
tunnels:
YML
for n in alice community bob vtc dids mediator; do printf '  %s:\n    proto: http\n    domain: lab-%s.example.test\n    addr: 1\n' "$n" "$n" >> "$T/stack/ngrok.yml"; done
chmod 600 "$T/stack/ngrok.yml"
run_pf() { # extra env assignments; runs preflight.sh directly
  out=$(env -i PATH="$STUB:$PATH" HOME="$T/home" STACK_DIR="$T/stack" VTI_SRC="$T/vti" WEBVH_SRC="$T/webvh" \
    TDK_SRC="$T/tdk" PNM_BIN="$STUB/pnm" "$@" "$HERE/preflight.sh" 2>&1); rc=$?
}
run_pf REDIS_DB=5
[ "$rc" = 0 ] && ok "healthy stub environment passes" || bad "rc=$rc: $out"
case "$out" in *"stub 1.2.3"*) ok "versions printed" ;; *) bad "no versions" ;; esac
case "$out" in *"ALICE"*"lab-alice.example.test"*) ok "hostnames listed" ;; *) bad "no hostnames" ;; esac
case "$out" in *not-a-real-token*) bad "authtoken leaked" ;; *) ok "authtoken not printed" ;; esac
run_pf
[ "$rc" = 1 ] && case "$out" in *"db0"*) true ;; *) false ;; esac && ok "REDIS_DB unset on port 6379 refused" || bad "db0 not refused (rc=$rc)"
run_pf REDIS_DB=0
[ "$rc" = 1 ] && ok "REDIS_DB=0 on port 6379 refused" || bad "REDIS_DB=0 rc=$rc"
run_pf LAB_ALLOW_REDIS_DB0=1
[ "$rc" = 0 ] && ok "LAB_ALLOW_REDIS_DB0=1 allows db0" || bad "override rc=$rc"
run_pf REDIS_PORT=6390
[ "$rc" = 0 ] && ok "dedicated port allows db0" || bad "dedicated port rc=$rc"
run_pf REDIS_DB=16
[ "$rc" = 1 ] && ok "REDIS_DB=16 refused" || bad "REDIS_DB=16 rc=$rc"
run_pf REDIS_DB=5 STUB_REDIS_RC=1
[ "$rc" = 1 ] && ok "unreachable redis fails" || bad "redis down rc=$rc"
chmod 644 "$T/stack/ngrok.yml"
run_pf REDIS_DB=5
[ "$rc" = 1 ] && case "$out" in *"mode is 644"*) true ;; *) false ;; esac && ok "ngrok.yml mode 644 refused" || bad "perms not refused (rc=$rc)"
chmod 600 "$T/stack/ngrok.yml"
sed -i '/^  vtc:/,+3d' "$T/stack/ngrok.yml"
run_pf REDIS_DB=5
[ "$rc" = 1 ] && case "$out" in *vtc*) true ;; *) false ;; esac && ok "missing vtc endpoint refused" || bad "missing endpoint rc=$rc"

# ---- the Mac live stack: flow-form tunnels, extra tunnels, db0 on 6379, mode 644.
# Fixture only; "macOS paths unchanged once LAB_ALLOW_LIVE_DOMAINS=1 is set" is checked here.
echo "preflight: Mac-style live config (fixture, stubs)"
MAC="$T/mac"; mkdir -p "$MAC"
cat > "$MAC/ngrok.yml" <<'YML'
version: "3"
agent:
  authtoken: not-a-real-token
tunnels:
  alice: { proto: http, addr: 8110, domain: keyring-vti-alice.ngrok.app }
  community: { proto: http, addr: 8111, domain: keyring-vti-community.ngrok.app }
  bob: { proto: http, addr: 8112, domain: keyring-vti-bob.ngrok.app }
  vtc: { proto: http, addr: 8200, domain: keyring-vti-vtc.ngrok.app }
  dids: { proto: http, addr: 8534, domain: keyring-vti-dids.ngrok.app }
  mediator: { proto: http, addr: 7037, domain: keyring-vti-mediator.ngrok.app }
  extra-a: { proto: http, addr: 9001, domain: keyring-vti-extra-a.ngrok.app }
  extra-b: { proto: http, addr: 9002, domain: keyring-vti-extra-b.ngrok.app }
  extra-c: { proto: tcp, addr: 9003 }
YML
chmod 644 "$MAC/ngrok.yml"
run_pf STACK_DIR="$MAC" LAB_ALLOW_LIVE_DOMAINS=1
[ "$rc" = 1 ] && case "$out" in *"chmod 600 $MAC/ngrok.yml"*) true ;; *) false ;; esac && ok "mode 644 fails and prints the exact chmod 600 command" || bad "644 message (rc=$rc): $out"
case "$out" in *"missing a tunnel"*|*"not a hostname"*) bad "flow-form fixture not parsed: $out" ;; *) ok "flow-form tunnels parse under the override" ;; esac
case "$out" in *"db0"*"refused"*|*"REDIS_DB is"*) bad "db0 refused under the override" ;; *) ok "db0 on 6379 not refused under the override" ;; esac
chmod 600 "$MAC/ngrok.yml"
run_pf STACK_DIR="$MAC" LAB_ALLOW_LIVE_DOMAINS=1
[ "$rc" = 0 ] && ok "Mac fixture passes with the one override (mode 600, db0 on 6379, REDIS_DB unset)" || bad "Mac fixture rc=$rc: $out"
case "$out" in *"keyring-vti-alice.ngrok.app"*) ok "live hostnames listed" ;; *) bad "no hostnames" ;; esac
run_pf STACK_DIR="$MAC"
[ "$rc" = 1 ] && case "$out" in *"live shared stack"*) true ;; *) false ;; esac && ok "without the override the keyring-vti-* guard still refuses" || bad "guard under no override (rc=$rc)"
run_pf STACK_DIR="$MAC" LAB_ALLOW_LIVE_DOMAINS=1 REDIS_DB=0 REDIS_PORT=6379
[ "$rc" = 0 ] && ok "explicit REDIS_DB=0 on 6379 passes under the override" || bad "explicit db0 rc=$rc"
sed 's/keyring-vti-/lab-/' "$MAC/ngrok.yml" > "$T/stack/ngrok.yml"
run_pf REDIS_PORT=6379
[ "$rc" = 1 ] && case "$out" in *"(db0) on the shared default port"*) true ;; *) false ;; esac && ok "lab path (no override) still refuses db0 on 6379" || bad "lab path db0 rc=$rc"
case "$("$HERE/ngrok-lab-config.sh" --tunnels "$MAC/ngrok.yml" | tr '\n' ' ')" in
  "alice community bob vtc dids mediator extra-a extra-b extra-c ") ok "--tunnels names all nine tunnels up.sh would start under the override" ;;
  *) bad "--tunnels on the Mac fixture" ;;
esac

echo "up.sh --check: runs only preflight"
out=$(env -i PATH="$STUB:$PATH" HOME="$T/home" STACK_DIR="$T/stack" VTI_SRC="$T/vti" WEBVH_SRC="$T/webvh" TDK_SRC="$T/tdk" PNM_BIN="$STUB/pnm" REDIS_DB=5 "$HERE/up.sh" --check 2>&1); rc=$?
case "$out" in *"== binaries"*"preflight:"*) ok "--check printed the preflight report (rc=$rc)" ;; *) bad "--check: $out" ;; esac
case "$out" in *"stopping"*|*"opening tunnels"*) bad "--check went past preflight" ;; *) ok "--check stopped at preflight" ;; esac

[ "$fails" = 0 ] && { echo "all passed"; exit 0; } || { echo "$fails failed"; exit 1; }
