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
import { createSession, ensureAppium, stopAppium, screenshot, dumpSource, sleep, scrollToTestId, existsTestId } from "./lib/driver.js";
import { completeOnboarding, openDeveloperScreen } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";
import { execFileSync } from "node:child_process";

const platform = process.env.PLATFORM || "android";

// The harness uninstalls before every run, which is right for a clean e2e and
// wrong for iterating on the probe itself: onboarding costs ~5 minutes a lap.
// E2E_KEEP_STATE=1 reuses the installed, already-onboarded app instead.
const keepState = process.env.E2E_KEEP_STATE === "1";

/** The app's own log is the evidence: every probe stage marks itself. */
function readMarkers(driver) {
  if (driver.e2ePlatform !== "android") return "";
  try {
    return execFileSync("adb", ["-s", process.env.ANDROID_SERIAL || "emulator-5554", "logcat", "-d", "-s", "ReactNativeJS"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
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
  driver = await createSession(
    platform,
    keepState ? { "appium:fullReset": false, "appium:noReset": true } : undefined
  );

  if (await existsTestId(driver, "Contacts", 5000)) {
    console.log(`[e2e] ${driver.e2ePlatform}: already onboarded, reusing state`);
  } else {
    await completeOnboarding(driver, { firstName: "Vti", lastName: "Probe" });
  }
  await screenshot(driver, "agent-connect-onboarded");

  await openDeveloperScreen(driver);
  const probe = await scrollToTestId(driver, "ProbeVtaMediatorButton");
  await probe.click();
  console.log(`[e2e] ${driver.e2ePlatform}: probe tapped`);

  // Login + socket + forward is a handful of round trips through a tunnel.
  await sleep(25000);
  await screenshot(driver, "agent-connect-result");

  const log = readMarkers(driver);
  assertMarker(log, "[VTI-PROBE] resolving mediator");
  assertMarker(log, "[VTI-PROBE] mediator endpoints");
  assertMarker(log, "[VTI-PROBE] socket open, live delivery on");
  assertMarker(log, "[VTI-PROBE] manifest request forwarded to");

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
