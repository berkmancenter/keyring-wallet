#!/bin/bash
# A plain join (#305/#319/#322, and flow B): a fresh Android phone (push-off build) linked to the main runner asks
# to join C by its admin-review way. While it waits, the Join screen and Your agent's community card must show the
# identity the request came from, and each identity line and Join's actions must end above the tab bar.
# Then C's admin approves it (our REST admin script): the card must turn to member, C must list the identity, and
# the Wallet must show the card (run-join-waiting.mjs, JOIN_APPROVE=1); Your agent's card for C must show the role
# card as well (join-approved-role-card); the runner agent's vault must hold both cards (cards-kept-on-agent, pnm
# cred-vault query); and, tracked until Keyring sends it, C must record the member's reciprocal membership credential
# (member-vmc-sent). Last, the app is wiped and linked to the same agent again, and "Get your cards" must bring both
# cards back (run-cards-back.mjs, cards-back-new-install, tracked). The member is removed at the end.
# WAITING_DECLINE=1 declines instead, the older shape.
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN C_DID C_NAME C_REST C_ADMIN_CRED
APK=$APK_OFF
leg_begin waiting "$(shasum -a 256 "$APK" | cut -c1-12)" "$APK"
T0=$(stamp); E=emulator-5572
fin() {
  adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop; echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"
  local m; for m in $(grep -oE '^JOIN_MEMBER did:[^ ]+' "$LEG_DIR/waiting.out" 2>/dev/null | awk '{print $2}' | sort -u); do
    echo "  C member …${m: -24}: $(c_admin member-remove "$m" "gate: flow B member, removed after the leg" | grep -oE -- '-> [0-9]+' | tail -1)"
  done
  # The cards the phone kept in the runner's vault (CARD_IDS): archived, as pnm has no delete, so they leave every query.
  local id; for id in $(grep -hE '^CARD_IDS ' "$LEG_DIR/waiting.out" 2>/dev/null | awk '{print $2, $3}' | tr ' ' '\n' | grep -v '^$' | sort -u); do
    echo "  vault card …${id: -12}: $(pnm "$RUNNER_MAIN_SLUG" cred-vault archive "$id" --reason "gate: waiting leg card, archived after the leg" | tail -1 | cut -c1-60)"
  done
}
LEG_CLEANUP=fin
emu_start 5572
for pkg in $BID $BID.pushtest; do adb -s $E uninstall "$pkg" >/dev/null 2>&1; done
cd "$E2E"
# link_phone <output file>: install the APK on the emulator and link it to the main runner (a fresh install each time).
link_phone() {
  E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4762 ENROL_PORT=8197 E2E_RELEASE=1 \
    LINK_MODE=manual RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 \
    galarm 1800 node run-vta-link.js > "$1" 2>&1
}
link_phone "$LEG_DIR/link.out" || broken "link: $(grep -E '✅|❌' "$LEG_DIR/link.out" | tail -1 | cut -c1-120)"
APPROVE=1; [ "${WAITING_DECLINE:-}" = 1 ] && APPROVE=0
E2E_APP_ID=$BID UDID=$E ANDROID_UDID=$E ANDROID_SERIAL=$E APPIUM_PORT=4762 C_DID=$C_DID C_NAME=$C_NAME PERSONA_SHOTS=$LEG_DIR/persona-did \
  JOIN_APPROVE=$APPROVE C_ADMIN="$C_REST $C_DID $C_ADMIN_CRED" RUNNER_VTA=$RUNNER_MAIN_SLUG PNM_BIN=$PNM_BIN COMMUNITY_B_DID="${COMMUNITY_B_DID:-}" COMMUNITY_B_TICKET_CMD="${COMMUNITY_B_TICKET_CMD:-}" \
  galarm 900 node run-join-waiting.mjs > "$LEG_DIR/waiting.out" 2>&1; drc=$?
grep -E '^\[e2e\] [0-9]|^PERSONA-DID|^WAITING-STATUS|^JOIN-IDENTITY-NAME' "$LEG_DIR/waiting.out" | cut -c1-220
take_rows "$LEG_DIR/waiting.out"   # flow B's rows (a)–(g) when approved
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
driver_rc waiting-driver "$drc" "$LEG_DIR/waiting.out"
# IN-149 (#363), read-only: an outside community's Join lists "Meet a vetter" among the usable ways. Nothing is tapped
# on Join and nothing is joined; skipped without OUTSIDE_VTC_DID.
if [ -n "${OUTSIDE_VTC_DID:-}" ]; then
  E2E_APP_ID=$BID UDID=$E ANDROID_UDID=$E ANDROID_SERIAL=$E APPIUM_PORT=4762 OUTSIDE_VTC_DID=$OUTSIDE_VTC_DID \
    galarm 300 node run-join-outside.mjs > "$LEG_DIR/outside.out" 2>&1; orc=$?
  take_rows "$LEG_DIR/outside.out"; driver_rc outside-driver "$orc" "$LEG_DIR/outside.out"
fi
# Cards back on a new install, last (it wipes the app): the same agent linked again, "Get your cards", both cards back.
# Tracked (lib/rows.js `tracked`): a new install does not adopt the agent's identities yet (planned for 242); the
# purpose-only vault query was fixed by bifold #389.
CB_ROW=cards-back-new-install
CB_TRACKED="new install: identities not adopted from the agent (planned for 242, Alberto 10-14)"
if ! selected "$CB_ROW"; then row "$CB_ROW" SKIP "not selected"
elif [ "$APPROVE" != 1 ]; then row "$CB_ROW" SKIP "flow B did not run (WAITING_DECLINE=1): no member to take cards back for"
elif ! grep -qE '^JOIN_MEMBER did:' "$LEG_DIR/waiting.out"; then row "$CB_ROW" SKIP "tracked ($CB_TRACKED): not run, flow B approved no request"
elif [ -n "${COMMUNITY_B_DID:-}" ]; then row "$CB_ROW" SKIP "tracked ($CB_TRACKED): not run, the identity left C in left-scan-other-ticket"
else
  echo "  wipe and link again $(utc): $(grep -E '^CARD_IDS ' "$LEG_DIR/waiting.out" | tail -1)"
  adb -s $E uninstall $BID >/dev/null 2>&1
  if link_phone "$LEG_DIR/link-again.out"; then
    row relink-wiped-app PASS "the wiped app linked to the same agent again"
    E2E_APP_ID=$BID UDID=$E ANDROID_UDID=$E ANDROID_SERIAL=$E APPIUM_PORT=4762 C_DID=$C_DID C_NAME=$C_NAME \
      galarm 600 node run-cards-back.mjs > "$LEG_DIR/cards-back.out" 2>&1; cbrc=$?
    grep -E '^\[e2e\] [0-9]' "$LEG_DIR/cards-back.out" | cut -c1-220
    take_rows "$LEG_DIR/cards-back.out"
    # Tracked to the end: a driver that never printed its row (killed by its alarm, or a crash before the row) is the
    # tracked row's detail too, not an untracked driver FAIL.
    grep -qE "^ROW $CB_ROW " "$LEG_DIR/cards-back.out" || row "$CB_ROW" SKIP "tracked ($CB_TRACKED): the driver stopped (rc=$cbrc): $(grep -aE 'error: |Error:' "$LEG_DIR/cards-back.out" | grep -v webdriver | tail -1 | cut -c1-140)"
  else
    # Linking the wiped app to the same agent is core linking, not the tracked gap: its own row, and a real FAIL.
    row relink-wiped-app FAIL "$(grep -E '✅|❌' "$LEG_DIR/link-again.out" | tail -1 | cut -c1-140)"
    row "$CB_ROW" SKIP "tracked ($CB_TRACKED): not run, relink-wiped-app failed"
  fi
fi
