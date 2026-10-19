#!/bin/bash
# Hidden vetting (PCS), the applicant side. A fresh Keyring (Android emulator), linked to the main runner with the
# gate's own admin grant (so its identity derives pcs-applicant), applies to the hv community (HV_C_*, keyring-hv-lab1:
# a community the gate administers, never keyring-test, whose criteria other rows depend on) by its hidden-vetting
# criterion: the "Private vetting" badge, the vetting screen, and its own agent creating the PCS application
# (e2e/openvtc/run-hv.mjs). The vetter is a second Keyring by default (VETTER=keyring: Keyring↔Keyring is the product
# path), or the openvtc TUI seated there by choice (VETTER=tui, HV_TUI_*), which goes red at hv-attestation-received
# until openvtc sends the published vetting/attestation/0.1 shape (its storage shape has no suite and a flat token).
# Without HV_C_* configured, every row is SKIP and nothing starts.
. "$(dirname "$0")/../lib.sh"; gate_env
HV_ROWS="hv-private-badge hv-vetting-private-shown hv-application-created hv-ticket hv-card hv-attestation-received hv-proof hv-admitted hv-member-card hv-vetter-anonymous"
APK=$APK_OFF
leg_begin hv "$(shasum -a 256 "$APK" | cut -c1-12)" "$APK"
# The openvtc TUI as vetter is informational: its attestation is not the published vetting/attestation/0.1 shape, so
# hv-attestation-received fails on openvtc's side (run-summary.mjs: reported apart, proves no core journey).
# Only the rows downstream of the attestation, and hv-driver (run-hv exits non-zero on any FAIL row): a crash before
# the attestation still fails the applicant's own rows as "not reached", which stay verdicts.
[ "${VETTER:-}" = tui ] && echo "INFORMATIONAL rows=hv-attestation-received,hv-proof,hv-admitted,hv-member-card,hv-vetter-anonymous,hv-driver VETTER=tui: openvtc's attestation is not the published shape"
if [ -z "${HV_C_DID:-}" ] || [ -z "${HV_C_REST:-}" ] || [ -z "${HV_C_ADMIN_CRED:-}" ]; then
  for r in $HV_ROWS; do row "$r" SKIP "no hv community configured (HV_C_DID, HV_C_REST, HV_C_ADMIN_CRED)"; done
  exit 0  # leg_begin's EXIT trap ends the leg (leg_end)
fi
# Settled from the environment alone, before any emulator, Appium or runner grant (review on #517): an unconfigured
# machine skips at once. The reason says a core journey did not run, so an all-SKIP hv leg is not read as green.
VETTER=${VETTER:-keyring}
if [ "$VETTER" = keyring ] && { [ -z "${HV_VETTER_UDID:-}" ] || [ -z "${HV_VETTER_DID:-}" ]; }; then
  for r in $HV_ROWS; do row "$r" SKIP "NOT RUN (core journey: Keyring↔Keyring vetting): no seated Keyring vetter configured (HV_VETTER_UDID, HV_VETTER_DID; seat one with e2e/openvtc/seat-hv-keyring-vetter.mjs), or VETTER=tui for the openvtc vetter"; done
  exit 0
fi
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN
T0=$(stamp); E=emulator-5570; AP=
fin() {
  adb -s $E shell locksettings clear --old 1234 >/dev/null 2>&1; adb -s $E uninstall $BID >/dev/null 2>&1
  [ -n "$AP" ] && kill "$AP" 2>/dev/null; emu_stop
  echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"; gate_sweep_runner "$RUNNER_MAIN_SLUG"
  # The PCS application the phone's agent made lives on the runner with the phone's grant, and goes with it; the
  # community admits no one in the applicant-only rows, so it has no member to remove yet.
}
LEG_CLEANUP=fin
export RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN ENROL_PORT=8197 E2E_RELEASE=1
export PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD APPIUM_PORT=4761 OPENVTC_TUI_STYLE=current
emu_start 5570; adb -s $E uninstall $BID >/dev/null 2>&1
# The rows read the app's log back with logcat -d: a buffer that wraps loses the ceremony (the iOS log did, on 261).
adb -s $E logcat -G 16M >/dev/null 2>&1
curl -s -m 2 http://127.0.0.1:4761/status >/dev/null || { nohup appium --port 4761 --relaxed-security > "$LEG_DIR/appium.log" 2>&1 & AP=$!; for i in $(seq 1 30); do curl -s -m 2 http://127.0.0.1:4761/status >/dev/null && break; sleep 1; done; }
cd "$E2E"
t=$(date +%s)
E2E_KEEP_APP=1 LINK_MODE=manual galarm 1800 node run-vta-link.js > "$LEG_DIR/link.out" 2>&1 \
  || broken "applicant link: $(grep -E '✅|❌' "$LEG_DIR/link.out" | tail -1 | cut -c1-120)"
row hv-link PASS "$(( $(date +%s) - t ))s, admin grant on $RUNNER_MAIN_SLUG"
# VETTER=keyring: the vetter is a seated Keyring, the iOS simulator HV_VETTER_UDID (named HV_VETTER_NAME), a member of
# the hv community with a vetter grant and enrolled (e2e/openvtc/seat-hv-keyring-vetter.mjs), DID HV_VETTER_DID.
VK=()
if [ "$VETTER" = keyring ]; then
  sim_boot "$HV_VETTER_UDID"
  VK=(--vetter-platform ios --vetter-udid "$HV_VETTER_UDID" --vetter-device-name "${HV_VETTER_NAME:-iPhone 17 HV Vetter}" --vetter-wda-port 8132 --vetter-mjpeg-port 9132 --vetter-did "$HV_VETTER_DID")
fi
(cd "$REPO" && galarm 1500 node e2e/openvtc/run-hv.mjs --udid $E "${VK[@]}" --log-dir "$LEG_DIR" --community-did "$HV_C_DID" --criterion "${HV_CRITERION:-hv-vetted}" \
  --vtc-base "$HV_C_REST" --admin-credential "$HV_C_ADMIN_CRED" --vetter "$VETTER" \
  ${HV_TUI_FX:+--fixture-dir "$HV_TUI_FX"} ${HV_TUI_PROFILE:+--profile "$HV_TUI_PROFILE"} ${HV_TUI_PERSONA:+--tui-persona "$HV_TUI_PERSONA"} \
  --openvtc-bin "${OPENVTC_BIN:-}" --openvtc-version "${OPENVTC_VERSION:-}") > "$LEG_DIR/hv.out" 2>&1; rc=$?
take_rows "$LEG_DIR/hv.out"
# A driver that stopped early printed fewer rows, and those may all pass: its exit code says so.
[ $rc -eq 0 ] || row hv-driver FAIL "rc=$rc $(grep -E '❌' "$LEG_DIR/hv.out" | tail -1 | cut -c1-160)"
