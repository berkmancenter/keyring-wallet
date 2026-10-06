#!/bin/bash
# A join still waiting (#305/#319/#322): a fresh Android phone (push-off build) linked to the main runner asks to
# join C by its admin-review way. The Join screen and Your agent's community card must show the identity the
# request came from; each identity line and Join's actions must end above the tab bar. The request is declined.
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN C_DID C_NAME C_REST C_ADMIN_CRED
APK=$APK_OFF
leg_begin waiting "$(shasum -a 256 "$APK" | cut -c1-12)"
T0=$(stamp); E=emulator-5572
fin() { adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop; echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"; }
LEG_CLEANUP=fin
emu_start 5572
for pkg in $BID $BID.pushtest; do adb -s $E uninstall "$pkg" >/dev/null 2>&1; done
cd "$E2E"
E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4762 ENROL_PORT=8197 E2E_RELEASE=1 \
  LINK_MODE=manual RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 \
  perl -e 'alarm 1800; exec @ARGV' node run-vta-link.js > "$LEG_DIR/link.out" 2>&1 || broken "link: $(grep -E '✅|❌' "$LEG_DIR/link.out" | tail -1 | cut -c1-120)"
E2E_APP_ID=$BID UDID=$E ANDROID_UDID=$E ANDROID_SERIAL=$E APPIUM_PORT=4762 C_DID=$C_DID C_NAME=$C_NAME PERSONA_SHOTS=$LEG_DIR/persona-did \
  perl -e 'alarm 900; exec @ARGV' node run-join-waiting.mjs > "$LEG_DIR/waiting.out" 2>&1
grep -E '^\[e2e\] [0-9]|^PERSONA-DID|^WAITING-STATUS|^JOIN-IDENTITY-NAME' "$LEG_DIR/waiting.out" | cut -c1-220
# The community's newest pending request: whose identity the phone must show.
read -r RID RDID < <(c_admin join-list pending | python3 -c "
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
[ "$RID" != - ] && echo "  decline $RID: $(JOIN_DECIDE_REASON='gate: a join left waiting on purpose' c_admin join-decide "$RID" rejected | grep -oE -- '-> [0-9]+' | tail -1)"
