/**
 * The tester's journey, in the tester's configuration — the pre-PR gate.
 *
 * TestFlight 206 shipped two bugs its testers found in minutes and no run of
 * ours could have: every run baked VTI_VTA_DID (TestFlight does not) and none
 * came back to My Agent after linking. This runner does what a tester does, on
 * a Release build with the TestFlight environment:
 *
 *   A1  fresh install → onboard → link the agent by QR (run-vta-link.js)
 *   A2  every agent-home entry opens, and none says "No agent is configured"
 *   A3  leave My Agent and come back: the home, not the link flow ("Linked ✓")
 *   A4  switch tabs, then relaunch the app: still linked, still the home
 *
 * Phase B (invite and vetting as a linked agent) and the vetter-grant
 * lifecycle follow once the invited-flow screens land.
 *
 * It runs on its own simulator so the debug suite's state is left alone:
 *
 *   IOS_DEVICE_NAME="iPhone 17 Release repro" node run-tester-journey.js
 *   IOS_APP=<prebuilt .app> …   # skip the build (scripts/build-testflight-sim.sh)
 *
 * Needs the lab stack up; starts its own enrolment page on ENROL_PORT (8192; 8190 is alice's for the TestFlight phone, 8191 the UI/UX session's bob page).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createSession, ensureAppium, screenshot, dumpSource, sleep, waitForTestId, existsTestId, tapTestIdByCoordinates, scrollToTestId, byTestId } from "./lib/driver.js";
import { iosCaps } from "./lib/config.js";
import { unlockIfLocked, dismissTourIfPresent } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEVICE = process.env.IOS_DEVICE_NAME || "iPhone 17 Release repro";
const WDA = process.env.WDA_LOCAL_PORT || "8102";
const ENROL_PORT = process.env.ENROL_PORT || "8192";
const APP_ID = "asml.bkc.harvard.wallet";
// The runner VTA. alice is Alberto's TestFlight agent since 2026-09-22 and no
// runner links to, mints on or grants on it.
const RUNNER_VTA = process.env.RUNNER_VTA || "bob";
if (RUNNER_VTA === "alice") throw new Error("alice is reserved for the TestFlight phone — use a runner VTA");
const stackEnv = (key) =>
  execFileSync("bash", ["-c", `. "$HOME/vti-stack/stack.env"; printf %s "$${key}"`], { encoding: "utf8" });
const RUNNER_VTA_DID = stackEnv(`${RUNNER_VTA.toUpperCase()}_VTA_DID`);
if (!RUNNER_VTA_DID.startsWith("did:")) throw new Error(`${RUNNER_VTA.toUpperCase()}_VTA_DID not in ~/vti-stack/stack.env`);

// Screens whose appearance on a linked phone is a bug in itself.
const FORBIDDEN = [/No agent is configured/i];
const log = (m) => console.log(`[journey] ${m}`);

async function assertClean(d, where) {
  const src = await d.getPageSource();
  for (const re of FORBIDDEN) if (re.test(src)) throw new Error(`${where}: the screen says ${re}`);
}
async function toMyAgent(d) {
  await dismissTourIfPresent(d).catch(() => undefined);
  await tapTestIdByCoordinates(d, "MyAgent", 30000);
  await sleep(2500);
}
async function assertHome(d, where) {
  if (!(await existsTestId(d, "AgentHome", 20000))) throw new Error(`${where}: My Agent is not the agent home`);
  for (const id of ["VtaLinkDone", "VtaLinkState", "LinkYourAgentButton"]) {
    if (await existsTestId(d, id, 1500)) throw new Error(`${where}: the link flow shows again (${id}) on a linked phone`);
  }
  await assertClean(d, where);
}
async function back(d) {
  await d.back().catch(() => undefined);
  await sleep(1500);
}

let d;
try {
  // A1 — build (unless given one), then link by QR on a fresh install.
  const app =
    process.env.IOS_APP ||
    execFileSync("bash", [path.join(here, "scripts/build-testflight-sim.sh")], { encoding: "utf8" }).trim().split("\n").pop();
  log(`app ${app}`);
  execFileSync("node", [path.join(here, "run-vta-link.js")], {
    stdio: "inherit",
    env: {
      ...process.env,
      PLATFORM: "ios",
      IOS_APP: app,
      IOS_DEVICE_NAME: DEVICE,
      WDA_LOCAL_PORT: WDA,
      ENROL_PORT,
      E2E_KEEP_APP: "1",
      // The page and the link runner both grant on the runner VTA.
      RUNNER_VTA,
      ENROL_VTA_DID: RUNNER_VTA_DID,
      ENROL_LABEL: `Keyring lab runner (${RUNNER_VTA})`,
      VTA_SLUG: RUNNER_VTA,
      PNM_HOME: path.join(process.env.HOME, "vti-stack", `pnm-${RUNNER_VTA}`),
    },
  });
  log("A1 linked by QR on a fresh Release install");

  await ensureAppium();
  d = await createSession("ios", {
    ...iosCaps(),
    "appium:deviceName": DEVICE,
    "appium:app": app,
    "appium:wdaLocalPort": Number(WDA),
    "appium:fullReset": false,
    "appium:noReset": true,
    "appium:enforceAppInstall": false,
  });
  await waitForTestId(d, "EnterPIN", 60000).catch(() => undefined);
  await unlockIfLocked(d);
  await waitForTestId(d, "Contacts", 120000);

  // A2 — every entry on the agent home.
  await toMyAgent(d);
  await assertHome(d, "A2 home");
  for (const entry of ["AgentGetVetted", "AgentJoinCommunity", "AgentVetOthers", "AgentVetOthersLocked", "WhatIsMyAgent"]) {
    const el = await scrollToTestId(d, entry, 4).catch(() => undefined);
    if (!el || !(await el.isExisting().catch(() => false))) continue;
    await el.click();
    await sleep(3000);
    await assertClean(d, `A2 ${entry}`);
    await screenshot(d, `journey-${entry}`);
    log(`A2 ${entry} opens cleanly`);
    await back(d);
    await toMyAgent(d);
  }
  if (await existsTestId(d, "AgentDetailsToggle", 3000)) {
    await tapTestIdByCoordinates(d, "AgentDetailsToggle");
    await sleep(1500);
    if (!(await existsTestId(d, "AgentDetails", 5000))) throw new Error("A2 AgentDetailsToggle: details did not open");
    log("A2 details open");
  }

  // A3 — away and back: the home, not "Linked ✓" again.
  await tapTestIdByCoordinates(d, "Contacts", 30000);
  await sleep(1500);
  await toMyAgent(d);
  await assertHome(d, "A3 return");
  log("A3 returning to My Agent shows the home");

  // A4 — tabs, then a relaunch.
  for (const tab of ["Wallet", "Contacts", "MyAgent"]) {
    await tapTestIdByCoordinates(d, tab, 30000).catch(() => undefined);
    await sleep(1200);
  }
  await assertHome(d, "A4 tabs");
  await d.terminateApp(APP_ID);
  await sleep(2000);
  await d.activateApp(APP_ID);
  await waitForTestId(d, "EnterPIN", 60000).catch(() => undefined);
  await unlockIfLocked(d);
  await waitForTestId(d, "Contacts", 120000);
  await toMyAgent(d);
  await assertHome(d, "A4 relaunch");
  await screenshot(d, "journey-after-relaunch");
  log("A4 after tabs and a relaunch: still linked, still the home");

  printSuccess("tester-journey (phase A, Release + TestFlight env)");
  process.exitCode = 0;
} catch (err) {
  printFailure("tester-journey", err);
  if (d) {
    try {
      await screenshot(d, "journey-failure");
      await dumpSource(d, "journey-failure");
    } catch {
      /* ignore */
    }
  }
  process.exitCode = 1;
} finally {
  if (d) await d.deleteSession().catch(() => undefined);
}
