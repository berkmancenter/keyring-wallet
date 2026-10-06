#!/bin/bash
# A plain join (#305/#319/#322, and flow B): a fresh Android phone (push-off build) linked to the main runner asks
# to join C by its admin-review way. While it waits, the Join screen and Your agent's community card must show the
# identity the request came from, and each identity line and Join's actions must end above the tab bar.
# Then C's admin approves it (our REST admin script): the card must turn to member, C must list the identity, and
# the Wallet must show the card (run-join-waiting.mjs, JOIN_APPROVE=1). The member is removed at the end.
# WAITING_DECLINE=1 declines instead, the older shape.
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN C_DID C_NAME C_REST C_ADMIN_CRED
APK=$APK_OFF
leg_begin waiting "$(shasum -a 256 "$APK" | cut -c1-12)"
T0=$(stamp); E=emulator-5572
fin() {
  adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop; echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"
  local m; for m in $(grep -oE '^JOIN_MEMBER did:[^ ]+' "$LEG_DIR/waiting.out" 2>/dev/null | awk '{print $2}' | sort -u); do
    echo "  C member …${m: -24}: $(c_admin member-remove "$m" "gate: flow B member, removed after the leg" | grep -oE -- '-> [0-9]+' | tail -1)"
  done
}
LEG_CLEANUP=fin
emu_start 5572
for pkg in $BID $BID.pushtest; do adb -s $E uninstall "$pkg" >/dev/null 2>&1; done
cd "$E2E"
E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4762 ENROL_PORT=8197 E2E_RELEASE=1 \
  LINK_MODE=manual RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 \
  perl -e 'alarm 1800; exec @ARGV' node run-vta-link.js > "$LEG_DIR/link.out" 2>&1 || broken "link: $(grep -E '✅|❌' "$LEG_DIR/link.out" | tail -1 | cut -c1-120)"
APPROVE=1; [ "${WAITING_DECLINE:-}" = 1 ] && APPROVE=0
E2E_APP_ID=$BID UDID=$E ANDROID_UDID=$E ANDROID_SERIAL=$E APPIUM_PORT=4762 C_DID=$C_DID C_NAME=$C_NAME PERSONA_SHOTS=$LEG_DIR/persona-did \
  JOIN_APPROVE=$APPROVE C_ADMIN="$C_REST $C_DID $C_ADMIN_CRED" \
  perl -e 'alarm 900; exec @ARGV' node run-join-waiting.mjs > "$LEG_DIR/waiting.out" 2>&1
grep -E '^\[e2e\] [0-9]|^PERSONA-DID|^WAITING-STATUS|^JOIN-IDENTITY-NAME' "$LEG_DIR/waiting.out" | cut -c1-220
take_rows "$LEG_DIR/waiting.out"   # flow B's rows (a)–(d) when approved
# The request whose identity the phone must show: the newest pending one, or (approved) the one it came from.
RDID=$(grep -oE '^ROW join-request-is-mine PASS — request [^ ]+ from did:[^ ]+' "$LEG_DIR/waiting.out" | awk '{print $NF}'); RID=-
[ -n "$RDID" ] || read -r RID RDID < <(c_admin join-list pending | python3 -c "
import sys,json; t=sys.stdin.read(); d=json.loads(t[t.index('{'):]) if '{' in t else {}
items=sorted(d.get('items') or [], key=lambda r: str(r.get('submittedAt'))); r=items[-1] if items else {}
print(r.get('id','-'), r.get('applicantDid','-'))")
for shot in community-card-waiting join-standing-identity; do
  shown=$(grep -oE "^PERSONA-DID $shot did:[^ ]+" "$LEG_DIR/waiting.out" | awk '{print $3}')
  if [ -n "$shown" ] && [ "$shown" = "$RDID" ]; then row "$shot" PASS "$shown is the newest pending request's applicant"
  else row "$shot" FAIL "shows ${shown:-nothing}; the newest pending request ($RID) is from $RDID"; fi
done
while read -r _ shot st rest; do
  case $st in clear) row "foot-$shot" PASS "$rest" ;; *) row "foot-$shot" FAIL "$st $rest" ;; esac
done < <(grep -E '^FOOT ' "$LEG_DIR/waiting.out")
if [ "$APPROVE" = 0 ] && [ "$RID" != - ]; then
  echo "  decline $RID: $(JOIN_DECIDE_REASON='gate: a join left waiting on purpose' c_admin join-decide "$RID" rejected | grep -oE -- '-> [0-9]+' | tail -1)"
fi
