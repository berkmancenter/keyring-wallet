#!/bin/bash
# Two fresh iOS simulators, A and B (e2e/run-pair-ios.mjs): the relationship invitation shared as a link (bifold #453;
# iOS; Android unproven) and a tapped message wake (bifold #452; tap path only: the mediator wake isn't exercised, a
# wake-shaped notification is delivered with simctl push). Both phones are wiped and onboarded; neither links to an
# agent, so the leg holds no runner. A and B default to kk's applicant and the sign-in simulator (both are wiped by
# their own legs too, and the iOS group runs one leg at a time); PAIR_A_SIM_UDID / PAIR_B_SIM_UDID name others.
# The build needs the testIDs MyQRShareLink (#453) and MessagesFetchingNew (#452): an older build SKIPs every row.
. "$(dirname "$0")/../lib.sh"; gate_env
PAIR_ROWS="pair-share-link-made pair-share-link-connects pair-wake-opens-chat pair-wake-no-unread-list"
leg_begin pair-ios "$(shasum -a 256 "$CAND_APP/main.jsbundle" | cut -c1-12)" "$CAND_APP"
A=${PAIR_A_SIM_UDID:-${APPLICANT_SIM_UDID:-}}; A_NAME=${PAIR_A_SIM_NAME:-${APPLICANT_SIM_NAME:-}}
B=${PAIR_B_SIM_UDID:-${SIGNIN_SIM_UDID:-}}; B_NAME=${PAIR_B_SIM_NAME:-${SIGNIN_SIM_NAME:-}}
if [ -z "$A" ] || [ -z "$B" ] || [ "$A" = "$B" ]; then
  for r in $PAIR_ROWS; do row "$r" SKIP "two simulators needed (PAIR_A_SIM_UDID/PAIR_B_SIM_UDID, or APPLICANT_SIM_UDID and SIGNIN_SIM_UDID)"; done
  exit 0
fi
# The build's bundle carries the testIDs as strings: one without them predates #452/#453.
miss=; for id in MyQRShareLink MessagesFetchingNew; do grep -aq "$id" "$CAND_APP/main.jsbundle" || miss="$miss $id"; done
if [ -n "$miss" ]; then for r in $PAIR_ROWS; do row "$r" SKIP "the build lacks$miss (before bifold #452/#453)"; done; exit 0; fi
need IOS_VERSION
T0S=$(date +%s)
wda_stop() { local p; for p in $(ps -axo pid,command | grep -E "xcodebuild.*WebDriverAgent" | grep "$1" | grep -v grep | awk '{print $1}'); do kill "$p"; done; }
fin() {
  ios_log_save "$A" "$LEG_DIR/a-ios.log" "$T0S"; ios_log_save "$B" "$LEG_DIR/b-ios.log" "$T0S"
  wda_stop "$A"; wda_stop "$B"
  for u in "$A" "$B"; do xcrun simctl uninstall "$u" "$BID" 2>/dev/null; sim_down "$u"; done
  echo "== cleanup $(utc)"
}
LEG_CLEANUP=fin
for u in "$A" "$B"; do
  sim_boot "$u"; xcrun simctl uninstall "$u" "$BID" 2>/dev/null
  xcrun simctl install "$u" "$CAND_APP" || broken "could not install the build on $u"
done
cd "$E2E"
E2E_APP_ID=$BID PLATFORM=ios IOS_APP=$CAND_APP IOS_PLATFORM_VERSION=$IOS_VERSION APPIUM_PORT=4776 E2E_RELEASE=1 \
  A_UDID=$A A_NAME="$A_NAME" B_UDID=$B B_NAME="$B_NAME" \
  galarm 1800 node run-pair-ios.mjs > "$LEG_DIR/pair.out" 2>&1; rc=$?
take_rows "$LEG_DIR/pair.out"
driver_rc pair-ios-driver "$rc" "$LEG_DIR/pair.out"
