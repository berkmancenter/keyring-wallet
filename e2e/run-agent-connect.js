/**
 * Single-device: fresh install → onboarding → Developer screen → "Probe VTA
 * mediator" → the phone logs into the mediator a VTI agent advertises, holds a
 * Pickup 3.0 socket, and asks a community for its join manifest.
 *
 * This is P4's first gate in `community_vetting_subtask.md`: the wire ref-20
 * proved from Node, performed by the app. The stack it talks to is the local
 * VTI stack (three VTAs, a VTC, a mediator, DID hosting), whose DIDs are baked
 * into `app/.env` as VTI_MEDIATOR_DID / VTI_COMMUNITY_DID — the app reads them
 * at build time, so a re-tunnelled stack means a rebuild.
 *
 * Usage: PLATFORM=android node run-agent-connect.js   (or PLATFORM=ios)
 */
import { createSession, ensureAppium, stopAppium, screenshot, dumpSource, sleep, scrollToTestId, existsTestId, waitForTestId } from "./lib/driver.js";
import { androidCaps, iosCaps } from "./lib/config.js";
import { completeOnboarding, openDeveloperScreen, enableDidCommV2, unlockIfLocked } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";
import { execFileSync } from "node:child_process";

const platform = process.env.PLATFORM || "android";

// The harness uninstalls before every run, which is right for a clean e2e and
// wrong for iterating on the probe itself: onboarding costs ~5 minutes a lap.
// E2E_KEEP_STATE=1 reuses the installed, already-onboarded app instead.
const keepState = process.env.E2E_KEEP_STATE === "1";

/** The app's own log is the evidence: every probe stage marks itself. */
function readMarkers(driver) {
  try {
    if (driver.e2ePlatform === "android") {
      return execFileSync("adb", ["-s", process.env.ANDROID_SERIAL || "emulator-5554", "logcat", "-d", "-s", "ReactNativeJS"], {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
    }
    // A simulator has no logcat: console.log lands in the unified log, where
    // the last few minutes can be replayed after the fact rather than streamed
    // alongside the run.
    return execFileSync(
      "xcrun",
      ["simctl", "spawn", "booted", "log", "show", "--style", "compact", "--last", "10m", "--predicate", 'process == "KeyRing"'],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
  } catch {
    return "";
  }
}

function assertMarker(log, marker) {
  if (!log.includes(marker)) throw new Error(`missing marker: ${marker}`);
  console.log(`[e2e] marker ok: ${marker}`);
}

let driver;
try {
  await ensureAppium();
  // createSession replaces the capability set rather than merging, so build the
  // platform's own caps and turn off just the reset flags.
  const caps = platform === "android" ? androidCaps() : iosCaps();
  driver = await createSession(
    platform,
    keepState
      ? {
          ...caps,
          "appium:fullReset": false,
          "appium:noReset": true,
          // iOS reinstalls wipe the container, which is the state being reused.
          "appium:enforceAppInstall": false,
        }
      : undefined
  );

  // A reused install boots into the agent, not into onboarding. Its tab bar only
  // appears once the agent has finished initialising, and a cold start after a
  // force-stop took over two minutes on a machine also running the VTI stack —
  // so E2E_KEEP_STATE waits for the tab bar rather than falling back to an
  // onboarding flow that would only be driving a screen that is never coming.
  if (keepState) {
    console.log(`[e2e] ${driver.e2ePlatform}: reusing state, waiting for the agent to come up`);
    // A cold start of an onboarded install opens on the unlock screen, so the
    // PIN comes before the tab bar can appear at all.
    await waitForTestId(driver, "EnterPIN", 120000).catch(() => undefined);
    await unlockIfLocked(driver);
    await waitForTestId(driver, "Contacts", 300000);
    await sleep(5000);
  } else if (await existsTestId(driver, "Contacts", 5000)) {
    console.log(`[e2e] ${driver.e2ePlatform}: already onboarded, reusing state`);
    await sleep(5000);
  } else {
    await completeOnboarding(driver, { firstName: "Vti", lastName: "Probe" });
  }
  await screenshot(driver, "agent-connect-onboarded");

  // The agent only speaks v2 when the developer flag is on, and the flag is
  // read at agent start — so this toggles and restarts before the probe runs.
  // Idempotent it is not: the helper flips the switch, so pass this once per
  // install (E2E_KEEP_STATE runs afterwards inherit the flag).
  if (process.env.E2E_ENABLE_V2 === "1") {
    await enableDidCommV2(driver);
  }

  await openDeveloperScreen(driver);
  // With VTI_PROBE_ON_START baked in, the screen fires the probe itself as it
  // mounts; the tap is then a no-op against a disabled button, so it is
  // best-effort rather than a gate.
  try {
    const probe = await scrollToTestId(driver, "ProbeVtaMediatorButton");
    await probe.click();
    console.log(`[e2e] ${driver.e2ePlatform}: probe tapped`);
  } catch (err) {
    console.log(`[e2e] ${driver.e2ePlatform}: probe button not tappable (${err.message}) — relying on the auto-run`);
  }

  // Login + socket + forward is a handful of round trips through a tunnel, and
  // the probe then waits up to 30s for the community's answer.
  await sleep(80000);
  await screenshot(driver, "agent-connect-result");

  // The screen is the primary evidence (it works on both platforms); the
  // platform log is the fallback and carries anything logged before the screen
  // started recording.
  let log = "";
  try {
    const probeLog = await scrollToTestId(driver, "VtaProbeLog", 8);
    log = (await probeLog.getAttribute(driver.e2ePlatform === "ios" ? "label" : "text")) || "";
    console.log(`[e2e] ${driver.e2ePlatform}: on-screen probe log:\n${log}`);
  } catch {
    console.log(`[e2e] ${driver.e2ePlatform}: no on-screen probe log — falling back to the platform log`);
  }
  log += `\n${readMarkers(driver)}`;
  assertMarker(log, "[VTI-PROBE] resolving mediator");
  assertMarker(log, "[VTI-PROBE] mediator endpoints");
  assertMarker(log, "[VTI-PROBE] socket open, live delivery on");
  assertMarker(log, "[VTI-PROBE] manifest request forwarded to");
  assertMarker(log, "[VTI-PROBE] manifest received");
  assertMarker(log, "[VTI-PROBE] join request submitted");
  assertMarker(log, "[VTI-PROBE] verdict");

  printSuccess("agent-connect");
  process.exitCode = 0;
} catch (err) {
  printFailure("agent-connect", err);
  if (driver) {
    try {
      await screenshot(driver, "agent-connect-failure");
      await dumpSource(driver, "agent-connect-failure");
    } catch {
      /* ignore */
    }
  }
  process.exitCode = 1;
} finally {
  if (driver) {
    try {
      await driver.deleteSession();
    } catch {
      /* ignore */
    }
  }
  stopAppium();
}
