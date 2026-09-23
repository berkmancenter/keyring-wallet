import { execFileSync as execFileSyncForSim } from "node:child_process";
import { remote } from "webdriverio";
import { execSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, createWriteStream } from "node:fs";

import { APPIUM_PORT, TEST_ID_PREFIX, androidCaps, iosCaps } from "./config.js";

// The host port this worktree's Metro serves on; a second worktree runs its
// own on another port (Android reaches it via debug_http_host, see below).
const METRO_PORT = Number(process.env.METRO_PORT || 8081);
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
  // The process listening on THIS port — not the first Metro in `ps`, which on
  // a shared machine can be another worktree's Metro on another port.
  let metroAppDir;
  try {
    const pid = execSync(`lsof -nP -iTCP:${METRO_PORT} -sTCP:LISTEN -t`, { encoding: "utf8" }).trim().split("\n")[0];
    if (!pid) return;
    const cwd = execSync(`lsof -a -p ${pid} -d cwd -Fn`, { encoding: "utf8" })
      .split("\n")
      .find((line) => line.startsWith("n"));
    if (!cwd) return;
    metroAppDir = path.resolve(cwd.slice(1));
  } catch {
    return; // can't introspect processes on this platform — don't block the run over it
  }
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
  // Two simulators of the same platform both logged as "ios", so a two-sim run
  // could not say WHICH phone was stuck (2026-09-23: five minutes spent working
  // out which of two iPhones was sitting on a PIN pad). Keep the simulator name
  // so deviceTag can tell them apart.
  driver.e2eDeviceName = capabilities["appium:deviceName"] || undefined;
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
    // A Release APK bundles its JS: it needs no Metro, and touching the
    // device's tcp:8081 reverse would only disturb whoever else uses it.
    const { ANDROID_APK } = await import("./config.js");
    const releaseApk = process.env.E2E_RELEASE === "1" || /release/i.test(ANDROID_APK);
    if (!releaseApk) {
      execSync(`adb -s ${udid} reverse tcp:8081 tcp:${metroPort}`);
      console.log(`[e2e] adb reverse tcp:8081 -> tcp:${metroPort} set up on ${udid}`);
    } else {
      console.log(`[e2e] release APK: no Metro, tcp:8081 left as it is on ${udid}`);
    }
    if (!releaseApk && metroPort !== "8081") {
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
      // Target THIS session's simulator, never "booted". With two simulators
      // up, "booted" is ambiguous, simctl picks one WITHOUT erroring — and the
      // grant kills the app it lands on, as the note below says. So the second
      // session's camera grant can terminate the app on the FIRST session's
      // phone, which is then never relaunched: that phone shows neither the
      // home tabs nor the PIN screen, and the run blames whatever it was
      // waiting for. Measured 2026-09-23 on a two-simulator vetting run.
      execSync(`xcrun simctl privacy ${simTarget(driver)} grant camera ${APP_ID}`);
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
/**
 * The simulator a simctl command should target: this session's own udid, or —
 * when the session does not know it — the only booted simulator. Never
 * "booted" with two up: simctl then picks one WITHOUT erroring, and a grant
 * kills the app it lands on, so one session silently broke the other's phone
 * (2026-09-23). With several booted and no udid known, refuse rather than guess.
 */
export function simTarget(driver) {
  const caps = driver?.capabilities ?? {};
  const udid = caps.udid || caps.deviceUDID || caps["appium:udid"] || process.env.IOS_UDID;
  if (udid) return udid;
  const out = execFileSyncForSim("xcrun", ["simctl", "list", "devices", "booted", "-j"], { encoding: "utf8" });
  const booted = Object.values(JSON.parse(out).devices ?? {}).flat().filter((d) => d.state === "Booted");
  if (booted.length === 1) return booted[0].udid;
  throw new Error(`simTarget: ${booted.length} simulators are booted and this session's udid is unknown — refusing to guess which one`);
}

export function byTestId(driver, key) {
  const full = `${TEST_ID_PREFIX}${key}`;
  if (driver.e2ePlatform === "android") {
    return driver.$(`android=new UiSelector().resourceId("${full}")`);
  }
  return driver.$(`~${full}`);
}

export async function waitForTestId(driver, key, timeout = 30000) {
  const el = byTestId(driver, key);
  // Name the device in the message: a two-phone suite that says only "element
  // not found" costs a page dump before anyone can even ask WHICH phone
  // (2026-09-23, three runs in a row).
  const timeoutMsg = `[${deviceTag(driver)}] element testID=${key} not found in ${timeout}ms`;
  try {
    await el.waitForExist({ timeout, timeoutMsg });
  } catch (err) {
    // A miss is how the witness-connect Bluetooth pre-flight sheet shows up:
    // it arrives whenever the witness's discovery round trip completes —
    // anywhere from seconds to over a minute after the connect (attempts
    // 13 and 16, 2026-09-13) — and blocks every tap under it. Clear it and
    // look once more before giving up.
    if (key !== PREFLIGHT_ALLOW_KEY && (await clearLocalityPreflightIfUp(driver))) {
      await el.waitForExist({ timeout: Math.min(timeout, 10000), timeoutMsg });
    } else {
      throw err;
    }
  }
  return el;
}

const PREFLIGHT_ALLOW_KEY = "LocalityPreflightAllow";

/**
 * If the witness-connect Bluetooth pre-flight sheet (LocalityPreflightModal,
 * Android — iOS has none) is on screen, tap Allow. Returns whether it was.
 * The OS permission dialog that follows is auto-granted by the Appium caps.
 */
export async function clearLocalityPreflightIfUp(driver) {
  const allow = byTestId(driver, PREFLIGHT_ALLOW_KEY);
  if (!(await allow.isExisting())) return false;
  await allow.click();
  console.log(`[e2e] ${deviceTag(driver)}: Bluetooth pre-flight sheet — tapped Allow`);
  await new Promise((r) => setTimeout(r, 1500));
  return true;
}

/** `android:emulator-5554` (or just the platform, e.g. `ios`, when no udid
 *  is tracked) — prefixes every tap log so a two-device run's log is
 *  attributable to the device that acted, not just "android" twice. */
export function deviceTag(driver) {
  if (driver.e2eUdid) return `${driver.e2ePlatform}:${driver.e2eUdid}`;
  // A simulator has no udid here; its name is what distinguishes two of them.
  if (driver.e2eDeviceName) return `${driver.e2ePlatform}:${driver.e2eDeviceName}`;
  return driver.e2ePlatform;
}

export async function tapTestId(driver, key, timeout = 30000) {
  const el = await waitForTestId(driver, key, timeout);
  await el.waitForDisplayed({ timeout });
  await el.click();
  console.log(`[e2e] ${deviceTag(driver)}: tapped testID=${key}`);
  return el;
}

/**
 * Tap an element via a raw coordinate touch gesture instead of WebDriver's
 * .click(). On some real devices, uiautomator2's click is dispatched as an
 * accessibility action (View.performClick()) rather than a real touch —
 * React Native's gesture responder system, which most Touchables/Pressables
 * rely on to fire onPress, never sees it, so the tap silently has no effect
 * even though WebDriver reports success. Confirmed on a real device for a
 * SectionRow rendered as a native android.widget.Button: onPress never
 * fired across many plain .click() attempts (verified via a temporary debug
 * log in the handler itself), while a coordinate gesture worked immediately.
 * Android only — iOS's XCUITest click doesn't have this failure mode.
 */
/**
 * Tap an element you already hold, at the centre of its bounds, using the
 * same gesture `tapTestIdByCoordinates` uses. For elements found by a scoped
 * lookup — a control inside the CURRENT desk request, say — where re-finding
 * by testID would match a stale one somewhere else on the page.
 */
/**
 * Tap a point on Android through `adb shell input tap`.
 *
 * Neither a W3C pointer sequence nor UiAutomator2's own `mobile: clickGesture`
 * reliably reaches a React Native `Pressable`: measured on the vetter's
 * publish-profile and new-ticket controls, where both report success, the
 * element reports clickable and enabled, and `onPress` never runs — four
 * verified retries in a row failed. `adb shell input tap` on the identical
 * centre point fired the handler every time. So that is what Android taps use,
 * with the WebDriver paths kept as fallbacks.
 */
function adbTap(driver, x, y) {
  const udid = driver.capabilities?.deviceUDID || driver.capabilities?.udid || process.env.ANDROID_UDID;
  const target = udid ? ["-s", udid] : [];
  execSync(["adb", ...target, "shell", "input", "tap", String(x), String(y)].join(" "), { stdio: "ignore" });
}

export async function tapElement(driver, el) {
  await el.waitForDisplayed({ timeout: 30000 });
  // iOS: let XCUITest tap the element it resolved — a coordinate from the
  // element's rect misses on an iPad whose app runs in an inset window (see
  // tapTestIdByCoordinates). Android keeps its adb / clickGesture path.
  if (driver.e2ePlatform === "ios") {
    await el.click();
    return el;
  }
  const { x, y } = await el.getLocation();
  const { width, height } = await el.getSize();
  const cx = Math.floor(x + width / 2);
  const cy = Math.floor(y + height / 2);
  if (driver.e2ePlatform === "android") {
    try {
      adbTap(driver, cx, cy);
      return el;
    } catch {
      try {
        await driver.execute("mobile: clickGesture", { x: cx, y: cy });
        return el;
      } catch {
        /* fall through to the pointer sequence */
      }
    }
  }
  await driver.action("pointer").move({ x: cx, y: cy }).down().pause(80).up().perform();
  return el;
}

export async function tapTestIdByCoordinates(driver, key, timeout = 30000) {
  const el = await waitForTestId(driver, key, timeout);
  await el.waitForDisplayed({ timeout });
  const { x, y } = await el.getLocation();
  const { width, height } = await el.getSize();
  const cx = Math.floor(x + width / 2);
  const cy = Math.floor(y + height / 2);
  // A W3C pointer press is not always enough for a React Native `Pressable`:
  // measured on the vetter's "publish my profile" control, which reports
  // clickable and enabled, accepts the pointer sequence without error, and
  // never fires `onPress` — while `adb shell input tap` on the same centre
  // point fires it every time. UiAutomator2's own gesture is what `input tap`
  // does, so prefer it on Android and keep the pointer sequence as the
  // fallback for iOS and for anything the gesture refuses.
  let tapped = false;
  // On iOS, let XCUITest tap the element it resolved: a coordinate computed
  // from the element's rect missed on a physical iPad whose app ran in a
  // window inset from the screen's origin — the tap reported success and
  // never reached the button (the vetter's Publish, 2026-09-21). The
  // Pressable trouble that made coordinates necessary is Android's.
  if (driver.e2ePlatform === "ios") {
    try {
      await el.click();
      tapped = true;
    } catch {
      tapped = false;
    }
  }
  if (!tapped && driver.e2ePlatform === "android") {
    try {
      adbTap(driver, cx, cy);
      tapped = true;
    } catch {
      try {
        await driver.execute("mobile: clickGesture", { x: cx, y: cy });
        tapped = true;
      } catch {
        tapped = false;
      }
    }
  }
  if (!tapped) {
    await driver.action("pointer").move({ x: cx, y: cy }).down().pause(80).up().perform();
  }
  console.log(`[e2e] ${deviceTag(driver)}: tapped testID=${key} (by coordinates)`);
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
      // Prefer the same gesture `tapElement` uses: a plain `.click()` on a
      // React Native Pressable can return success without the handler ever
      // running — measured on the vetter's publish and new-ticket controls,
      // where `adb shell input tap` on the identical point fired every time.
      await tapElement(driver, el).catch(async () => {
        await el.click().catch(() => {});
      });
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
// `from` is where the drag starts (fraction of the screen height): a drag that
// begins on a TextInput selects text instead of scrolling, so a screen with an
// input mid-page needs a lower origin.
export async function scrollToTestId(driver, key, maxSwipes = 6, { from = 0.7, direction = "down", both = true } = {}) {
  try {
    return await scrollOnce(driver, key, maxSwipes, from, direction);
  } catch (err) {
    // A long screen may already have scrolled past the element; look the other way.
    if (!both) throw err;
    return scrollOnce(driver, key, maxSwipes, from, direction === "up" ? "down" : "up");
  }
}

async function scrollOnce(driver, key, maxSwipes, from, direction) {
  // An upward swipe starts well below the top: on an iPad the app can run in a
  // window inset from the screen's top edge, and a swipe starting at 15% lands
  // in the app's own header, where it scrolls nothing (seen on a real iPad).
  const [startY, endY] = direction === "up" ? [0.3, Math.max(from, 0.75)] : [from, 0.25];
  for (let i = 0; i < maxSwipes; i++) {
    const el = byTestId(driver, key);
    if ((await el.isExisting()) && (await el.isDisplayed())) return el;
    const { width, height } = await driver.getWindowRect();
    await driver
      .action("pointer")
      .move({ x: Math.floor(width / 2), y: Math.floor(height * startY) })
      .down()
      .pause(100)
      .move({
        x: Math.floor(width / 2),
        y: Math.floor(height * endY),
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
