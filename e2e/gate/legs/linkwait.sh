#!/bin/bash
# IN-135 (bifold #351-#355, 239): the slow ones: a host code that lapsed on the confirm screen (5.5 min), a code window paused in the background (15 min), Try again after every sign-in failed (about 14 min).
# One fresh install and link per case (run-vta-link.js LINK_CASE=…), each printing its own row. Android emulator,
# rooted for the mediator block (RUNNER_MEDIATOR_HOST); the cleanup lifts every rule and removes the phone keys.
# A build without VtaLinkResumed (bifold #353) skips the leg.
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN RUNNER_MEDIATOR_HOST
APK=$APK_OFF
leg_begin linkwait "$(shasum -a 256 "$APK" | cut -c1-12)" "$APK"
if ! unzip -p "$APK" assets/index.android.bundle 2>/dev/null | grep -q VtaLinkResumed; then
  row linkwait SKIP "this build has no VtaLinkResumed (bifold #353)"; exit 0
fi
T0=$(stamp); E=emulator-5572
fin() {
  for t in iptables ip6tables; do adb -s $E shell $t -D OUTPUT -d "$RUNNER_MEDIATOR_HOST" -j REJECT >/dev/null 2>&1; done
  adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop; echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"
}
LEG_CLEANUP=fin
emu_start 5572
adb -s $E root >/dev/null 2>&1; sleep 3; adb -s $E wait-for-device; echo "adb root: uid $(adb -s $E shell id -u)"
cd "$E2E"
# The host-code cases (link-host-sleep, link-host-lock-after-grant, host-code-lapsed, link-try-again) need an https
# callback on ic3.dev or firstperson.dev (agentHostConnection.ts, AGENT_HOST_SITES): the gate's local http page cannot
# serve one, so for 239 they are unit-only (vtaAgentHostLink) plus manual. LINK_CASES overrides.
for c in ${LINK_CASES:-create-window-paused link-no-answer}; do
  selected "$c" || continue
  adb -s $E uninstall $BID >/dev/null 2>&1
  E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4762 ENROL_PORT=8197 E2E_RELEASE=1 \
    LINK_MODE=manual LINK_CASE=$c BLOCK_HOST=$RUNNER_MEDIATOR_HOST RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL \
    PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 E2E_ACL_CLEANUP=always perl -e 'alarm 2400; exec @ARGV' node run-vta-link.js > "$LEG_DIR/$c.out" 2>&1; rc=$?
  r=$(grep -E "^ROW $c(-[a-z]+)? " "$LEG_DIR/$c.out")
  if [ -n "$r" ]; then echo "$r"; else row "$c" FAIL "rc=$rc, no row: $(grep -E '❌|Error:' "$LEG_DIR/$c.out" | grep -v webdriver | head -1 | cut -c1-160)"; fi
done
