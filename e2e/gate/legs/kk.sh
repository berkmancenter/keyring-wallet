#!/bin/bash
# K↔K: an iOS applicant meets the seated iOS vetter (both Keyring) and joins C by vetting. The applicant links to
# the main runner; the vetter simulator is seated once, by hand, and only gets the build installed over it.
# Rows: kk-link, kk-vetting, a foot-<shot> row per persona line the vetting driver captures (#322), and id305:
# the applicant's community card shows the DID the community lists as its newest member. id305 runs here,
# before the cleanup removes the applicant's key (the 235 gate lost it to running it after).
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL C_DID C_REST C_ADMIN_CRED C_NAME VETTER_SIM_UDID VETTER_SIM_NAME VETTER_DID APPLICANT_SIM_UDID APPLICANT_SIM_NAME IOS_VERSION
leg_begin kk "$(shasum -a 256 "$CAND_APP/main.jsbundle" | cut -c1-12)"
T0=$(stamp)
wda_stop() { local p; for p in $(ps -axo pid,command | grep -E "xcodebuild.*WebDriverAgent" | grep "$1" | grep -v grep | awk '{print $1}'); do kill "$p"; done; }
fin() {
  wda_stop "$VETTER_SIM_UDID"; wda_stop "$APPLICANT_SIM_UDID"; sim_down "$VETTER_SIM_UDID"; sim_down "$APPLICANT_SIM_UDID"
  echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"
}
LEG_CLEANUP=fin
export RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN ENROL_PORT=8186 E2E_RELEASE=1
export KEYRING_COMMUNITY_DID=$C_DID KEYRING_COMMUNITY_REST=$C_REST KEYRING_COMMUNITY_ADMIN_CRED=$C_ADMIN_CRED KEYRING_COMMUNITY_NAME=$C_NAME
cd "$E2E"

sim_boot "$APPLICANT_SIM_UDID"; xcrun simctl uninstall "$APPLICANT_SIM_UDID" "$BID" 2>/dev/null
t=$(date +%s)
PLATFORM=ios IOS_APP=$CAND_APP UDID=$APPLICANT_SIM_UDID IOS_DEVICE_NAME=$APPLICANT_SIM_NAME IOS_PLATFORM_VERSION=$IOS_VERSION APPIUM_PORT=4771 LINK_MODE=manual E2E_KEEP_APP=1 \
  perl -e 'alarm 1800; exec @ARGV' node run-vta-link.js > "$LEG_DIR/applicant-link.out" 2>&1; rc=$?
if [ $rc -eq 0 ]; then row kk-link PASS "$(( $(date +%s) - t ))s"; else row kk-link FAIL "rc=$rc $(grep -E '✅|❌' "$LEG_DIR/applicant-link.out" | tail -1 | cut -c1-120)"; broken "the applicant did not link"; fi

sim_boot "$VETTER_SIM_UDID"
# The seated vetter keeps its data; the build under test goes over it (simctl install keeps the app container).
xcrun simctl install "$VETTER_SIM_UDID" "$CAND_APP" || broken "could not install the build on the vetter simulator"
t=$(date +%s)
VETTER_DID=$VETTER_DID E2E_KEEP_STATE=1 E2E_KEEP_APP=1 APPLICANT_DOOR=link PLATFORMS=ios,ios APPLICANT_IOS_SIM=$APPLICANT_SIM_NAME VETTER_IOS_SIM=$VETTER_SIM_NAME \
  IOS_APP=$CAND_APP IOS_PLATFORM_VERSION=$IOS_VERSION APPIUM_PORT=4772 PERSONA_SHOTS=$LEG_DIR/persona-did JOIN_WAYS=invited-member,vetted-member,review \
  perl -e 'alarm 1800; exec @ARGV' node run-vti-vetting.js > "$LEG_DIR/vetting.out" 2>&1; rc=$?
if [ $rc -eq 0 ]; then row kk-vetting PASS "$(( $(date +%s) - t ))s"
else row kk-vetting FAIL "rc=$rc · $(grep -E '^\[step\].*FAILED' "$LEG_DIR/vetting.out" | tail -1 | cut -c1-160)"; fi
grep -E '^(PERSONA-DID|\[step\])' "$LEG_DIR/vetting.out" | cut -c1-200
while read -r _ shot st rest; do
  case $st in clear) row "foot-$shot" PASS "$rest" ;; *) row "foot-$shot" FAIL "$st $rest" ;; esac
done < <(grep -E '^FOOT ' "$LEG_DIR/vetting.out")
if selected id305; then
  # The applicant's community card, as the vetting run captured it (its "Show the code they see" line): the
  # identity C must list as its newest member. Read from that capture, not a second driver session (236 gate:
  # a separate iOS session found the toggle but read an empty line).
  shown=$(grep -oE '^PERSONA-DID kk-applicant-community-card did:[^ ]+' "$LEG_DIR/vetting.out" | awk '{print $3}')
  newest=$(c_admin members | python3 -c "
import sys,json; t=sys.stdin.read(); d=json.loads(t[t.index('{'):]) if '{' in t else {}
m=sorted(d.get('items') or [], key=lambda x: x.get('joinedAt','')); print(m[-1]['did'] if m else '-')")
  if [ -n "$shown" ] && [ "$shown" = "$newest" ]; then row id305 PASS "the card shows $shown, the community's newest member"
  else row id305 FAIL "the card shows ${shown:-nothing}; newest member $newest"; fi
fi
