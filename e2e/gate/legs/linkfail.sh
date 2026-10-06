#!/bin/bash
# A link whose swap onto the long-term key does not happen must say why (bifold #325, VtaLink.SwapFailed):
#  swap-held     a consent rule holds acl/swap-key/0.1 (its approver set names a DID that never answers)
#  swap-refused  a policy module denies acl/swap-key/0.1 (pnm consent deny needs the requester's own refusal
#                body, which only the phone has; a deny policy is the host-side way to make the agent refuse)
#  ("no answer" needs the agent silent at the exact swap moment: bifold's unit tests cover it, not the gate.)
# Both change the main runner for every phone that links to it: run this leg alone (never side by side), and
# its cleanup removes the rule, the approver and the policy whatever happened, and says so.
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL RUNNER_A_DID PNM_BIN
APK=$APK_OFF
leg_begin linkfail "$(shasum -a 256 "$APK" | cut -c1-12)"
T0=$(stamp); E=emulator-5572; SET=gate-swap-held; TASK=https://trusttasks.org/spec/acl/swap-key/0.1; POL=gate-deny-swap-key
fin() {
  adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop; echo "== cleanup $(utc)"
  echo "  rule: $(pnm "$RUNNER_MAIN_SLUG" approvals remove "$TASK" | tail -1 | cut -c1-80)"
  echo "  approver: $(pnm "$RUNNER_MAIN_SLUG" approvals approvers remove "$SET" "$RUNNER_A_DID" | tail -1 | cut -c1-80)"
  echo "  policy: $(pnm "$RUNNER_MAIN_SLUG" policy delete "$POL" | tail -1 | cut -c1-80)"
  echo "  after: $(pnm "$RUNNER_MAIN_SLUG" approvals list | tr -d ' \n' | grep -oE '\{"approverSets.*' | cut -c1-80) · policies: $(pnm "$RUNNER_MAIN_SLUG" policy list | grep -c "$POL") named $POL"
  keys_since "$RUNNER_MAIN_SLUG" "$T0"
}
LEG_CLEANUP=fin
emu_start 5572
cd "$E2E"
L() { adb -s $E uninstall $BID >/dev/null 2>&1
  E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4762 ENROL_PORT=8197 E2E_RELEASE=1 \
  LINK_MODE=manual RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN=$PNM_BIN "$@"; }
said() { grep -oE 'swap failed as expected \([a-zA-Z]+\): ".*"' "$1" | head -1 | cut -c1-200; }

if selected swap-held; then
  echo "  approver set: $(pnm "$RUNNER_MAIN_SLUG" approvals approvers add "$SET" "$RUNNER_A_DID" | tail -1 | cut -c1-80)"; sleep 3
  echo "  rule: $(pnm "$RUNNER_MAIN_SLUG" approvals require "$TASK" --consent --set "$SET" | tail -1 | cut -c1-80)"; sleep 3
  L env EXPECT_REFUSAL=swapHeld perl -e 'alarm 1200; exec @ARGV' node run-vta-link.js > "$LEG_DIR/held.out" 2>&1; rc=$?
  if [ $rc -eq 0 ]; then row swap-held PASS "$(said "$LEG_DIR/held.out")"; else row swap-held FAIL "rc=$rc $(grep -E '❌|Error:' "$LEG_DIR/held.out" | grep -v webdriver | head -1 | cut -c1-160)"; fi
  echo "  rule off: $(pnm "$RUNNER_MAIN_SLUG" approvals remove "$TASK" | tail -1 | cut -c1-60)"; sleep 3
fi

if selected swap-refused; then
  printf '%s\n' 'package vta.policy' 'import rego.v1' \
    "decision := {\"decision\": \"deny\", \"explanation\": \"gate: acl/swap-key refused on purpose (#325 row)\"} if {" \
    "  input.request.typeUri == \"$TASK\"" '}' > "$LEG_DIR/deny-swap.rego"
  echo "  policy: $(pnm "$RUNNER_MAIN_SLUG" policy upsert --id "$POL" --name "$POL" --priority 1000 --module "$LEG_DIR/deny-swap.rego" | tail -1 | cut -c1-80)"; sleep 3
  L env EXPECT_REFUSAL=swapRefused perl -e 'alarm 1200; exec @ARGV' node run-vta-link.js > "$LEG_DIR/refused.out" 2>&1; rc=$?
  if [ $rc -eq 0 ]; then row swap-refused PASS "$(said "$LEG_DIR/refused.out")"; else row swap-refused FAIL "rc=$rc $(grep -E '❌|Error:' "$LEG_DIR/refused.out" | grep -v webdriver | head -1 | cut -c1-160)"; fi
fi
row swap-no-answer SKIP "covered by bifold's unit tests: the agent must go silent at the exact swap moment"
