#!/bin/bash
# bash e2e/gate/ci/grant-expiry.test.sh: a phone grant made under an expiring identity carries an expiry. A VTA 0.60
# refuses an expiring admin's permanent entry (VTI-ACL-053; the Mac mini's run 1021-0258 broke at testreq's link).
# gate_env exports EXPIRES for a lane (E2E_LANE, 6h by default) or for GATE_GRANT_EXPIRES, keeps an EXPIRES the caller
# set, and leaves the MacBook's permanent identity alone; enrol-manager.sh then passes --expires to pnm acl create.
# A fake pnm records its arguments; no network, no secrets.
set -u
here=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; fails=0
ok() { echo "ok   $*"; }; bad() { echo "FAIL $*"; fails=$((fails + 1)); }
cat > "$T/pnm" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "$FAKE_PNM_LOG"; echo created
SH
chmod +x "$T/pnm"
# The EXPIRES gate_env leaves for the legs, from an env file holding the given lines.
expires_for() {
  printf '%s\n' "$@" > "$T/case.env"
  ( unset EXPIRES E2E_LANE GATE_GRANT_EXPIRES; export GATE_HOME=$T/home GATE_ENV=$T/case.env
    . "$here/../lib.sh" >/dev/null 2>&1; gate_env >/dev/null 2>&1; printf '%s' "${EXPIRES:-<unset>}" )
}
[ "$(expires_for 'GATE_TARGET=farm')" = "<unset>" ] && ok "the MacBook's env (no lane, no expiry): phone grants stay permanent" || bad "plain env set EXPIRES=$(expires_for 'GATE_TARGET=farm')"
[ "$(expires_for 'E2E_LANE=mini')" = "6h" ] && ok "a lane's env: phone grants expire in 6h" || bad "lane env gave EXPIRES=$(expires_for 'E2E_LANE=mini')"
[ "$(expires_for 'GATE_GRANT_EXPIRES=2h')" = "2h" ] && ok "GATE_GRANT_EXPIRES is used as given" || bad "GATE_GRANT_EXPIRES=2h gave EXPIRES=$(expires_for 'GATE_GRANT_EXPIRES=2h')"
[ "$(expires_for 'E2E_LANE=mini' 'GATE_GRANT_EXPIRES=3h')" = "3h" ] && ok "a lane's own GATE_GRANT_EXPIRES wins over the 6h default" || bad "lane + 3h gave EXPIRES=$(expires_for 'E2E_LANE=mini' 'GATE_GRANT_EXPIRES=3h')"
got=$(printf 'E2E_LANE=mini\n' > "$T/case.env"; ( export EXPIRES=1h GATE_HOME=$T/home GATE_ENV=$T/case.env; . "$here/../lib.sh" >/dev/null 2>&1; gate_env >/dev/null 2>&1; printf '%s' "$EXPIRES" ))
[ "$got" = "1h" ] && ok "an EXPIRES the caller set is kept" || bad "caller's EXPIRES=1h became $got"
# End to end: the grant a mini-lane leg makes through enrol-manager.sh carries --expires.
printf 'E2E_LANE=mini\nGATE_TARGET=farm\n' > "$T/case.env"
( export GATE_HOME=$T/home GATE_ENV=$T/case.env PNM_BIN=$T/pnm FAKE_PNM_LOG=$T/pnm.log; unset EXPIRES
  . "$here/../lib.sh" >/dev/null 2>&1; gate_env >/dev/null 2>&1
  bash "$here/../../../scripts/openvtc/local-vti-stack/enrol-manager.sh" did:key:zPhone keyring-mini-gate-test admin > "$T/enrol.out" 2>&1 )
grep -q -- "acl create --did did:key:zPhone --role admin --expires 6h --label keyring-admin" "$T/pnm.log" 2>/dev/null \
  && ok "a mini-lane phone grant reaches pnm with --expires 6h" || bad "the grant went to pnm as: $(cat "$T/pnm.log" 2>/dev/null) ($(tail -1 "$T/enrol.out"))"
: > "$T/pnm.log"; printf 'GATE_TARGET=farm\n' > "$T/case.env"
( export GATE_HOME=$T/home GATE_ENV=$T/case.env PNM_BIN=$T/pnm FAKE_PNM_LOG=$T/pnm.log; unset EXPIRES E2E_LANE GATE_GRANT_EXPIRES
  . "$here/../lib.sh" >/dev/null 2>&1; gate_env >/dev/null 2>&1
  bash "$here/../../../scripts/openvtc/local-vti-stack/enrol-manager.sh" did:key:zPhone farm3-runner-test admin > "$T/enrol.out" 2>&1 )
grep -q -- "--expires" "$T/pnm.log" && bad "the MacBook's grant gained an expiry: $(cat "$T/pnm.log")" || ok "the MacBook's phone grant is unchanged (no --expires)"
[ $fails = 0 ] && echo "grant-expiry: all passed" || { echo "grant-expiry: $fails failed"; exit 1; }
