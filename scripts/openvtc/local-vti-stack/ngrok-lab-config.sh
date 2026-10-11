#!/usr/bin/env bash
# Write (or check) the ngrok config for a SEPARATE lab VTI stack, offline.
#
#   ngrok-lab-config.sh ALICE COMMUNITY BOB VTC DIDS MEDIATOR     six reserved domains, fixed order
#   ngrok-lab-config.sh --prefix myname --suffix ngrok.app        myname-alice.ngrok.app ... myname-mediator.ngrok.app
#   ngrok-lab-config.sh --three ...                               not implemented (see below)
#   ngrok-lab-config.sh --check [FILE]                            validate a config, print the six hostnames
#   ngrok-lab-config.sh --hosts FILE                              print ALICE_HOST=... lines (used by up.sh)
#   ngrok-lab-config.sh --tunnels FILE                            print every tunnel name the file declares (used by up.sh)
#   ngrok-lab-config.sh --self-test                               offline tests in a temp dir
#
# Options: --out FILE (default $STACK_DIR/ngrok.yml, STACK_DIR default ~/vti-stack), --force (overwrite).
#
# This script never runs ngrok and never touches the network. The file it
# writes has NO authtoken: add your own with
#   ngrok config add-authtoken <token> --config ~/vti-stack/ngrok.yml
# (done by you, so the token never passes through this script or its logs).
#
# Guard: hostnames matching keyring-vti-*.ngrok.app belong to the live shared
# stack and are refused unless LAB_ALLOW_LIVE_DOMAINS=1 (that override exists
# only for the owner of the Mac stack that runs on those domains).
set -euo pipefail

STACK_DIR="${STACK_DIR:-$HOME/vti-stack}"
NAMES=(alice community bob vtc dids mediator)
PORTS=(8110 8111 8112 8200 8534 7037)

die() { echo "ngrok-lab-config: $*" >&2; exit 1; }

guard() { # hostname...
  local h
  [ "${LAB_ALLOW_LIVE_DOMAINS:-}" = "1" ] && return 0
  for h in "$@"; do
    case "$h" in
      keyring-vti-*.ngrok.app) die "refusing $h: keyring-vti-*.ngrok.app is the live shared stack's domain space. Use your own reserved domains (LAB_ALLOW_LIVE_DOMAINS=1 exists only for the Mac stack's owner)." ;;
    esac
  done
}

# Print "name<TAB>domain" for each tunnel in a config (domain empty when the
# tunnel has none); yaml-lite, no deps beyond python3. Reads both the block form
#   alice:
#     domain: x.ngrok.app
# and the flow form  alice: { proto: http, addr: 8110, domain: x.ngrok.app }.
# Values are printed raw; hosts() and tunnel_names() validate them.
parse_domains() { # file
  python3 - "$1" <<'PY'
import re, sys
in_t = False; cur = None; name_ind = None; seen = {}  # insertion-ordered
NAME = r"""(?:"([A-Za-z0-9_-]+)"|'([A-Za-z0-9_-]+)'|([A-Za-z0-9_-]+))"""
VAL = r"""(?:"([^"]*)"|'([^']*)'|([^\s,}]+))"""
def val(m):
    return next((g for g in m.groups() if g is not None), "")
def emit(name, dom):
    if not seen.get(name): seen[name] = dom
for raw in open(sys.argv[1]).read().splitlines():
    line = re.split(r"\s#", raw)[0].rstrip()
    if not line.strip() or line.lstrip().startswith("#"): continue
    ind = len(line) - len(line.lstrip())
    s = line.strip()
    if ind == 0:
        in_t = bool(re.match(r"^tunnels:\s*$", s)); cur = None; name_ind = None; continue
    if not in_t: continue
    # ngrok re-saves the file with its own indent (4 spaces) after `add-authtoken`:
    # the tunnel-name indent is whatever the first nested line under `tunnels:` uses.
    if name_ind is None: name_ind = ind
    if ind == name_ind:
        m = re.match(r"^" + NAME + r":\s*\{(.*)\}\s*$", s)
        if m:
            name = next(g for g in m.groups()[:3] if g is not None)
            d = re.search(r"(?:^|[{,\s])domain:\s*" + VAL, m.group(4))
            cur = None; emit(name, val(d) if d else ""); continue
        m = re.match(r"^" + NAME + r":\s*$", s)
        if m:
            cur = next(g for g in m.groups() if g is not None); emit(cur, ""); continue
        cur = None; continue
    m = re.match(r"^domain:\s*" + VAL + r"\s*$", s)
    if m and cur:
        seen[cur] = val(m)
for k, v in seen.items(): print(k + "\t" + v)
PY
}

valid_host() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; }

tunnel_names() { # file -> every tunnel name the file declares, one per line
  local f=$1 n
  [ -f "$f" ] || die "no such file: $f"
  while IFS=$'\t' read -r n _; do
    [ -n "$n" ] || continue
    [[ "$n" =~ ^[A-Za-z0-9_-]+$ ]] || die "not a tunnel name: $n"
    printf '%s\n' "$n"
  done < <(parse_domains "$f")
}

hosts() { # file -> prints KEY_HOST=host lines, validated (up.sh evals them)
  local f=$1 name d missing=() out="" all=()
  [ -f "$f" ] || die "no such file: $f"
  local tbl; tbl=$(parse_domains "$f")
  for name in "${NAMES[@]}"; do
    d=$(printf '%s\n' "$tbl" | awk -F'\t' -v n="$name" '$1==n && $2!=""{print $2; exit}')
    if [ -z "$d" ]; then missing+=("$name"); continue; fi
    valid_host "$d" || die "$f: not a hostname for tunnel $name: $d"
    all+=("$d")
    out+="$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]' | sed 's/^MEDIATOR$/MED/')_HOST=$d"$'\n'
  done
  [ ${#missing[@]} -eq 0 ] || die "$f is missing a tunnel with a domain: for: ${missing[*]} (need all of: ${NAMES[*]})"
  guard "${all[@]}"
  printf '%s' "$out"
}

write_config() { # out force domains...
  local out=$1 force=$2; shift 2
  local doms=("$@") i
  [ ${#doms[@]} -eq 6 ] || die "need exactly six domains (alice community bob vtc dids mediator), got ${#doms[@]}"
  for i in "${doms[@]}"; do
    valid_host "$i" || die "not a hostname: $i"
  done
  guard "${doms[@]}"
  if [ -e "$out" ] && [ "$force" != 1 ]; then die "$out exists; pass --force to overwrite (this drops any authtoken in it; re-add it afterwards)"; fi
  mkdir -p "$(dirname "$out")"
  (
    umask 077
    {
      echo 'version: "3"'
      echo 'agent:'
      echo '  # No authtoken here on purpose. Add yours with:'
      echo '  #   ngrok config add-authtoken <token> --config '"$out"
      echo '  log_level: info'
      echo 'tunnels:'
      for i in 0 1 2 3 4 5; do
        echo "  ${NAMES[$i]}:"
        echo "    proto: http"
        echo "    addr: ${PORTS[$i]}"
        echo "    domain: ${doms[$i]}"
      done
    } > "$out"
  )
  chmod 600 "$out"
  echo "wrote $out (mode 600, no authtoken)"
  hosts "$out" | sed 's/^/  /'
}

self_test() {
  local t; t=$(mktemp -d); local me; me=$(readlink -f "$0") fails=0
  trap 'rm -rf "$t"' RETURN
  ok() { echo "  ok: $1"; }
  bad() { echo "  FAIL: $1" >&2; fails=$((fails+1)); }
  export HOME="$t/home"; mkdir -p "$HOME"; unset LAB_ALLOW_LIVE_DOMAINS
  local f="$t/ngrok.yml" out
  "$me" --prefix lab --suffix ngrok.app --out "$f" >/dev/null || bad "generate"
  out=$("$me" --hosts "$f")
  [ "$out" = "$(printf 'ALICE_HOST=lab-alice.ngrok.app\nCOMMUNITY_HOST=lab-community.ngrok.app\nBOB_HOST=lab-bob.ngrok.app\nVTC_HOST=lab-vtc.ngrok.app\nDIDS_HOST=lab-dids.ngrok.app\nMED_HOST=lab-mediator.ngrok.app')" ] && ok "yaml round-trips through the parser" || bad "round trip: $out"
  [ "$(stat -c %a "$f")" = 600 ] && ok "mode 0600" || bad "mode $(stat -c %a "$f")"
  grep -qi authtoken: "$f" && bad "authtoken present" || ok "no authtoken key written"
  grep -q 'addr: 7037' "$f" && grep -q 'addr: 8110' "$f" && ok "ports" || bad "ports"
  "$me" --prefix lab --suffix ngrok.app --out "$f" >/dev/null 2>&1 && bad "overwrote without --force" || ok "refuses overwrite without --force"
  "$me" --prefix lab2 --suffix ngrok.app --out "$f" --force >/dev/null 2>&1 && grep -q lab2-alice "$f" && ok "--force overwrites" || bad "--force"
  [ "$(stat -c %a "$f")" = 600 ] && ok "mode 0600 after --force" || bad "mode after force"
  "$me" --prefix keyring-vti --suffix ngrok.app --out "$t/x.yml" >/dev/null 2>&1 && bad "guard did not fire" || ok "keyring-vti guard fires (write)"
  [ -e "$t/x.yml" ] && bad "guard left a file" || ok "guard wrote nothing"
  LAB_ALLOW_LIVE_DOMAINS=1 "$me" --prefix keyring-vti --suffix ngrok.app --out "$t/x.yml" >/dev/null 2>&1 && ok "override allows" || bad "override"
  "$me" --hosts "$t/x.yml" >/dev/null 2>&1 && bad "guard did not fire (read)" || ok "keyring-vti guard fires (read)"
  sed '/^  bob:/,/^    domain/d' "$f" > "$t/m.yml"
  out=$("$me" --hosts "$t/m.yml" 2>&1) && bad "missing name accepted" || { case "$out" in *"for: bob"*) ok "missing-name error names bob";; *) bad "msg: $out";; esac; }
  # ngrok re-saves the file with 4-space indent after `ngrok config add-authtoken`; the parser must cope.
  sed -e 's/^  /    /' -e 's/^    \(proto\|addr\|domain\)/        \1/' "$f" > "$t/i4.yml"
  "$me" --hosts "$t/i4.yml" >/dev/null 2>&1 && ok "parses ngrok's 4-space re-saved format" || bad "4-space format"
  # flow form (inline tunnels), quotes, extra spacing, trailing comments, extra tunnels
  cat > "$t/flow.yml" <<'YML'
version: "3"
agent:
  authtoken: not-a-real-token
tunnels:
  alice: { proto: http, addr: 8110, domain: lab-alice.ngrok.app }
  community:   {proto: http,addr: 8111,  domain: "lab-community.ngrok.app" }   # quoted, spaced
  bob: { proto: http, addr: 8112, domain: 'lab-bob.ngrok.app' }
  vtc: { domain: lab-vtc.ngrok.app, addr: 8200, proto: http }
  dids:
    proto: http   # block form mixed in
    addr: 8534
    domain: lab-dids.ngrok.app
  mediator: { proto: http, addr: 7037, domain: lab-mediator.ngrok.app }
  extra-one: { proto: http, addr: 9001, domain: lab-extra1.ngrok.app }
  extra_two: { proto: tcp, addr: 9002 }
YML
  out=$("$me" --hosts "$t/flow.yml" 2>&1)
  [ "$out" = "$("$me" --hosts "$f" | sed 's/lab2-/lab-/')" ] && ok "flow form, quotes, spacing, comments, mixed block parse" || bad "flow form: $out"
  sed 's/^  /    /' "$t/flow.yml" | sed 's/^    \(proto\|addr\|domain\)/        \1/' > "$t/flow4.yml"
  "$me" --hosts "$t/flow4.yml" >/dev/null 2>&1 && ok "flow form at 4-space indent" || bad "flow form 4-space"
  out=$("$me" --tunnels "$t/flow.yml" | tr '\n' ' ')
  [ "$out" = "alice community bob vtc dids mediator extra-one extra_two " ] && ok "--tunnels lists every tunnel (flow, block, domainless)" || bad "tunnels: $out"
  sed '/^  bob:/d' "$t/flow.yml" > "$t/flowm.yml"
  out=$("$me" --hosts "$t/flowm.yml" 2>&1) && bad "flow form missing bob accepted" || { case "$out" in *"for: bob"*) ok "flow form missing name named";; *) bad "msg: $out";; esac; }
  # malformed input: fails closed, never prints a host
  printf 'tunnels:\n  alice: { proto: http, domain: \n' > "$t/bad1.yml"
  printf 'tunnels:\n  alice: { proto: http\n  community: [domain, x]\n' > "$t/bad2.yml"
  : > "$t/empty.yml"
  for m in bad1 bad2 empty; do
    out=$("$me" --hosts "$t/$m.yml" 2>&1) && bad "malformed $m accepted: $out" || ok "malformed $m refused"
  done
  # hosts() output is eval'd by up.sh: a crafted value must be refused, not printed
  for v in 'a.ngrok.app;touch${IFS}/tmp/x' '"a.ngrok.app; touch /tmp/x"' 'a.ngrok.app`id`' '$(id).ngrok.app'; do
    sed "s|domain: lab-alice.ngrok.app|domain: $v|" "$t/flow.yml" > "$t/evil.yml"
    out=$("$me" --hosts "$t/evil.yml" 2>&1) && bad "crafted host accepted: $v" || { case "$out" in *"not a hostname"*|*"for: alice"*) ok "crafted host refused: $v";; *) bad "msg: $out";; esac; }
    case "$out" in *ALICE_HOST*) bad "crafted host printed";; esac
  done
  "$me" --three a b c >/dev/null 2>&1 && bad "--three should not succeed" || ok "--three is a stub"
  "$me" --check "$f" >/dev/null && ok "--check passes" || bad "--check"
  [ "$fails" -eq 0 ] && { echo "self-test passed"; return 0; } || { echo "self-test: $fails failure(s)" >&2; return 1; }
}

mode=write; force=0; out="$STACK_DIR/ngrok.yml"; prefix=""; suffix=""; pos=(); file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) prefix=${2:?}; shift 2 ;;
    --suffix) suffix=${2:?}; shift 2 ;;
    --out) out=${2:?}; shift 2 ;;
    --force) force=1; shift ;;
    --check) mode=check; if [ $# -gt 1 ] && [ "${2#--}" = "$2" ]; then file=$2; shift; fi; shift ;;
    --hosts) mode=hosts; file=${2:?}; shift 2 ;;
    --tunnels) mode=tunnels; file=${2:?}; shift 2 ;;
    --self-test) mode=test; shift ;;
    --three) mode=three; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    --*) die "unknown option $1" ;;
    *) pos+=("$1"); shift ;;
  esac
done

case "$mode" in
  three) die "not implemented: needs VTA_ALLOW_PRIVATE_ENDPOINTS verification (plan section 4: a three-endpoint topology is unverified; use six domains)" ;;
  test) self_test ;;
  hosts) hosts "$file" ;;
  tunnels) tunnel_names "$file" ;;
  check)
    f=${file:-$out}
    hosts "$f" >/dev/null
    grep -qE '^version: *"?3"?' "$f" || die "$f: expected 'version: \"3\"'"
    if grep -qE '^ *authtoken:' "$f"; then echo "note: $f carries an authtoken (fine for the lab file; never commit it)"; else echo "note: $f has no authtoken yet: ngrok config add-authtoken <token> --config $f"; fi
    [ "$(stat -c %a "$f" 2>/dev/null || stat -f %Lp "$f")" = 600 ] || echo "note: mode is not 600"
    echo "ok: $f"; hosts "$f" ;;
  write)
    if [ -n "$prefix" ] || [ -n "$suffix" ]; then
      [ -n "$prefix" ] && [ -n "$suffix" ] && [ ${#pos[@]} -eq 0 ] || die "--prefix and --suffix go together and exclude positional domains"
      pos=(); for n in "${NAMES[@]}"; do pos+=("$prefix-$n.$suffix"); done
    fi
    [ ${#pos[@]} -gt 0 ] || die "usage: ngrok-lab-config.sh ALICE COMMUNITY BOB VTC DIDS MEDIATOR | --prefix P --suffix S | --check | --self-test"
    write_config "$out" "$force" "${pos[@]}" ;;
esac
