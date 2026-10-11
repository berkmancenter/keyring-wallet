#!/bin/bash
# 241: an agent's code by the scanner. One fresh install and link per case (run-vta-link.js LINK_CASE=…), each its row:
#  pnmqr-scan          the QR `pnm vta qr` draws (only the agent's bare DID) decodes to the runner's DID, which the
#                      scanner takes to Linked. Pasted, not shown to the camera: no helper feeds the emulator's camera.
#  scan-agent-no-rest  an agent with no VTARest in its DID document, scanned: the link must start. TRACKED (a failure
#                      is a SKIP) until the scanner fix; needs NO_REST_AGENT_DID (+ NO_REST_AGENT_SLUG), none on the Farm.
#  link-again-rescan   IN-251 (bifold #383): the agent removes this phone; Link again, the same agent scanned: a link
#                      starts, not "This phone already has that agent". Skips on a build without #383.
# Android emulator 5572, as linkfail. The cleanup removes the phone keys made since the start on each agent used and
# sweeps the main runner.
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN
APK=$APK_OFF
leg_begin pnmlink "$(shasum -a 256 "$APK" | cut -c1-12)" "$APK"
T0=$(stamp); E=emulator-5572
fin() {
  adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop; echo "== cleanup $(utc)"
  keys_since "$RUNNER_MAIN_SLUG" "$T0"
  if [ -n "${NO_REST_AGENT_SLUG:-}" ] && [ "$NO_REST_AGENT_SLUG" != "$RUNNER_MAIN_SLUG" ]; then keys_since "$NO_REST_AGENT_SLUG" "$T0"; fi
  gate_sweep_runner "$RUNNER_MAIN_SLUG"
}
LEG_CLEANUP=fin
emu_start 5572
cd "$E2E"
# What pnm draws, written once for the row; its output too: the "DID  <did>" line it prints, or why it drew nothing.
if selected pnmqr-scan; then
  rm -f "$LEG_DIR/pnm-qr.svg"
  pnm "$RUNNER_MAIN_SLUG" vta qr --out "$LEG_DIR/pnm-qr.svg" > "$LEG_DIR/pnm-qr.out"
  echo "  pnm vta qr: $(tail -1 "$LEG_DIR/pnm-qr.out" | cut -c1-100)"
fi
for c in ${LINK_CASES:-pnmqr-scan scan-agent-no-rest link-again-rescan}; do
  selected "$c" || continue
  # The agent without VTARest is linked as itself, so the driver grants and cleans up on its own slug.
  slug=$RUNNER_MAIN_SLUG did=$RUNNER_MAIN_DID url=$RUNNER_MAIN_URL
  if [ "$c" = scan-agent-no-rest ] && [ -n "${NO_REST_AGENT_DID:-}" ] && [ -n "${NO_REST_AGENT_SLUG:-}" ]; then
    slug=$NO_REST_AGENT_SLUG did=$NO_REST_AGENT_DID url=
  fi
  adb -s $E uninstall $BID >/dev/null 2>&1
  E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4762 ENROL_PORT=8197 E2E_RELEASE=1 \
    LINK_MODE=manual LINK_CASE=$c RUNNER_VTA=$slug RUNNER_VTA_DID=$did RUNNER_VTA_URL=$url \
    PNM_QR_SVG=$LEG_DIR/pnm-qr.svg PNM_QR_OUT=$LEG_DIR/pnm-qr.out \
    NO_REST_AGENT_DID=${NO_REST_AGENT_DID:-} NO_REST_AGENT_SLUG=${NO_REST_AGENT_SLUG:-} EXPECT_IN251=${EXPECT_IN251:-} \
    PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 E2E_ACL_CLEANUP=always perl -e 'alarm 1800; exec @ARGV' node run-vta-link.js > "$LEG_DIR/$c.out" 2>&1; rc=$?
  take_rows "$LEG_DIR/$c.out"
  # No row of its own: the driver stopped outside it (setup, onboarding), or ended without one.
  if ! grep -q "^ROW $c " "$LEG_DIR/$c.out"; then
    case $rc in 0|3) row "$c" FAIL "rc=$rc and no row" ;; *) driver_rc "$c" "$rc" "$LEG_DIR/$c.out" ;; esac
  fi
done
