#!/bin/bash
# P2: Keyring as the VETTER, the openvtc TUI as the APPLICANT (the mirror of p1; e2e/openvtc/run-phase2.mjs).
# A Keyring phone already seated as a vetter of C (linked, granted by C's admin, once, by hand, like kk's vetter
# simulator) gets the candidate installed over its data. The TUI's applicant fixture mints a persona, applies to C,
# pastes Keyring's ticket, reads the match code, sends its card, takes Keyring's statement and joins C with it.
# Rows (the driver's own, lib/rows.js): p2-tui-applicant-ready, p2-vetter-seated, p2-ticket-issued,
# p2-request-received, p2-session-opened, p2-card-received, p2-statement-signed, and the verdict p2-keyring-vets
# (C's own member list holds the TUI persona's DID).
# Needs a seated Keyring vetter and a TUI applicant fixture, neither of which the other legs have: without them every
# row SKIPs with what is missing (P2_BLOCKED="<why>" does the same on purpose). The seated device is never wiped.
# P2_VETTER_PLATFORM=ios (default): a simulator, P2_VETTER_SIM_UDID. It may be kk's own vetter simulator
# (VETTER_SIM_UDID): then p2 runs in the iOS group after kk, never beside it. android: a dedicated AVD,
# P2_VETTER_AVD, booted cold (emu.sh: -no-snapshot) so the seat survives; never the shared $AVD, which legs wipe.
. "$(dirname "$0")/../lib.sh"; gate_env
need PNM_BIN C_DID C_NAME C_REST C_ADMIN_CRED
PLAT=${P2_VETTER_PLATFORM:-ios}
case $PLAT in
  ios) BUILD=${CAND_APP:-}; BSHA=$( [ -f "$BUILD/main.jsbundle" ] && shasum -a 256 "$BUILD/main.jsbundle" | cut -c1-12) ;;
  android) BUILD=${APK_OFF:-}; BSHA=$( [ -f "$BUILD" ] && shasum -a 256 "$BUILD" | cut -c1-12) ;;
  *) BUILD=; BSHA= ;;
esac
leg_begin p2 "$BSHA" "$BUILD"
P2_ROWS="p2-tui-applicant-ready p2-vetter-seated p2-ticket-issued p2-request-received p2-session-opened p2-card-received p2-statement-signed p2-keyring-vets"

# What p2 needs that no other leg provides. Missing anything: every row SKIPs with the reason, nothing boots.
why=; miss=
if [ -n "${P2_BLOCKED:-}" ]; then why="blocked: $P2_BLOCKED"
elif [ "$PLAT" = android ]; then
  # On Android p2 would boot a second emulator while linkwait runs beside the iOS-alone legs: emu.sh refuses, and a
  # broken p2 must not stop linkwait's. Not supported until p2 gets a slot of its own.
  why="P2_VETTER_PLATFORM=android is not supported yet: it would need a second emulator beside linkwait's"
elif [ -z "${OPENVTC_BIN:-}" ] || [ -z "${OPENVTC_VERSION:-}" ]; then why="no openvtc TUI configured (OPENVTC_BIN / OPENVTC_VERSION)"
elif [ -n "${TUI_APPLICANT_PERSONA_DID:-}" ] && [ -z "${TUI_APPLICANT_PERSONA_LABEL:-}" ]; then
  why="TUI_APPLICANT_PERSONA_DID is set without TUI_APPLICANT_PERSONA_LABEL: a reused persona needs both"
else
  case $PLAT in
    ios) vars="P2_VETTER_SIM_UDID P2_VETTER_SIM_NAME" ;;
    android) vars="P2_VETTER_AVD" ;;
    *) why="P2_VETTER_PLATFORM=$PLAT is not ios or android"; vars= ;;
  esac
  for v in $vars P2_VETTER_DID TUI_APPLICANT_FX TUI_APPLICANT_PROFILE TUI_APPLICANT_SLUG; do [ -n "${!v:-}" ] || miss="$miss $v"; done
  [ -n "$why" ] || [ -z "$miss" ] || why="no seated Keyring vetter / TUI applicant fixture in $GATE_ENV:$miss is empty (prerequisites: e2e/gate/env.example, P2)"
  if [ -z "$why" ] && { [ ! -f "$TUI_APPLICANT_FX/config-$TUI_APPLICANT_PROFILE.json" ] || [ ! -f "$TUI_APPLICANT_FX/unlock-code" ]; }; then
    why="no TUI applicant fixture at TUI_APPLICANT_FX (config-$TUI_APPLICANT_PROFILE.json and unlock-code; e2e/openvtc/setup-fixture.mjs)"
  fi
  if [ -z "$why" ] && [ -n "${TUI_PROFILE:-}" ] && [ "${TUI_FX:-}" = "$TUI_APPLICANT_FX" ]; then
    why="TUI_APPLICANT_FX is p1's TUI_FX: the applicant needs a fixture folder of its own (setup-fixture.mjs writes the folder's unlock-code)"
  fi
  if [ -z "$why" ] && [ -z "$BSHA" ]; then why="no $PLAT build for the vetter (CAND_APP / APK_OFF)"; fi
fi
if [ -n "$why" ]; then
  for r in $P2_ROWS; do row "$r" SKIP "$why"; done
  exit 0
fi

T0=$(stamp); AP=
if [ "$PLAT" = ios ]; then U=$P2_VETTER_SIM_UDID; PORT=4773; else U=emulator-5574; PORT=4764; fi
wda_stop() { local p; for p in $(ps -axo pid,command | grep -E "xcodebuild.*WebDriverAgent" | grep "$1" | grep -v grep | awk '{print $1}'); do kill "$p"; done; }
fin() {
  # The seated vetter keeps its app and data: never uninstall, never clear its lock.
  if [ "$PLAT" = ios ]; then wda_stop "$U"; sim_down "$U"; else emu_stop; fi
  [ -n "$AP" ] && kill "$AP" 2>/dev/null
  echo "== cleanup $(utc)"
  # The TUI applicant's persona: its membership of C, and any join request of its still pending, so a reused persona
  # can apply again and C's lists stay the gate's own. A persona minted for the run stays on the TUI's runner (see
  # env.example, TUI_APPLICANT_PERSONA_DID, to reuse one instead).
  local m r
  for m in $(grep -oE '^P2_PERSONA did:[^ ]+' "$LEG_DIR/p2.out" 2>/dev/null | awk '{print $2}' | sort -u); do
    echo "  C member …${m: -24}: $(c_admin member-remove "$m" "gate: p2 TUI applicant, removed after the leg" | grep -oE -- '-> [0-9]+' | tail -1)"
    for r in $(c_admin join-list pending | P2M="$m" python3 -c "
import os,sys,json; t=sys.stdin.read(); d=json.loads(t[t.index('{'):]) if '{' in t else {}
for x in d.get('items') or []:
    if x.get('applicantDid')==os.environ['P2M']: print(x.get('id'))"); do
      echo "  decline $r: $(JOIN_DECIDE_REASON='gate: p2 TUI applicant request left pending, declined after the leg' c_admin join-decide "$r" rejected | grep -oE -- '-> [0-9]+' | tail -1)"
    done
    grep -q "^P2_PERSONA_REUSED" "$LEG_DIR/p2.out" 2>/dev/null || echo "  TUI persona …${m: -24} left on $TUI_APPLICANT_SLUG (minted for this run)"
  done
  # Runners: the TUI applicant's, and the one the seated vetter is linked to when named. Only what the gate makes:
  # phone keys since the leg began (a seated grant is older) and the gate's own approval rules.
  keys_since "$TUI_APPLICANT_SLUG" "$T0"; gate_sweep_runner "$TUI_APPLICANT_SLUG"
  if [ -n "${P2_VETTER_RUNNER_SLUG:-}" ] && [ "$P2_VETTER_RUNNER_SLUG" != "$TUI_APPLICANT_SLUG" ]; then
    keys_since "$P2_VETTER_RUNNER_SLUG" "$T0"; gate_sweep_runner "$P2_VETTER_RUNNER_SLUG"
  fi
}
LEG_CLEANUP=fin

# The seated vetter: the build under test goes over its data (simctl install and adb install -r keep the app's data).
if [ "$PLAT" = ios ]; then
  sim_boot "$U"
  xcrun simctl install "$U" "$BUILD" || broken "could not install the build on the seated vetter simulator"
  export IOS_DEVICE_NAME=$P2_VETTER_SIM_NAME
else
  AVD=$P2_VETTER_AVD emu_start 5574
  adb -s $U install -r "$BUILD" >/dev/null || broken "could not install the build over the seated vetter (adb install -r; a build signed with another key cannot replace it)"
  export ANDROID_UDID=$U ANDROID_SERIAL=$U
fi
export PLATFORM=$PLAT APPIUM_PORT=$PORT E2E_RELEASE=1 OPENVTC_TUI_STYLE=current
curl -s -m 2 http://127.0.0.1:$PORT/status >/dev/null || { nohup appium --port $PORT --relaxed-security > "$LEG_DIR/appium.log" 2>&1 & AP=$!; for i in $(seq 1 30); do curl -s -m 2 http://127.0.0.1:$PORT/status >/dev/null && break; sleep 1; done; }

# The TUI applicant: a persona minted per run, or one reused by label and DID.
persona=()
if [ -n "${TUI_APPLICANT_PERSONA_DID:-}" ]; then
  persona=(--persona-label "${TUI_APPLICANT_PERSONA_LABEL:?TUI_APPLICANT_PERSONA_LABEL goes with TUI_APPLICANT_PERSONA_DID}" --persona-did "$TUI_APPLICANT_PERSONA_DID")
  echo "P2_PERSONA_REUSED" > "$LEG_DIR/p2.out"
fi
t=$(date +%s)
(cd "$REPO" && perl -e 'alarm 2400; exec @ARGV' node e2e/openvtc/run-phase2.mjs --platform "$PLAT" --label "P2-gate-${CAND_WALLET:0:8}" \
  --no-install --apk "$BUILD" --udid "$U" --wda-port 8107 --mjpeg-port 9107 --vetter-did "$P2_VETTER_DID" \
  --openvtc-bin "$OPENVTC_BIN" --openvtc-version "$OPENVTC_VERSION" --fixture-dir "$TUI_APPLICANT_FX" --profile "$TUI_APPLICANT_PROFILE" \
  --community-did "$C_DID" --community-name "$C_NAME" --vtc-base "$C_REST" --admin-credential "$C_ADMIN_CRED" ${persona[@]+"${persona[@]}"}) >> "$LEG_DIR/p2.out" 2>&1; rc=$?
grep -E '^\[step\]|^\[phase2 ' "$LEG_DIR/p2.out" | grep -v webdriver | tail -12 | cut -c1-200
echo "p2 driver: rc=$rc in $(( $(date +%s) - t ))s"
take_rows "$LEG_DIR/p2.out"
driver_rc p2-driver "$rc" "$LEG_DIR/p2.out"
