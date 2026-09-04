import { remote } from "webdriverio";
import { execSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, createWriteStream } from "node:fs";

import { APPIUM_PORT, TEST_ID_PREFIX, androidCaps, iosCaps } from "./config.js";

const METRO_PORT = 8081;
const THIS_APP_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "app"
);

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.once("connect", () => (sock.destroy(), resolve(true)));
    sock.once("error", () => resolve(false));
  });
}

/**
 * Metro's dev-server port is a single global resource on the host, and a
 * debug build always looks for it there — Android via a hardcoded
 * `adb reverse tcp:8081`, iOS simulator directly over localhost. A repo
 * checked out as multiple git worktrees (or alongside its own main
 * checkout) can easily have a STALE Metro left running from a different
 * checkout still holding that port; it keeps serving ITS OWN checkout's
 * code with no error at all — the app boots fine, just against the wrong
 * JS. That surfaces much later as a confusing "element not found" deep
 * into a run, not as an obvious "wrong bundle" error (this cost a full
 * debug session to track down once — see
 * docs/plans/openvtc-integration-plan/2026-09-02-bam.md). Catch it here,
 * before wasting a full install+onboarding cycle on it.
 */
async function checkMetroIsThisWorktree() {
  if (!(await portInUse(METRO_PORT))) return; // nothing running yet — Metro's own absence is a separate, self-evident failure later
  let ps;
  try {
    ps = execSync("ps -eo pid,args", { encoding: "utf8" });
  } catch {
    return; // can't introspect processes on this platform — don't block the run over it
  }
  const match = ps.match(/(\S+\/app)\/node_modules\/react-native\/cli\.js\s+start/);
  if (!match) return; // something else owns the port, or we can't identify it — not our call to make
  const metroAppDir = path.resolve(match[1]);
  if (metroAppDir !== THIS_APP_DIR) {
    throw new Error(
      `Metro on :${METRO_PORT} is serving ${metroAppDir}, not this worktree's ` +
        `app/ (${THIS_APP_DIR}). Every debug build looks for the packager on ` +
        `host port ${METRO_PORT} regardless of which checkout it was built ` +
        `from, so this run would silently get the WRONG checkout's JS. Stop ` +
        `that Metro (find it: ps -eo pid,args | grep 'react-native/cli.js start') ` +
        `and run 'yarn start' from THIS worktree's app/ before retrying.`
    );
  }
}

let appiumProc;

export async function ensureAppium() {
  await checkMetroIsThisWorktree();
  if (await portInUse(APPIUM_PORT)) {
    // A server from a previous run may still be tearing down (it responds to
    // /status but dies seconds later, killing our sessions mid-run). Prefer
    // waiting for it to exit and starting our own; only reuse if it sticks
    // around, which means someone is running it deliberately.
    console.log(
      `[e2e] port :${APPIUM_PORT} in use — waiting for leftover appium to exit…`
    );
    for (let i = 0; i < 20 && (await portInUse(APPIUM_PORT)); i++) {
      await sleep(1000);
    }
    if (await portInUse(APPIUM_PORT)) {
      try {
        const res = await fetch(`http://127.0.0.1:${APPIUM_PORT}/status`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          console.log(
            `[e2e] reusing externally-managed appium on :${APPIUM_PORT}`
          );
          return;
        }
      } catch {
        /* unresponsive */
      }
      throw new Error(
        `port ${APPIUM_PORT} occupied by an unresponsive server — kill it (pkill -f appium) and retry`
      );
    }
  }
  mkdirSync("artifacts", { recursive: true });
  const logFile = "artifacts/appium.log";
  console.log(`[e2e] starting appium on :${APPIUM_PORT} (log: ${logFile})`);
  const log = createWriteStream(logFile, { flags: "w" });
  appiumProc = spawn(
    "appium",
    ["--port", String(APPIUM_PORT), "--relaxed-security"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    }
  );
  appiumProc.stdout.pipe(log);
  appiumProc.stderr.pipe(log);
  appiumProc.stderr.pipe(process.stderr);
  for (let i = 0; i < 60; i++) {
    if (await portInUse(APPIUM_PORT)) return;
    await sleep(1000);
  }
  throw new Error("appium did not start within 60s");
}

export function stopAppium() {
  if (appiumProc) appiumProc.kill("SIGTERM");
}

export async function createSession(platform, capsOverride) {
  const capabilities =
    capsOverride ?? (platform === "android" ? androidCaps() : iosCaps());
  const realDevice = Boolean(capabilities["appium:udid"]);
  console.log(
    `[e2e] creating ${platform} session${realDevice ? " (real device)" : ""}…`
  );
  const driver = await remote({
    hostname: "127.0.0.1",
    port: APPIUM_PORT,
    connectionRetryTimeout: 600000,
    connectionRetryCount: 1,
    capabilities,
  });
  driver.e2ePlatform = platform;
  if (platform === "android") {
    // Debug builds load the JS bundle from metro on the host; map emulator port 8081 back
    // BEFORE the first app launch (autoLaunch is disabled in the caps).
    const udid =
      driver.capabilities.deviceUDID ||
      driver.capabilities["appium:udid"] ||
      driver.capabilities.udid;
    if (!udid)
      throw new Error(
        "could not determine android device udid for adb reverse"
      );
    const { execSync } = await import("node:child_process");
    driver.e2eUdid = udid; // for logcat-based assertions (trust-task markers)
    // Scope logcat-based assertions to THIS run — the buffer survives app
    // reinstalls and would otherwise satisfy markers with a previous run's lines.
    execSync(`adb -s ${udid} logcat -c`);
    const { APP_ID } = await import("./config.js");
    // Override when a metro for a different worktree/project already holds
    // host port 8081 — lets this suite run its own metro on another port
    // without touching that unrelated process.
    const metroPort = process.env.METRO_PORT || "8081";
    execSync(`adb -s ${udid} reverse tcp:8081 tcp:${metroPort}`);
    console.log(`[e2e] adb reverse tcp:8081 -> tcp:${metroPort} set up on ${udid}`);
    if (metroPort !== "8081") {
      // This app's debug bundle loader resolves the packager via
      // 10.0.2.2:8081 (the emulator's host alias) BEFORE consulting the
      // adb-reverse-mapped localhost:8081 — so on a non-default METRO_PORT,
      // the adb reverse above is not enough: it would still silently hit
      // whatever real metro (if any) is listening on the *host's actual*
      // port 8081, which on a shared machine can belong to an unrelated
      // worktree, with no error and no visible sign the wrong bundle loaded.
      // Force it by seeding RN's own dev-settings SharedPreferences key
      // (debug_http_host) before first launch — this takes priority over
      // the 10.0.2.2:8081 default.
      const { writeFileSync, mkdtempSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const path = await import("node:path");
      const localPrefsPath = path.join(
        mkdtempSync(path.join(tmpdir(), "e2e-prefs-")),
        "prefs.xml"
      );
      writeFileSync(
        localPrefsPath,
        `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n    <string name="debug_http_host">10.0.2.2:${metroPort}</string>\n</map>\n`
      );
      const devicePrefsPath = "/data/local/tmp/e2e-debug-http-host-prefs.xml";
      execSync(`adb -s ${udid} push "${localPrefsPath}" ${devicePrefsPath}`);
      execSync(
        `adb -s ${udid} shell run-as ${APP_ID} mkdir -p shared_prefs`
      );
      execSync(
        `adb -s ${udid} shell run-as ${APP_ID} cp ${devicePrefsPath} shared_prefs/${APP_ID}_preferences.xml`
      );
      console.log(
        `[e2e] seeded debug_http_host=10.0.2.2:${metroPort} shared pref on ${udid}`
      );
    }
    await driver.activateApp(APP_ID);
    console.log("[e2e] app launched");
  }
  if (platform === "ios" && !realDevice) {
    // Pre-grant camera so the Scan screen skips the camera-disclosure Modal:
    // presenting that Modal right as the QR bottom-sheet dismisses intermittently
    // fails on the iOS simulator, leaving a blank Scan screen. (Real devices have
    // no simctl; the flow falls back to the in-app disclosure + autoAcceptAlerts.)
    try {
      const { execSync } = await import("node:child_process");
      const { APP_ID } = await import("./config.js");
      execSync(`xcrun simctl privacy booted grant camera ${APP_ID}`);
      // granting TCC permission kills the app; relaunch it cleanly (immediate
      // activate can race the teardown and leave a black screen)
      await driver.terminateApp(APP_ID).catch(() => {});
      await sleep(3000);
      await driver.activateApp(APP_ID);
      await sleep(3000);
    } catch {
      /* non-fatal — flow falls back to the disclosure modal */
    }
  }
  return driver;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Accept an OS-level dialog if one is showing (camera / local-network /
 * notification permission…). Real devices surface these where simulators
 * don't (no simctl pre-grant, Bonjour local-network prompt), and appium's
 * autoAcceptAlerts intermittently misses them — a blocking system alert
 * swallows every synthesized tap, so flows stall on taps that "do nothing".
 */
export async function acceptSystemAlertIfPresent(driver) {
  try {
    const text = await driver.getAlertText();
    if (text == null) return false;
    // NEVER touch the OS biometric/passcode prompt — that one is for the human
    // operator (titles from AttestationModule.kt / Attestation.mm)
    if (/confirm relationship|confirm your identity|fingerprint|face id|passcode|pin/i.test(text)) {
      return false;
    }
    console.log(
      `[e2e] ${driver.e2ePlatform}: accepting system alert: "${String(text)
        .replace(/\s+/g, " ")
        .slice(0, 100)}"`
    );
    await driver.acceptAlert();
    await sleep(1000);
    return true;
  } catch {
    return false; // no alert showing
  }
}

/**
 * Collapse Android's notification shade if it's open, hiding the app
 * underneath — a real notification (battery, message, etc.) landing on an
 * attended real-device run can pull it down mid-flow. Observed failure: a
 * page-source dump at a "QR Code" click failure showed ONLY status-bar
 * content (battery %, clock, notification count), no app UI at all. No-op
 * on iOS/emulators (this is an Android real-notification concern
 * specifically) or if nothing is open.
 */
export async function collapseNotificationShadeIfOpen(driver) {
  if (driver.e2ePlatform !== "android" || !driver.e2eUdid) return;
  try {
    const { execSync } = await import("node:child_process");
    execSync(`adb -s ${driver.e2eUdid} shell cmd statusbar collapse`);
  } catch {
    /* best-effort — a missing statusbar service on some OEM builds is non-fatal */
  }
}

/**
 * Find an element by bifold testID (testIdWithKey key).
 * RN maps testID → resource-id on Android and → accessibility identifier on iOS.
 */
export function byTestId(driver, key) {
  const full = `${TEST_ID_PREFIX}${key}`;
  if (driver.e2ePlatform === "android") {
    return driver.$(`android=new UiSelector().resourceId("${full}")`);
  }
  return driver.$(`~${full}`);
}

export async function waitForTestId(driver, key, timeout = 30000) {
  const el = byTestId(driver, key);
  await el.waitForExist({
    timeout,
    timeoutMsg: `element testID=${key} not found in ${timeout}ms`,
  });
  return el;
}

/** `android:emulator-5554` (or just the platform, e.g. `ios`, when no udid
 *  is tracked) — prefixes every tap log so a two-device run's log is
 *  attributable to the device that acted, not just "android" twice. */
export function deviceTag(driver) {
  return driver.e2eUdid ? `${driver.e2ePlatform}:${driver.e2eUdid}` : driver.e2ePlatform;
}

export async function tapTestId(driver, key, timeout = 30000) {
  const el = await waitForTestId(driver, key, timeout);
  await el.waitForDisplayed({ timeout });
  await el.click();
  console.log(`[e2e] ${deviceTag(driver)}: tapped testID=${key}`);
  return el;
}

/**
 * Tap an element by testID, then confirm the tap actually took effect via
 * `verify`, re-tapping if it didn't. Some real devices (seen on Android 16)
 * silently drop an occasional tap: the WebDriver click command returns
 * success, but the app never receives the touch, so the expected UI change
 * (navigation, a modal closing, a toggle flipping) never happens. A plain
 * tapTestId() has no way to detect that — it only confirms the element it
 * clicked existed, not that the click did anything.
 *
 * @param {object} driver
 * @param {string} key - testID to tap (see byTestId)
 * @param {() => Promise<boolean>} verify - resolves true once the tap's
 *   expected effect has happened. Must check something OTHER than "the
 *   tapped element still exists" — e.g. a different element appearing or
 *   disappearing, a screen having navigated.
 * @param {{ attempts?: number, settleMs?: number, timeout?: number }} [options]
 */
export async function tapTestIdReliable(driver, key, verify, options = {}) {
  const { attempts = 3, settleMs = 1500, timeout = 15000 } = options;
  // The goal can already be met before we look for the button: a slow
  // WebDriver round trip (element lookup, tag-name check inside click())
  // can race an app-side auto-submit that fires between the caller's own
  // existence check and this call. If verify() already passes, the
  // element that would confirm it is gone for good — waiting for it to
  // reappear would block for the full timeout instead of succeeding.
  if (await verify()) {
    console.log(`[e2e] ${deviceTag(driver)}: testID=${key} already satisfied, no tap needed`);
    return;
  }
  await waitForTestId(driver, key, timeout);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const el = byTestId(driver, key);
    if (await el.isExisting()) {
      await el.click().catch(() => {});
    }
    await sleep(settleMs);
    if (await verify()) {
      console.log(`[e2e] ${deviceTag(driver)}: tapped testID=${key} (attempt ${attempt + 1}/${attempts}, verified)`);
      return;
    }
  }
  throw new Error(
    `${driver.e2ePlatform}: tap on testID=${key} did not take effect after ${attempts} attempts`
  );
}

/** Swipe up until the element with the given testID is displayed (max 6 swipes). */
export async function scrollToTestId(driver, key, maxSwipes = 6) {
  for (let i = 0; i < maxSwipes; i++) {
    const el = byTestId(driver, key);
    if ((await el.isExisting()) && (await el.isDisplayed())) return el;
    const { width, height } = await driver.getWindowRect();
    await driver
      .action("pointer")
      .move({ x: Math.floor(width / 2), y: Math.floor(height * 0.7) })
      .down()
      .pause(100)
      .move({
        x: Math.floor(width / 2),
        y: Math.floor(height * 0.25),
        duration: 400,
      })
      .up()
      .perform();
    await sleep(500);
  }
  throw new Error(
    `element testID=${key} not displayed after ${maxSwipes} swipes`
  );
}

export async function existsTestId(driver, key, timeout = 4000) {
  try {
    await waitForTestId(driver, key, timeout);
    return true;
  } catch {
    return false;
  }
}

/** Find by visible text (fallback when a control has no testID). */
export function byText(driver, text) {
  if (driver.e2ePlatform === "android") {
    return driver.$(`android=new UiSelector().text("${text}")`);
  }
  return driver.$(
    `-ios predicate string:label == "${text}" OR name == "${text}"`
  );
}

/** Find by partial visible text (labels may have prefixes, e.g. "Contact: Alice"). */
export function byTextContains(driver, text) {
  if (driver.e2ePlatform === "android") {
    return driver.$(`android=new UiSelector().textContains("${text}")`);
  }
  return driver.$(
    `-ios predicate string:label CONTAINS "${text}" OR name CONTAINS "${text}"`
  );
}

export async function tapText(driver, text, timeout = 30000) {
  const el = byText(driver, text);
  await el.waitForExist({
    timeout,
    timeoutMsg: `element text="${text}" not found in ${timeout}ms`,
  });
  await el.click();
  return el;
}

export async function dumpSource(driver, label) {
  const src = await driver.getPageSource();
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync("artifacts", { recursive: true });
  const file = `artifacts/${label}-${driver.e2ePlatform}-${Date.now()}.xml`;
  writeFileSync(file, src);
  console.log(`[e2e] page source dumped: ${file}`);
  return file;
}

export async function screenshot(driver, label) {
  const { mkdirSync } = await import("node:fs");
  mkdirSync("artifacts", { recursive: true });
  const file = `artifacts/${label}-${driver.e2ePlatform}-${Date.now()}.png`;
  await driver.saveScreenshot(file);
  console.log(`[e2e] screenshot: ${file}`);
  return file;
}
