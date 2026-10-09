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
# 239 (bifold #355), on VtaLink's scan branch (the address path's AgentCreateError has no Try again): a held swap
# offers Try again, which links with the same key once the rule is lifted; a refused one does not; neither retries
# by itself on foreground. A build without VtaLinkTryAgain skips these.
if unzip -p "$APK" assets/index.android.bundle 2>/dev/null | grep -q VtaLinkTryAgain; then
  line() { grep -m1 "^$2" "$1" | cut -c1-200; }
  if selected swap-held-try-again || selected swap-held-no-retry || selected swap-held-rescan; then
    # swap-refused's deny policy outranks the consent rule: without removing it first the held swap is refused
    # instead (239 gate).
    echo "  policy off: $(pnm "$RUNNER_MAIN_SLUG" policy delete "$POL" | tail -1 | cut -c1-60)"; sleep 3
    echo "  approver set: $(pnm "$RUNNER_MAIN_SLUG" approvals approvers add "$SET" "$RUNNER_A_DID" | tail -1 | cut -c1-80)"; sleep 3
    echo "  rule: $(pnm "$RUNNER_MAIN_SLUG" approvals require "$TASK" --consent --set "$SET" | tail -1 | cut -c1-80)"; sleep 3
    if selected swap-held-try-again || selected swap-held-no-retry; then
    HOOK="PNM_BIN=$PNM_BIN $REPO/scripts/openvtc/pnm-locked --vta $RUNNER_MAIN_SLUG approvals remove $TASK | tail -1"
    L env LINK_VIA=scan EXPECT_REFUSAL=swapHeld TRY_AGAIN_EXPECT=yes NO_RETRY_CHECK=1 TRY_AGAIN_HOOK="$HOOK" \
      perl -e 'alarm 1500; exec @ARGV' node run-vta-link.js > "$LEG_DIR/held-scan.out" 2>&1; rc=$?
    t=$(line "$LEG_DIR/held-scan.out" TRYAGAIN-LINKED); s=$(line "$LEG_DIR/held-scan.out" "TRYAGAIN "); n=$(line "$LEG_DIR/held-scan.out" NO-RETRY)
    a=$(echo "$t" | grep -oE 'ACL [0-9]+ → [0-9]+'); grow=$(echo "$a" | awk '{print ($4 > $2)}')
    row swap-held-try-again "$([[ $s == "TRYAGAIN shown"* && $t == "TRYAGAIN-LINKED yes"* && $grow == 0 ]] && echo PASS || echo FAIL)" "rc=$rc · ${s:-no TRYAGAIN line} · ${t:-no TRYAGAIN-LINKED line}"
    row swap-held-no-retry "$([[ $n == "NO-RETRY ok"* ]] && echo PASS || echo FAIL)" "${n:-no NO-RETRY line}"
    fi
    # 239 finding: after a held swap the agent must not stay listed; scanning it again starts a link.
    if selected swap-held-rescan; then
      # 239 gate: once the rescan sat on "Securing this phone's key…" past a 30 s wait. Run it RESCAN_RUNS times
      # (2) with RESCAN_WAIT_MS (180 s) and the emulator's whole log from the row's start, so slow and stuck differ.
      ok=0; d=""
      for i in $(seq 1 "${RESCAN_RUNS:-2}"); do
        echo "  rule (again, for rescan run $i): $(pnm "$RUNNER_MAIN_SLUG" approvals require "$TASK" --consent --set "$SET" | tail -1 | cut -c1-80)"; sleep 3
        adb -s $E logcat -c 2>/dev/null; adb -s $E logcat -v threadtime > "$LEG_DIR/held-rescan-$i.logcat" 2>&1 & lc=$!
        L env LINK_VIA=scan EXPECT_REFUSAL=swapHeld RESCAN_AFTER=1 RESCAN_WAIT_MS=${RESCAN_WAIT_MS:-180000} \
          perl -e 'alarm 1500; exec @ARGV' node run-vta-link.js > "$LEG_DIR/held-rescan-$i.out" 2>&1; rc=$?
        kill "$lc" 2>/dev/null; wait "$lc" 2>/dev/null
        # The app's own lines: its pids from the log (it is reinstalled each run), plus ReactNativeJS.
        pids=$(grep -oE "Start proc [0-9]+:$BID" "$LEG_DIR/held-rescan-$i.logcat" | grep -oE '[0-9]+' | sort -u | tr '\n' '|' | sed 's/|$//')
        grep -E "ReactNativeJS${pids:+| (${pids}) }" "$LEG_DIR/held-rescan-$i.logcat" > "$LEG_DIR/held-rescan-$i.app.logcat"
        x=$(line "$LEG_DIR/held-rescan-$i.out" "RESCAN ")
        [[ $x == "RESCAN ok"* ]] && ok=$((ok + 1))
        d="$d · run $i: rc=$rc ${x:-no RESCAN line}"
      done
      row swap-held-rescan "$([ $ok -eq "${RESCAN_RUNS:-2}" ] && echo PASS || echo FAIL)" "$ok of ${RESCAN_RUNS:-2} started a link$d"
    fi
    echo "  rule off (again): $(pnm "$RUNNER_MAIN_SLUG" approvals remove "$TASK" | tail -1 | cut -c1-60)"; sleep 3
  fi
  if selected swap-refused-no-try-again; then
    pnm "$RUNNER_MAIN_SLUG" policy list | grep -q "$POL" || echo "  policy: $(pnm "$RUNNER_MAIN_SLUG" policy upsert --id "$POL" --name "$POL" --priority 1000 --module "$LEG_DIR/deny-swap.rego" | tail -1 | cut -c1-80)"
    L env LINK_VIA=scan EXPECT_REFUSAL=swapRefused TRY_AGAIN_EXPECT=no NO_RETRY_CHECK=1 RESCAN_AFTER=1 \
      perl -e 'alarm 1200; exec @ARGV' node run-vta-link.js > "$LEG_DIR/refused-scan.out" 2>&1; rc=$?
    s=$(line "$LEG_DIR/refused-scan.out" "TRYAGAIN "); n=$(line "$LEG_DIR/refused-scan.out" NO-RETRY)
    row swap-refused-no-try-again "$([[ $s == "TRYAGAIN absent"* && $n == "NO-RETRY ok"* ]] && echo PASS || echo FAIL)" "rc=$rc · ${s:-no TRYAGAIN line} · ${n:-no NO-RETRY line}"
    x=$(line "$LEG_DIR/refused-scan.out" RESCAN)
    row swap-refused-rescan "$([[ $x == "RESCAN ok"* ]] && echo PASS || echo FAIL)" "${x:-no RESCAN line} (the refused agent not left listed)"
  fi
else
  row swap-held-try-again SKIP "this build has no VtaLinkTryAgain (bifold #355)"
fi
row swap-no-answer SKIP "covered by bifold's unit tests: the agent must go silent at the exact swap moment"
