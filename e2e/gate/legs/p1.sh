#!/bin/bash
# P1 + approvals. The openvtc TUI, seated as a vetter of C, vets a fresh Keyring applicant (Android emulator,
# push-on build, linked to the main runner): the TUI writes the statement and Keyring must take it. Then the same
# phone approves a request held for its consent: #317 owner check (Approve asks; a cancelled check leaves it
# waiting; Decline does not ask), #321 card words, and pushCapable kept through Approve.
# The approvals driver runs from this tree (never another checkout): the 236 gate lost three runs to that.
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN C_DID C_NAME C_REST C_ADMIN_CRED OPENVTC_BIN OPENVTC_VERSION TUI_FX TUI_PROFILE TUI_PERSONA
APK=${APK_ON:-}; [ -f "$APK" ] || APK=$APK_OFF
leg_begin p1 "$(shasum -a 256 "$APK" | cut -c1-12)" "$APK"
T0=$(stamp); E=emulator-5570; AP=
fin() {
  adb -s $E shell locksettings clear --old 1234 >/dev/null 2>&1; adb -s $E uninstall $BID >/dev/null 2>&1
  [ -n "$AP" ] && kill "$AP" 2>/dev/null; emu_stop
  echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"; rules_clear "$RUNNER_MAIN_SLUG"
}
LEG_CLEANUP=fin
export RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN ENROL_PORT=8196 E2E_RELEASE=1
export PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD APPIUM_PORT=4760 OPENVTC_TUI_STYLE=current
emu_start 5570; adb -s $E uninstall $BID >/dev/null 2>&1
curl -s -m 2 http://127.0.0.1:4760/status >/dev/null || { nohup appium --port 4760 --relaxed-security > "$LEG_DIR/appium.log" 2>&1 & AP=$!; for i in $(seq 1 30); do curl -s -m 2 http://127.0.0.1:4760/status >/dev/null && break; sleep 1; done; }
cd "$E2E"
t=$(date +%s)
E2E_KEEP_APP=1 LINK_MODE=manual perl -e 'alarm 1800; exec @ARGV' node run-vta-link.js > "$LEG_DIR/link.out" 2>&1 \
  || broken "applicant link: $(grep -E '✅|❌' "$LEG_DIR/link.out" | tail -1 | cut -c1-120)"
row p1-link PASS "$(( $(date +%s) - t ))s"

# Seat the TUI persona as C's vetter: a vetter grant from C's admin, delivered while the TUI listens. A Farm
# upgrade can leave the TUI with no grant (10-06, 0.55.0: "No community has named you a vetter yet").
# P1_BLOCKED="<why>": the TUI rows are reported as blocked (SKIP with the reason), not run; approvals still run.
if [ -n "${P1_BLOCKED:-}" ]; then
  row p1-tui-seated SKIP "blocked: $P1_BLOCKED"; row p1-tui-vets SKIP "blocked: $P1_BLOCKED"
elif selected p1-tui-seated || selected p1-tui-vets; then
  (cd "$REPO" && perl -e 'alarm 600; exec @ARGV' node e2e/openvtc/regrant-tui.mjs "$OPENVTC_BIN" "$OPENVTC_VERSION" "$TUI_FX" "$TUI_PROFILE" "$TUI_PERSONA" \
    "$C_REST" "$C_DID" "$C_ADMIN_CRED" vetter-grant) > "$LEG_DIR/tui-seat.out" 2>&1; rc=$?
  seat=$(grep -E 'SEATED|NOT SEATED|vetter-grant:' "$LEG_DIR/tui-seat.out" | tail -1 | cut -c1-160)
  if [ $rc -eq 0 ] && echo "$seat" | grep -q '^.*SEATED' && ! echo "$seat" | grep -q 'NOT SEATED'; then row p1-tui-seated PASS "$seat"
  else row p1-tui-seated FAIL "rc=$rc $seat"; fi
fi

if [ -z "${P1_BLOCKED:-}" ] && selected p1-tui-vets; then
  t=$(date +%s)
  (cd "$REPO" && perl -e 'alarm 1800; exec @ARGV' node e2e/openvtc/run-phase1.mjs --platform android --label "P1-gate-${CAND_WALLET:0:8}" --expect green \
    --no-install --apk "$APK" --udid $E --openvtc-bin "$OPENVTC_BIN" --openvtc-version "$OPENVTC_VERSION" --fixture-dir "$TUI_FX" --profile "$TUI_PROFILE" \
    --tui-persona "$TUI_PERSONA" --community-did "$C_DID" --community-name "$C_NAME" --vtc-base "$C_REST" --admin-credential "$C_ADMIN_CRED") > "$LEG_DIR/p1.out" 2>&1; rc=$?
  grep -E '✅|❌|\[step\]' "$LEG_DIR/p1.out" | grep -v webdriver | tail -8 | cut -c1-200
  if [ $rc -eq 0 ]; then row p1-tui-vets PASS "$(( $(date +%s) - t ))s"; else row p1-tui-vets FAIL "rc=$rc $(grep -E '❌' "$LEG_DIR/p1.out" | tail -1 | cut -c1-140)"; fi
elif [ -z "${P1_BLOCKED:-}" ]; then row p1-tui-vets SKIP "not selected"; fi

# Approvals on the same linked phone (run-vta-approvals.js reads artifacts/last-link.json from the link).
t=$(date +%s)
DEVICE_PIN=1234 OWNER_ROWS=1 CARD_ROWS=1 perl -e 'alarm 1200; exec @ARGV' node run-vta-approvals.js > "$LEG_DIR/approvals.out" 2>&1; rc=$?
grep -E '^\[e2e\] [0-9]|^PUSH-CAPABLE|^RATE-LIMITED' "$LEG_DIR/approvals.out" | cut -c1-200
take_rows "$LEG_DIR/approvals.out"
if [ $rc -eq 0 ]; then row approvals PASS "held for consent, approved on the phone, then let through ($(( $(date +%s) - t ))s)"
else row approvals FAIL "rc=$rc $(grep -E '❌|Error' "$LEG_DIR/approvals.out" | grep -v webdriver | head -2 | tail -1 | cut -c1-140)"; fi
