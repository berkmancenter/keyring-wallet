#!/bin/bash
# IN-135 (bifold #351-#355, 239): a link that survives the phone going away, and the cases that wait on the app's own
# clocks: a code window paused in the background, "didn't answer" once the grant window ends, the wait holding the
# auto-lock off (#396). The clock cases read the clocks in force from the Developer screen (lib/clocks.js, bifold #411)
# and time themselves by them: a short-clock test build (E2E_CLOCKS=short) waits about a minute where the shipped
# build waits ten. linkresume's two cases (force-stop before and after the grant) run here too, on the same emulator
# (gate efficiency item 4).
# One fresh install and link per case (run-vta-link.js LINK_CASE=…), each printing its own row. Android emulator,
# rooted for the mediator block (RUNNER_MEDIATOR_HOST); the cleanup lifts every rule and removes the phone keys.
# A build without VtaLinkResumed (bifold #353) skips the leg.
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN RUNNER_MEDIATOR_HOST
APK=$APK_OFF
# A nightly run times the cases on the store build's clocks: the real-clocks build (gate.sh nightly_real_build). With
# none, the run says so rather than repeat the short-clock gate.
if [ "${GATE_KIND:-}" = nightly ]; then
  if [ -z "${APK_REAL:-}" ] || [ ! -f "$APK_REAL" ]; then
    leg_begin linkwait - ""; row linkwait SKIP "nightly: no real-clocks build (test-builds.yml clocks=real) of this commit"; exit 0
  fi
  APK=$APK_REAL; echo "nightly: real-clocks build ${REAL_NOTE:-?}"
fi
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
# Each case keeps the app's own log (its [VTA] resume lines among them): a case that fails can be read afterwards
# (#513: link-address-resume failed once and nothing showed whether the app's resume ran). 16M so a case cannot wrap.
adb -s $E logcat -G 16M >/dev/null 2>&1
cd "$E2E"
# The host-code cases (link-host-sleep, link-host-lock-after-grant, host-code-lapsed, link-try-again) need an https
# callback on ic3.dev or firstperson.dev (agentHostConnection.ts, AGENT_HOST_SITES): the gate's local http page cannot
# serve one, so for 239 they are unit-only (vtaAgentHostLink) plus manual. LINK_CASES overrides.
for c in ${LINK_CASES:-link-address-resume link-address-resume-later create-window-paused link-no-answer create-wait-no-lock}; do
  selected "$c" || continue
  adb -s $E uninstall $BID >/dev/null 2>&1; adb -s $E logcat -c >/dev/null 2>&1
  E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4762 ENROL_PORT=8197 E2E_RELEASE=1 \
    LINK_MODE=manual LINK_CASE=$c BLOCK_HOST=$RUNNER_MEDIATOR_HOST RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL \
    PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 E2E_ACL_CLEANUP=always galarm 2400 node run-vta-link.js > "$LEG_DIR/$c.out" 2>&1; rc=$?
  adb -s $E logcat -d > "$LEG_DIR/$c-logcat.log" 2>/dev/null
  r=$(grep -E "^ROW $c(-[a-z]+)? " "$LEG_DIR/$c.out")
  # A driver failure (the case's own "driver: …" error) is no verdict on the app: the leg is broken, not red.
  # The thrown error's own line ("Error: driver: …"), not the first "driver:" in the log: WebDriver's own lines say
  # "driver: Initiate new session…" (1018-2047 rerun named that as the reason).
  d=$(grep -m1 -oE 'Error: driver: .*' "$LEG_DIR/$c.out" | sed 's/^Error: //' | cut -c1-160)
  if [ -n "$r" ]; then echo "$r"; elif [ -n "$d" ]; then broken "$c: $d"; else row "$c" FAIL "rc=$rc, no row: $(grep -E '❌|Error:' "$LEG_DIR/$c.out" | grep -v webdriver | head -1 | cut -c1-160)"; fi
done
