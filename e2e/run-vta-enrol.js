/**
 * Single-device: the phone becomes the manager of ITS OWN VTA (§2.4 B).
 *
 *   Developer screen → "show manager identity" → the phone mints a DID and
 *   prints it → this runner enrols that DID on the local `alice` VTA (the
 *   stand-in for a farm's enrolment QR) → "connect and mint a persona" → the
 *   phone signs in as the manager, asks who it is, mints a persona on the VTA,
 *   and borrows the persona's key-agreement key into its own KMS.
 *
 * The VTA is baked in as VTI_VTA_DID in `app/.env`; the enrolment stand-in is
 * `scripts/openvtc/local-vti-stack/enrol-manager.sh`, which stops the VTA,
 * writes the ACL entry, and starts it again.
 *
 * Usage: PLATFORM=android node run-vta-enrol.js   (or PLATFORM=ios)
 */
import { createSession, ensureAppium, stopAppium, screenshot, dumpSource, sleep, scrollToTestId, waitForTestId, byTestId } from "./lib/driver.js";
import { androidCaps, iosCaps } from "./lib/config.js";
import { completeOnboarding, openDeveloperScreen, enableDidCommV2, unlockIfLocked } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const platform = process.env.PLATFORM || "android";
const keepState = process.env.E2E_KEEP_STATE === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const ENROL = path.resolve(here, "../scripts/openvtc/local-vti-stack/enrol-manager.sh");
// alice is reserved for the TestFlight phone (2026-09-22); runners enrol on bob.
const VTA_NAME = process.env.VTA_NAME || process.env.RUNNER_VTA || "bob";
if (VTA_NAME === "alice") throw new Error("alice is reserved for the TestFlight phone — use a runner VTA");
const ROLE = process.env.VTA_ROLE || "admin";

const textOf = async (driver, key) =>
  (await byTestId(driver, key).getAttribute(driver.e2ePlatform === "ios" ? "label" : "text")) || "";

function assertMarker(log, marker) {
  if (!log.includes(marker)) throw new Error(`missing marker: ${marker}`);
  console.log(`[e2e] marker ok: ${marker}`);
}

let driver;
try {
  await ensureAppium();
  const caps = platform === "android" ? androidCaps() : iosCaps();
  driver = await createSession(
    platform,
    keepState
      ? { ...caps, "appium:fullReset": false, "appium:noReset": true, "appium:enforceAppInstall": false }
      // E2E_PERSIST=1: a fresh install and onboarding that survives the session
      // (fullReset uninstalls on session end), so later E2E_KEEP_STATE runs can use it.
      : process.env.E2E_PERSIST === "1"
      ? { ...caps, "appium:fullReset": false, "appium:noReset": false }
      : undefined
  );

  if (keepState) {
    await waitForTestId(driver, "EnterPIN", 120000).catch(() => undefined);
    await unlockIfLocked(driver);
    await waitForTestId(driver, "Contacts", 300000);
    await sleep(5000);
  } else {
    await completeOnboarding(driver, { firstName: "Vta", lastName: "Manager" });
  }
  if (process.env.E2E_ENABLE_V2 === "1") await enableDidCommV2(driver);

  await openDeveloperScreen(driver);

  // The community probe auto-runs when this screen mounts (VTI_PROBE_ON_START)
  // and ends in an alert that sits over everything below it. Let it finish,
  // then clear the alert, or the manager buttons are unreachable.
  for (let i = 0; i < 45; i++) {
    const community = await textOf(driver, "VtaProbeLog").catch(() => "");
    if (/verdict|no verdict|manifest only|\[VTI-PROBE\] failed|no manifest/.test(community)) break;
    await sleep(2000);
  }
  for (let i = 0; i < 3; i++) {
    const cleared = await driver.acceptAlert().then(() => true, () => false);
    if (!cleared) break;
    await sleep(500);
  }

  // Half 1 — the identity. An alert can still pop mid-scroll; clear and retry.
  let show;
  for (let i = 0; i < 3 && !show; i++) {
    await driver.acceptAlert().catch(() => undefined);
    show = await scrollToTestId(driver, "ShowManagerIdentityButton", 8).catch(() => undefined);
  }
  if (!show) throw new Error("ShowManagerIdentityButton never became reachable");
  await show.click();
  await waitForTestId(driver, "VtaManagerProbeLog", 60000);
  let log = "";
  for (let i = 0; i < 20 && !log.includes("MANAGER_DID="); i++) {
    await sleep(1500);
    log = await textOf(driver, "VtaManagerProbeLog");
  }
  const match = /MANAGER_DID=(did:[^\s]+)/.exec(log);
  if (!match) throw new Error(`no manager DID on screen:\n${log}`);
  const managerDid = match[1];
  console.log(`[e2e] ${driver.e2ePlatform}: manager identity ${managerDid.slice(0, 40)}…`);
  await screenshot(driver, "vta-enrol-identity");

  // Enrolment — the stand-in for the farm's QR.
  const enrolled = execFileSync("bash", [ENROL, managerDid, VTA_NAME, ROLE], { encoding: "utf8" });
  console.log(`[e2e] ${enrolled.trim()}`);

  // Half 2 — connect as the manager, mint a persona, borrow its key.
  const probe = await scrollToTestId(driver, "ProbeVtaManagerButton", 8);
  await probe.click();
  console.log(`[e2e] ${driver.e2ePlatform}: connecting as manager`);
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    // The final step raises a success alert that covers the log; clear it, and
    // tolerate a read that lands while it is up.
    await driver.acceptAlert().catch(() => undefined);
    log = (await textOf(driver, "VtaManagerProbeLog").catch(() => log)) || log;
    if (log.includes("manifest as persona") || log.includes("[VTA-PROBE] failed")) break;
  }
  await driver.acceptAlert().catch(() => undefined);
  await screenshot(driver, "vta-enrol-result");
  console.log(`[e2e] ${driver.e2ePlatform}: on-screen log:\n${log}`);

  assertMarker(log, "[VTA-PROBE] connected as");
  assertMarker(log, "[VTA-PROBE] whoami");
  assertMarker(log, "[VTA-PROBE] contexts");
  assertMarker(log, "[VTA-PROBE] persona minted");
  assertMarker(log, "[VTA-PROBE] key borrowed");
  assertMarker(log, "[VTA-PROBE] community session as persona");
  assertMarker(log, "[VTA-PROBE] manifest as persona");

  printSuccess("vta-enrol");
  process.exitCode = 0;
} catch (err) {
  printFailure("vta-enrol", err);
  if (driver) {
    try {
      await screenshot(driver, "vta-enrol-failure");
      await dumpSource(driver, "vta-enrol-failure");
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
