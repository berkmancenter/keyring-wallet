#!/bin/bash
# bifold #347, the device half: a join ask that cannot reach C says so. A fresh Android phone (push-off build) linked
# to the main runner asks to join C with C's messaging host blocked: Join must show an error line, C's pending list
# must not change, and Join must not say "Request sent" (run-join-lost.mjs, row lost-ask-offline-error). A request
# that reached C anyway is declined at the end. The other half, a request recorded as sent and then lost (said, and
# sent again), cannot be forced from the phone: bifold's joinLostRequest.test.tsx holds it.
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN C_DID C_NAME C_REST C_ADMIN_CRED
APK=$APK_OFF
leg_begin lostreq "$(shasum -a 256 "$APK" | cut -c1-12)" "$APK"
T0=$(stamp); E=emulator-5572
fin() {
  adb -s $E shell cmd connectivity airplane-mode disable >/dev/null 2>&1
  [ -n "${C_MEDIATOR_HOST:-}" ] && for t in iptables ip6tables; do adb -s $E shell $t -D OUTPUT -d "$C_MEDIATOR_HOST" -j REJECT >/dev/null 2>&1; done
  # IN-258's cut of the status-list host (run-card-status.mjs puts it back itself; this is for a driver that was killed).
  local h; for h in $(grep -oE '^STATUS_BLOCK_HOST [^ ]+' "$LEG_DIR/card.out" 2>/dev/null | awk '{print $2}' | sort -u); do for t in iptables ip6tables; do
    adb -s $E shell $t -D OUTPUT -p tcp -m string --string "$h" --algo bm -j REJECT --reject-with tcp-reset >/dev/null 2>&1; adb -s $E shell $t -D OUTPUT -d "$h" -j REJECT >/dev/null 2>&1; done; done
  adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop; echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"
  local r; for r in $(grep -hoE '^ARRIVED_REQ [^ ]+' "$LEG_DIR/lost.out" "$LEG_DIR/card.out" 2>/dev/null | awk '{print $2}' | sort -u); do
    echo "  decline $r: $(JOIN_DECIDE_REASON='gate: an offline-ask test that reached C anyway, declined after the leg' c_admin join-decide "$r" rejected | grep -oE -- '-> [0-9]+' | tail -1)"
  done
  local m; for m in $(grep -oE '^JOIN_MEMBER did:[^ ]+' "$LEG_DIR/card.out" 2>/dev/null | awk '{print $2}' | sort -u); do
    echo "  C member …${m: -24}: $(c_admin member-remove "$m" "gate: IN-258 card-status member, removed after the leg" | grep -oE -- '-> [0-9]+' | tail -1)"
  done
}
LEG_CLEANUP=fin
emu_start 5572
for pkg in $BID $BID.pushtest; do adb -s $E uninstall "$pkg" >/dev/null 2>&1; done
cd "$E2E"
E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4762 ENROL_PORT=8197 E2E_RELEASE=1 \
  LINK_MODE=manual RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 \
  galarm 1800 node run-vta-link.js > "$LEG_DIR/link.out" 2>&1 || broken "link: $(grep -E '✅|❌' "$LEG_DIR/link.out" | tail -1 | cut -c1-120)"
# Block only the community's messaging host (needs root: google_apis image).
if [ -n "${C_MEDIATOR_HOST:-}" ]; then adb -s $E root >/dev/null 2>&1; sleep 3; adb -s $E wait-for-device; echo "adb root: $(adb -s $E shell id -u)"; fi
E2E_APP_ID=$BID UDID=$E APPIUM_PORT=4762 BLOCK_HOST=${C_MEDIATOR_HOST:-} C_DID=$C_DID C_NAME=$C_NAME C_ADMIN="$C_REST $C_DID $C_ADMIN_CRED" \
  galarm 900 node run-join-lost.mjs > "$LEG_DIR/lost.out" 2>&1; drc=$?
grep -E '^\[e2e\] [0-9]' "$LEG_DIR/lost.out" | cut -c1-220
take_rows "$LEG_DIR/lost.out"
driver_rc lostreq-driver "$drc" "$LEG_DIR/lost.out"
# IN-258 (fixed by bifold #386): the same phone, not a member and with no open request, asks to join C and is approved
# while only the status-list host is cut; the card must say its status could not be checked (run-card-status.mjs, row
# card-status-unreachable-notice; tracked only on a build without #386's CardStatusNotice). iptables needs root.
# Anything run-join-lost's ask left at C is declined now, before the card-status run asks again: that run tells its
# own request by what is new, and a leftover one would make the phone "already asked".
for r in $(grep -oE '^ARRIVED_REQ [^ ]+' "$LEG_DIR/lost.out" 2>/dev/null | awk '{print $2}' | sort -u); do
  echo "  decline $r (before card-status): $(JOIN_DECIDE_REASON='gate: an offline-ask test that reached C anyway, declined before the next ask' c_admin join-decide "$r" rejected | grep -oE -- '-> [0-9]+' | tail -1)"
done
adb -s $E root >/dev/null 2>&1; sleep 3; adb -s $E wait-for-device
# A build with bifold #386's notice (CardStatusNotice) must show it: no notice is a FAIL there, tracked only before.
CS_STRICT=; build_has CardStatusNotice "$APK" && CS_STRICT=1
# A build that logs its card-status reads (bifold #410) lets the driver prove the cut held; without it, as before.
CS_LOGS=; build_has cardStatusLogLine "$APK" && CS_LOGS=1
E2E_APP_ID=$BID UDID=$E APPIUM_PORT=4762 C_DID=$C_DID C_NAME=$C_NAME C_REST=$C_REST C_ADMIN="$C_REST $C_DID $C_ADMIN_CRED" C_MEDIATOR_HOST=${C_MEDIATOR_HOST:-} \
  STATUS_LIST_HOST=${STATUS_LIST_HOST:-} CARD_STATUS_STRICT=${CARD_STATUS_STRICT:-$CS_STRICT} CARD_STATUS_LOGS=$CS_LOGS galarm 1200 node run-card-status.mjs > "$LEG_DIR/card.out" 2>&1; crc=$?
grep -E '^\[e2e\] [0-9]|^(PROBE|ISSUED) ' "$LEG_DIR/card.out" | cut -c1-260
take_rows "$LEG_DIR/card.out"
grep -E '^(CUT-CHECK|CUT-NOT-HELD|NO-STATUS-READ) ' "$LEG_DIR/card.out" | cut -c1-260
# The cut did not hold, or the app never read a status during it: no verdict on IN-258 either way (the harness).
if grep -qE '^(CUT-NOT-HELD|NO-STATUS-READ) ' "$LEG_DIR/card.out"; then
  broken "card-status-unreachable-notice not reached: $(grep -m1 -E '^(CUT-NOT-HELD|NO-STATUS-READ) ' "$LEG_DIR/card.out" | cut -c1-200)"
fi
# A driver that never printed its row (killed by its alarm, a crash): FAIL on a build with #386, tracked before it.
if ! grep -qE "^ROW card-status-unreachable-notice " "$LEG_DIR/card.out"; then
  why="the driver stopped (rc=$crc): $(grep -aE 'error: |Error:' "$LEG_DIR/card.out" | grep -v webdriver | tail -1 | cut -c1-140)"
  if [ -n "$CS_STRICT" ]; then row card-status-unreachable-notice FAIL "$why"
  else row card-status-unreachable-notice SKIP "tracked (a build without bifold #386's CardStatusNotice): $why"; fi
fi
