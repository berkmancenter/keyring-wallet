#!/usr/bin/env bash
# Everything up.sh needs, checked up front, read-only: it starts and stops
# nothing, writes nothing, and never prints ngrok.yml's contents.
#
#   ./preflight.sh        run every check; exit 1 if any FAIL (warnings do not fail)
#
# Run by up.sh before it stops or starts anything; `up.sh --check` runs only this.
# Same env as up.sh: STACK_DIR VTI_SRC WEBVH_SRC TDK_SRC PNM_BIN REDIS_PORT REDIS_DB.
#   LAB_ALLOW_REDIS_DB0=1   allow Redis db0 on the default port 6379 (see below)
#   LAB_ALLOW_LIVE_DOMAINS=1  the Mac stack owner's override; implies the db0 allowance
#   LAB_MIN_MEM_GIB=20      MemAvailable below this is a warning
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="${STACK_DIR:-$HOME/vti-stack}"
VTI_SRC="${VTI_SRC:-$HOME/Documents/vti-main}"
WEBVH_SRC="${WEBVH_SRC:-$HOME/Documents/affinidi-webvh-service}"
TDK_SRC="${TDK_SRC:-$HOME/Documents/affinidi-tdk-rs}"
PNM_BIN="${PNM_BIN:-$HOME/vti-stack/bin/pnm}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_DB="${REDIS_DB:-}"
LAB_MIN_MEM_GIB="${LAB_MIN_MEM_GIB:-20}"

fails=0
pass() { echo "  ok    $*"; }
warn() { echo "  WARN  $*"; }
fail() { echo "  FAIL  $*" >&2; fails=$((fails+1)); }
section() { printf '\n== %s\n' "$*"; }
# macOS has no `timeout` unless Homebrew coreutils provides it (gtimeout).
TMO=""
if command -v timeout >/dev/null; then TMO=timeout; elif command -v gtimeout >/dev/null; then TMO=gtimeout; fi
version_of() { # binary [--no-version] -> first line of --version, or size and mtime
  local v
  if [ "${2:-}" != "--no-version" ] && [ -n "$TMO" ]; then
    v=$("$TMO" 5 "$1" --version 2>/dev/null | head -1) || true
    [ -n "$v" ] && { echo "$v"; return; }
  fi
  # pnm and mediator-setup reject --version ("unexpected argument"), and without
  # a timeout binary a binary that ignores it could hang: describe the file instead.
  local sz mt
  sz=$(stat -c %s "$1" 2>/dev/null || stat -f %z "$1" 2>/dev/null || echo "?")
  mt=$(stat -c %y "$1" 2>/dev/null | cut -d. -f1 || true)
  [ -n "$mt" ] || mt=$(stat -f %Sm -t '%Y-%m-%d %H:%M:%S' "$1" 2>/dev/null || echo "?")
  echo "no --version: $sz bytes, modified $mt"
}
[ -n "$TMO" ] || echo "note: no timeout/gtimeout on PATH (macOS: brew install coreutils); --version is not queried, file size and mtime are shown instead"

section "binaries"
for bin in "$VTI_SRC/target/debug/vta" "$VTI_SRC/target/debug/vtc" "$PNM_BIN" \
           "$TDK_SRC/target/debug/mediator" "$TDK_SRC/target/debug/mediator-setup" \
           "$WEBVH_SRC/target/debug/did-hosting-daemon"; do
  case "$bin" in */pnm|*/pnm-*|*/mediator-setup) vflag=--no-version ;; *) vflag="" ;; esac
  if [ -x "$bin" ]; then pass "$bin  [$(version_of "$bin" $vflag)]"
  else fail "missing: $bin: build it first (see README)"; fi
done
cnm="$VTI_SRC/target/debug/cnm"
if [ -x "$cnm" ]; then pass "$cnm  [$(version_of "$cnm")]"; else warn "no cnm at $cnm (only needed for cnm-driven runs)"; fi
for tool in curl lsof python3; do
  command -v "$tool" >/dev/null && pass "$tool on PATH" || fail "$tool is not on PATH"
done

section "python"
if python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null; then
  pass "python3 $(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
else fail "python3 >= 3.8 is required (up.sh and community-setup.sh run inline Python)"; fi

section "ngrok lab config"
NG="$STACK_DIR/ngrok.yml"
if [ ! -f "$NG" ]; then
  if [ "${LAB_ALLOW_LIVE_DOMAINS:-}" = "1" ]; then warn "no $NG: LAB_ALLOW_LIVE_DOMAINS=1, so up.sh uses quick tunnels / the default ngrok config"
  else fail "no $NG: create it with $HERE/ngrok-lab-config.sh (see README, 'ngrok with your own account')"; fi
else
  mode=$(stat -c %a "$NG" 2>/dev/null || stat -f %Lp "$NG" 2>/dev/null || echo "?")
  [ "$mode" = 600 ] && pass "$NG mode 0600" || fail "$NG mode is $mode, must be 600 (it holds an authtoken). Run: chmod 600 $NG"
  if hosts=$("$HERE/ngrok-lab-config.sh" --hosts "$NG" 2>&1); then
    pass "six named endpoints (alice community bob vtc dids mediator)"
    # --hosts prints ALICE_HOST=... lines only; show the hostnames, nothing else.
    printf '%s\n' "$hosts" | sed -E 's/^([A-Z]+)_HOST=/        \1 /'
  else fail "$NG: $hosts"; fi
  command -v ngrok >/dev/null && pass "ngrok on PATH" || fail "ngrok is not on PATH"
fi

section "redis"
case "$REDIS_DB" in ""|[0-9]|1[0-5]) ;; *) fail "REDIS_DB must be 0-15, got: $REDIS_DB" ;; esac
if command -v redis-cli >/dev/null && redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
  pass "redis answers on port $REDIS_PORT"
else
  fail "redis is not running on port $REDIS_PORT (macOS: brew services start redis; Linux: redis-server --port $REDIS_PORT --save \"\")"
fi
# db0 of a shared Redis holds other sessions' data and the mediator's keys are
# unprefixed. Refuse it (unset means db0) on the default port; a dedicated
# instance on another REDIS_PORT is yours, so db0 there is fine. The Mac stack
# has always used db0 on 6379: its owner sets LAB_ALLOW_LIVE_DOMAINS=1, which
# allows it, so the lab path (no override) keeps the refusal.
case "$REDIS_DB" in
  ""|0)
    if [ "$REDIS_PORT" = 6379 ] && [ "${LAB_ALLOW_REDIS_DB0:-}" != "1" ] && [ "${LAB_ALLOW_LIVE_DOMAINS:-}" != "1" ]; then
      fail "REDIS_DB is ${REDIS_DB:-unset} (db0) on the shared default port 6379: set REDIS_DB=<1-15> (the lab uses 5), or REDIS_PORT=<dedicated instance>; LAB_ALLOW_REDIS_DB0=1 overrides (LAB_ALLOW_LIVE_DOMAINS=1, the Mac stack owner's override, implies it)"
    else pass "REDIS_DB=${REDIS_DB:-0} on port $REDIS_PORT (allowed)"; fi ;;
  *) pass "REDIS_DB=$REDIS_DB" ;;
esac

section "ports"
# up.sh stops whatever listens on these, by PID. A stack of ours is expected;
# anything else is somebody's process and must not be killed.
for port in 8110 8111 8112 8200 8534 7037; do
  pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
  if [ -z "$pid" ]; then pass ":$port free"; continue; fi
  comm=$(ps -o comm= -p "$pid" 2>/dev/null || echo "?")
  if [ -d "/proc/$pid" ]; then
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
    case "$cwd $cmd" in
      *"$STACK_DIR"*) warn ":$port held by this stack ($comm, pid $pid); up.sh will stop it" ;;
      *) fail ":$port held by $comm (pid $pid), not started from $STACK_DIR; up.sh would kill it. Free the port or move the stack." ;;
    esac
  else
    warn ":$port held by $comm (pid $pid); cannot tell whose it is on this OS; up.sh will stop it"
  fi
done

section "memory"
if [ -r /proc/meminfo ]; then
  kb=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  gib=$((kb / 1024 / 1024))
  if [ "$gib" -lt "$LAB_MIN_MEM_GIB" ]; then warn "MemAvailable ${gib} GiB, below ${LAB_MIN_MEM_GIB} GiB: other sessions may be building; wait before heavy runs"
  else pass "MemAvailable ${gib} GiB"; fi
else pass "no /proc/meminfo (not Linux), memory not checked"; fi

if [ "$(uname)" = "Linux" ]; then
  section "e2e on Linux"
  if command -v magick >/dev/null || command -v convert >/dev/null; then pass "ImageMagick present (e2e filled-button measure falls back to it where sips is absent)"
  else warn "no ImageMagick (magick/convert): e2e runs that measure filled buttons will fail without sips"; fi
fi

echo
if [ "$fails" -gt 0 ]; then echo "preflight: $fails check(s) FAILED; nothing was started or stopped." >&2; exit 1; fi
echo "preflight: ok"
