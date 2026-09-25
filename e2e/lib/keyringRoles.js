// Keyring's side of a vetting ceremony, one step per function, for any
// counterpart: another Keyring (run-vti-vetting.js) or an openvtc bot (the
// interop harness, keyring-wallet#150).
//
// The caller owns the sessions and the order. Each function does ONE step on
// the phone it is given, asserts both the step the screen is on (its
// VettingApplicantStep_* / VettingVetterStep_* testID, keyring-bifold#115) and
// the words that mark the step's effect, and returns a record. The record is
// also appended as one JSON line to the run's shared log (opts.log or
// E2E_STEP_LOG), where the counterpart appends its own, so the two sides line
// up by time. A step that fails throws a StepError carrying the same record
// with a screenshot and the page source; nothing waits without a named
// deadline.
//
// Record: { role, step, platform, device, ok, startedAt, endedAt,
//           observed: { stepId, ... }, value?, error?, screenshot?, source? }

import { appendFileSync, copyFileSync, mkdirSync, readdirSync, statSync, openSync, closeSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  byTestId,
  createSession,
  deviceTag,
  dumpSource,
  existsTestId,
  screenshot,
  scrollToTestId,
  sleep,
  tapElement,
  tapTestIdByCoordinates,
  tapTestIdReliable,
  waitForTestId,
} from "./driver.js";
import { androidCaps, iosCaps, TEST_ID_PREFIX } from "./config.js";
import { handleBiometricConfirmIfPresent, leaveCommunityInApp, openMyAgentPanel, pasteLinkFromHome, unlockIfLocked } from "./flows.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.resolve(here, "../artifacts");
const LOW = { from: 0.86 };

const isIos = (d) => d.e2ePlatform === "ios";
export const textOf = async (d, key) => (await byTestId(d, key).getAttribute(isIos(d) ? "label" : "text")) || "";

// ---------------------------------------------------------------- the record

export class StepError extends Error {
  constructor(message, record) {
    super(message);
    this.name = "StepError";
    this.record = record;
  }
}

function logPath(opts) {
  return opts?.log || process.env.E2E_STEP_LOG || "";
}

function writeRecord(opts, record) {
  const file = logPath(opts);
  if (!file) return;
  mkdirSync(path.dirname(file), { recursive: true });
  // One short line per append: two writers (this and the bot) on O_APPEND do
  // not interleave within a line.
  appendFileSync(file, JSON.stringify(record) + "\n");
}

/**
 * Which step the vetting page is on, from its root's testID; null when the
 * vetting page is not showing. The testID is on the page root, which fills the
 * screen, so Android's UiAutomator reports it whatever the scroll position.
 */
export async function stepIdOf(d, role) {
  const stem = `${TEST_ID_PREFIX}${role === "vetter" ? "VettingVetterStep_" : "VettingApplicantStep_"}`;
  try {
    if (isIos(d)) {
      const el = await d.$(`-ios predicate string:name BEGINSWITH "${stem}"`);
      if (!(await el.isExisting())) return null;
      return String(await el.getAttribute("name")).slice(stem.length);
    }
    // No escaped dots: UiSelector passes the pattern through with its
    // backslashes, and `com\\.ariesbifold` then matches nothing (first run on
    // the emulator, 2026-09-25). The stem's tail is unique enough on its own.
    const tail = stem.slice(stem.indexOf(":id/"));
    const el = await d.$(`android=new UiSelector().resourceIdMatches(".*${tail}.*")`);
    if (!(await el.isExisting())) return null;
    return String(await el.getAttribute("resource-id")).slice(stem.length);
  } catch {
    return null;
  }
}

/**
 * The app's own log, as a tester's problem report carries it (Home → Give
 * feedback → Share…): the in-app ring buffer, which is kept in Release. An iOS
 * Release build writes no JavaScript console to the device log, so this is the
 * only client-side record of an intermittent iPhone failure (2026-09-25: an
 * iPhone's mediator socket stalled after login, twice in four links).
 *
 * iOS simulator: "Share…" writes the report to the app's Caches before the
 * share sheet opens, so it is copied from the data container. Android shares
 * the text without a file, and logcat already has the JavaScript lines, so it
 * records that instead. Never throws: a log it cannot get is recorded as why.
 */
export async function exportAppLog(d, { dir = ARTIFACTS, tag = "app-log" } = {}) {
  if (d.e2ePlatform !== "ios") return { appLogSkipped: "android: the JavaScript log is in logcat" };
  const udid = d.capabilities?.udid || d.capabilities?.["appium:udid"];
  if (!udid) return { appLogSkipped: "no simulator udid for this session" };
  let container;
  try {
    container = execFileSync("xcrun", ["simctl", "get_app_container", udid, "asml.bkc.harvard.wallet", "data"], { encoding: "utf8" }).trim();
  } catch {
    return { appLogSkipped: "not a simulator (no data container): a device report needs the tester's share" };
  }
  const caches = path.join(container, "Library", "Caches");
  const reports = () => {
    try {
      return readdirSync(caches).filter((f) => /^keyring-report-.*\.txt$/.test(f));
    } catch {
      return [];
    }
  };
  const before = new Set(reports());
  try {
    await d.execute("mobile: alert", { action: "dismiss" }).catch(() => undefined);
    if (await existsTestId(d, "EnterPIN", 1500)) await unlockIfLocked(d);
    let button = (await existsTestId(d, "GiveFeedback", 1500)) ? byTestId(d, "GiveFeedback") : undefined;
    for (const tab of ["Contacts", "Wallet", "Settings"]) {
      if (button) break;
      if (await existsTestId(d, tab, 1000)) await byTestId(d, tab).click().catch(() => undefined);
      await sleep(1000);
      button = await scrollToTestId(d, "GiveFeedback", 4).catch(() => undefined);
    }
    if (!button) return { appLogSkipped: "Give feedback is not reachable from this screen" };
    // What matters is the report file. Some builds ask first ("Send this
    // problem report?" → Share…), others open the share sheet at once (Menu →
    // Help → Give feedback, 2026-09-25); either way "Share…" writes the file
    // before the sheet shows, so wait for the file, answering the question if
    // one is asked.
    const waitForReport = async (ms) => {
      for (const until = Date.now() + ms; Date.now() < until; ) {
        if (reports().some((f) => !before.has(f))) return true;
        if (await d.getAlertText().then(() => true, () => false)) {
          await d.execute("mobile: alert", { action: "accept", buttonLabel: "Share…" }).catch(() => undefined);
        }
        await sleep(500);
      }
      return false;
    };
    await button.click();
    if (!(await waitForReport(10000))) {
      await tapTestIdByCoordinates(d, "GiveFeedback").catch(() => undefined);
      if (!(await waitForReport(10000))) {
        const shot = await screenshot(d, `${tag}-no-report`).catch(() => undefined);
        return { appLogSkipped: `Give feedback wrote no report file${shot ? ` (screen: ${shot})` : ""}` };
      }
    }
    await sleep(1000);
    // Close the share sheet; the report is already written.
    await d.$("~Close").click().catch(() => undefined);
    const fresh = reports().filter((f) => !before.has(f));
    if (fresh.length === 0) return { appLogSkipped: "the report file did not appear in the app's Caches" };
    mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${tag}-${fresh[fresh.length - 1]}`);
    copyFileSync(path.join(caches, fresh[fresh.length - 1]), out);
    console.log(`[logs] app log: ${out}`);
    return { appLog: out };
  } catch (e) {
    return { appLogSkipped: `export failed: ${String(e?.message ?? e).split("\n")[0]}` };
  }
}

/**
 * Run one step: time it, read the step the screen ended on, write the record.
 * `fn` returns { value?, observed? }; a throw becomes a StepError with a
 * screenshot, the page source, and the step the screen was on at the time.
 */
async function runStep(d, role, step, opts, fn) {
  const startedAt = new Date().toISOString();
  const base = { role, step, platform: d.e2ePlatform, device: deviceTag(d) };
  try {
    const out = (await fn()) || {};
    const record = {
      ...base,
      ok: true,
      startedAt,
      endedAt: new Date().toISOString(),
      observed: { stepId: await stepIdOf(d, role), ...(out.observed || {}) },
      ...(out.value !== undefined ? { value: out.value } : {}),
    };
    writeRecord(opts, record);
    console.log(`[step] ${role}.${step} ok${out.value !== undefined ? ` — ${JSON.stringify(out.value).slice(0, 120)}` : ""}`);
    return record;
  } catch (err) {
    const tag = `step-${role}-${step}-${d.e2ePlatform}`;
    const shot = await screenshot(d, tag).catch(() => undefined);
    const source = await dumpSource(d, tag).catch(() => undefined);
    // Last, because it leaves the failed screen: the app's own log (iOS).
    const stepId = await stepIdOf(d, role);
    const appLog = process.env.E2E_APP_LOG_ON_FAIL === "0" ? { appLogSkipped: "E2E_APP_LOG_ON_FAIL=0" } : await exportAppLog(d, { dir: opts?.log ? path.dirname(opts.log) : ARTIFACTS, tag });
    const record = {
      ...base,
      ok: false,
      startedAt,
      endedAt: new Date().toISOString(),
      observed: { stepId, ...(err?.observed || {}) },
      error: err?.message || String(err),
      ...(typeof shot === "string" ? { screenshot: shot } : {}),
      ...(typeof source === "string" ? { source } : {}),
      ...appLog,
    };
    writeRecord(opts, record);
    console.log(`[step] ${role}.${step} FAILED — ${record.error}`);
    throw new StepError(`${role}.${step}: ${record.error}`, record);
  }
}

/** An error that carries what the screen said, for the record. */
function failWith(message, observed) {
  return Object.assign(new Error(message), { observed });
}

/**
 * A document from the other side that was refused unread (keyring-bifold#128/#129):
 * the step will not move, so fail at once with the reason the screen gives,
 * rather than wait out the deadline.
 */
async function throwIfEnvelopeRefused(d, extra = async () => ({})) {
  if (!(await existsTestId(d, "VettingEnvelopeRefused", 500))) return;
  const said = await textOf(d, "VettingEnvelopeRefused").catch(() => "");
  const reason = await textOf(d, "VettingEnvelopeRefusedReason").catch(() => "");
  throw failWith(`a message from the other side was refused unread: ${said}${reason ? ` (${reason})` : ""}`, {
    ...(await extra()),
    envelopeRefused: said || true,
    envelopeRefusedReason: reason,
  });
}

/**
 * Wait until the page is on one of `want`. On the deadline, say where it is
 * instead, and for how long it has been there: "stuck at checking for 300 s"
 * is the finding, "timeout" is not.
 */
async function awaitStep(d, role, want, timeoutMs, extra = async () => ({})) {
  const wanted = Array.isArray(want) ? want : [want];
  const until = Date.now() + timeoutMs;
  let current = null;
  let since = Date.now();
  // The last vetting step seen, and when: the PIN screen of the inactivity
  // lock hides the page, and "not showing" alone read like a navigation
  // (cd's run A, 2026-09-25: the lock at 07:12:48 after five idle minutes).
  let lastStepSeen = null;
  let lastStepAt = null;
  let unlocks = 0;
  for (;;) {
    const now = await stepIdOf(d, role);
    if (now) {
      lastStepSeen = now;
      lastStepAt = new Date().toISOString();
    } else if (await existsTestId(d, "EnterPIN", 500)) {
      // The wallet locked itself while we waited: unlock and keep waiting,
      // as the person would. The lock is not a finding.
      if (++unlocks > 5) throw failWith("the wallet kept locking while waiting (5 unlocks)", { lastStepSeen, lastStepAt });
      await unlockIfLocked(d);
      continue;
    }
    if (now !== current) {
      current = now;
      since = Date.now();
    }
    if (current && wanted.includes(current)) return current;
    // Only while short of the step. The refusal stays on the row, so a later
    // wait still sees it; a refused document anywhere in a ceremony is a
    // finding, since a conforming peer never sends one.
    await throwIfEnvelopeRefused(d, extra);
    if (Date.now() > until) {
      const observed = {
        stepId: current,
        secondsOnStep: Math.round((Date.now() - since) / 1000),
        lastStepSeen,
        lastStepAt,
        unlocksWhileWaiting: unlocks,
        ...(await extra()),
      };
      throw failWith(
        current
          ? `stuck at "${current}" for ${observed.secondsOnStep} s, waiting for ${wanted.join(" | ")}`
          : `the vetting page is not showing (last step seen: ${lastStepSeen ?? "none"}${lastStepAt ? ` at ${lastStepAt}` : ""}; waiting for ${wanted.join(" | ")})`,
        observed
      );
    }
    await sleep(2000);
  }
}

/** Wait for a testID's words to match; on the deadline, say what they were. */
async function awaitText(d, key, re, timeoutMs) {
  const until = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < until) {
    await scrollToTestId(d, key, 3, LOW).catch(() => undefined);
    last = await textOf(d, key).catch(() => "");
    if (re.test(last)) return last;
    await sleep(2500);
  }
  throw failWith(`${key} never matched ${re} (last: "${last.slice(0, 120)}")`, { [key]: last });
}

/** What the applicant's page says about its request, for a failure record. */
async function applicantEvidence(d) {
  return {
    requestStatus: await textOf(d, "VettingRequestStatus").catch(() => ""),
    checklist: await textOf(d, "VettingChecklist").catch(() => ""),
    vetter: await textOf(d, "VettingRequestVetter").catch(() => ""),
    cardSentAt: await textOf(d, "VettingCardSentAt").catch(() => ""),
    error: await textOf(d, "VettingError").catch(() => ""),
    statementRefused: await textOf(d, "VettingStatementRefusedDetails").catch(() => ""),
    envelopeRefusedReason: await textOf(d, "VettingEnvelopeRefusedReason").catch(() => ""),
  };
}

// ---------------------------------------------------------------- sessions and logs

/**
 * A session for one phone, for callers that do not bring their own. The app
 * is installed fresh from `app` unless `keepState` is set; a gate run never
 * keeps an app it did not install (the E2E_KEEP_APP trap, 221 gate).
 */
export async function makeDriver({ platform, app, udid, deviceName, keepState = false }) {
  // Capabilities built here, not through process.env: config.js reads
  // ANDROID_APK / IOS_APP / ANDROID_UDID once, at import, so setting them now
  // did nothing — and androidCaps() names an AVD with fullReset, which on a
  // machine that has that AVD would wipe the app a caller had prepared (found
  // by cd, 2026-09-25).
  const caps = platform === "android" ? { ...androidCaps() } : { ...iosCaps() };
  if (platform === "android" && udid) {
    delete caps["appium:avd"];
    caps["appium:udid"] = udid;
  }
  if (platform !== "android" && deviceName) caps["appium:deviceName"] = deviceName;
  if (platform !== "android" && udid) caps["appium:udid"] = udid;
  if (keepState) {
    // Drive the app that is installed, as it is: never install, reset or wipe.
    delete caps["appium:app"];
    Object.assign(caps, { "appium:fullReset": false, "appium:noReset": true, "appium:enforceAppInstall": false });
  } else if (app) {
    caps["appium:app"] = app;
  }
  return createSession(platform, caps);
}

/**
 * Capture the phone's own log for the run, bounded, with the PID recorded so
 * it can be stopped by PID and never outlives the run unseen. Android: logcat.
 * iOS simulator: the unified log of the app's process — a Release build logs
 * only native lines and errors there, not the JavaScript console (known gap).
 */
export function startDeviceLog({ platform, udid, file, maxBytes = 200 * 1024 * 1024 }) {
  mkdirSync(path.dirname(file), { recursive: true });
  const fd = openSync(file, "a");
  const child =
    platform === "android"
      ? spawn("adb", ["-s", udid, "logcat", "-v", "threadtime"], { stdio: ["ignore", fd, fd] })
      : spawn("xcrun", ["simctl", "spawn", udid, "log", "stream", "--style", "compact", "--predicate", 'process == "KeyRing"'], {
          stdio: ["ignore", fd, fd],
        });
  closeSync(fd);
  const pidFile = `${file}.pid`;
  appendFileSync(pidFile, `${child.pid}\n`);
  const guard = setInterval(() => {
    try {
      if (statSync(file).size > maxBytes) {
        console.log(`[logs] ${file} reached ${maxBytes} bytes — stopping capture (pid ${child.pid})`);
        child.kill("SIGTERM");
        clearInterval(guard);
      }
    } catch {
      /* the file is gone: stop quietly */
    }
  }, 5000);
  guard.unref();
  console.log(`[logs] ${platform} log → ${file} (pid ${child.pid})`);
  return {
    pid: child.pid,
    file,
    stop() {
      clearInterval(guard);
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    },
  };
}

/** The installed app's hash, for the record; a gate compares it with the build. */
export function installedHash({ platform, udid, bundleId = "asml.bkc.harvard.wallet" }) {
  if (platform === "android") {
    const p = execFileSync("adb", ["-s", udid, "shell", "pm", "path", bundleId], { encoding: "utf8" }).split("\n")[0].replace("package:", "").trim();
    const local = path.join(ARTIFACTS, `installed-${Date.now()}.apk`);
    execFileSync("adb", ["-s", udid, "pull", p, local], { stdio: "ignore" });
    return execFileSync("shasum", ["-a", "256", local], { encoding: "utf8" }).slice(0, 12);
  }
  const container = execFileSync("xcrun", ["simctl", "get_app_container", udid, bundleId, "app"], { encoding: "utf8" }).trim();
  return execFileSync("shasum", ["-a", "256", path.join(container, "main.jsbundle")], { encoding: "utf8" }).slice(0, 12);
}

// ---------------------------------------------------------------- shared

/**
 * Hand a link to the OS, as a tap on it in a message does: Android's VIEW
 * intent, or the simulator's openurl. iOS then asks "Open in KeyRing?" the
 * first time; the answer is Open. The app decides what to do with it.
 */
export async function openLinkViaOs(d, uri) {
  if (d.e2ePlatform === "android") {
    if (!d.e2eUdid) throw new Error("no udid for this Android session");
    // One argument to the device shell, quoted there: `&` in the link would
    // otherwise end the command.
    execFileSync("adb", ["-s", d.e2eUdid, "shell", `am start -W -a android.intent.action.VIEW -d '${uri.replace(/'/g, "")}'`], { stdio: "ignore" });
  } else {
    const udid = d.capabilities?.udid || d.capabilities?.["appium:udid"];
    if (!udid) throw new Error("no simulator udid for this iOS session");
    execFileSync("xcrun", ["simctl", "openurl", udid, uri], { stdio: "ignore" });
    await sleep(1500);
    await d.execute("mobile: alert", { action: "accept", buttonLabel: "Open" }).catch(() => undefined);
  }
  await sleep(2500);
}

/** From anywhere after unlock, into Vetting. */
async function openVetting(d) {
  await (await waitForTestId(d, "MyAgent", 30000)).click();
  const homeBy = Date.now() + 60000;
  while (Date.now() < homeBy) {
    for (const door of ["AgentVetOthers", "AgentContinueVetting"]) {
      const el = await scrollToTestId(d, door, 4).catch(() => undefined);
      if (el) {
        await el.click();
        await sleep(1500);
        return door;
      }
    }
    if ((await existsTestId(d, "AgentOpenCommunities", 1000)) || (await existsTestId(d, "MyAgentCard", 1000))) break;
    await sleep(2000);
  }
  await openMyAgentPanel(d);
  await sleep(1500);
  if (await byTestId(d, "ConnectMyAgentButton").isExisting().catch(() => false)) await byTestId(d, "ConnectMyAgentButton").click();
  await waitForTestId(d, "MyAgentVettingRow", 180000);
  await (await scrollToTestId(d, "MyAgentVettingRow", 6)).click();
  await sleep(1500);
  return "MyAgentVettingRow";
}

/** Unlock and reach the home tabs; poll, because the lock can come back. */
export async function unlockToHome(d, timeoutMs = 300000) {
  if (await existsTestId(d, "GetStarted", 8000)) {
    throw new Error(`${d.e2ePlatform}: no wallet on this phone — link an agent first (run-vta-link.js)`);
  }
  await waitForTestId(d, "EnterPIN", 120000).catch(() => undefined);
  await unlockIfLocked(d);
  for (let i = 0; i < 4; i++) if (!(await d.acceptAlert().then(() => true, () => false))) break;
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await byTestId(d, "Contacts").isExisting().catch(() => false)) break;
    if (Date.now() > until) throw new Error(`[${deviceTag(d)}] never reached the home tabs`);
    if (await byTestId(d, "EnterPIN").isExisting().catch(() => false)) await unlockIfLocked(d);
    await sleep(3000);
  }
  await sleep(3000);
}

// ---------------------------------------------------------------- applicant

export const applicant = {
  /**
   * Forget the community on this phone (the person's own Leave), so a run
   * starts fresh. An applicant has no Leave, so a phone left mid-application
   * refuses as NOT FRESH; `allowInProgress` carries on with that application
   * instead (start() then resumes it at its own step).
   */
  reset(d, { allowInProgress = false } = {}, opts = {}) {
    return runStep(d, "applicant", "reset", opts, async () => {
      await leaveCommunityInApp(d, { allowInProgress });
      return { observed: { allowInProgress } };
    });
  },

  /**
   * Into Get vetted and through its first step: the community link (door
   * "link": what the community asks → make the identity) or the agent home
   * (door "vetting"), then the legal name and Start. Ends on the ticket step.
   */
  start(d, { communityDid, communityName = "keyring-test", door = "link", legalName = "Alice Example" } = {}, opts = {}) {
    return runStep(d, "applicant", "start", opts, async () => {
      let observedAsks = "";
      if (door === "link") {
        if (!communityDid) throw new Error("door 'link' needs communityDid");
        await pasteLinkFromHome(d, `keyring://vti/community?d=${encodeURIComponent(communityDid)}&n=${encodeURIComponent(communityName)}`);
        await waitForTestId(d, "JoinAsks", 60000);
        const asks = await textOf(d, "JoinAsks").catch(() => "");
        // After a Leave the screen may lead with where the person stood.
        for (let i = 0; i < 20 && !(await existsTestId(d, "JoinStart", 1500)); i++) {
          const again = await scrollToTestId(d, "JoinAgain", 2).catch(() => undefined);
          if (again) {
            await again.click();
            await sleep(1500);
          }
        }
        await (await waitForTestId(d, "JoinStart", 30000)).click();
        await waitForTestId(d, "JoinMakeIdentity", 30000);
        await tapTestIdByCoordinates(d, "JoinAsContinue");
        await handleBiometricConfirmIfPresent(d);
        observedAsks = asks.replace(/\s+/g, " ").slice(0, 200);
      } else {
        await openVetting(d);
      }
      if (await byTestId(d, "VettingCreateIdentityButton").isExisting().catch(() => false)) {
        await byTestId(d, "VettingCreateIdentityButton").click();
      }
      // An application already under way opens on its own step.
      const at = await awaitStep(d, "applicant", ["name", "ticket", "waiting", "match", "send", "checking", "apply", "member"], 240000);
      if (at === "name") {
        await waitForTestId(d, "VettingLegalNameInput", 60000);
        await byTestId(d, "VettingLegalNameInput").setValue(legalName);
        await byTestId(d, "VettingSeatBanner").click().catch(() => undefined);
        await sleep(800);
        const start = await scrollToTestId(d, "VettingStartButton", 4);
        for (let i = 0; i < 30 && !(await start.isEnabled().catch(() => false)); i++) await sleep(2000);
        await tapTestIdByCoordinates(d, "VettingStartButton");
      } else if (at !== "ticket") {
        throw failWith(`the application is already past the ticket step ("${at}") — reset the applicant first`, { stepId: at });
      }
      await awaitStep(d, "applicant", "ticket", 60000);
      const requirements = await textOf(d, "VettingRequirements").catch(() => "");
      return { observed: { requirements, ...(observedAsks ? { asks: observedAsks } : {}) } };
    });
  },

  /**
   * Hand the vetter's ticket to the phone and send the request. `via`:
   * "field" types it into the ticket box; "scanner-paste" pastes it on the
   * scanner's paste screen, which routes it the way a scanned QR or an opened
   * link would; "deeplink" hands it to the OS, as a tap on the link in a
   * message does (needs the vetting-ticket: scheme registered, keyring-wallet
   * PR after 223).
   */
  request(d, { ticketUri, via = "field" } = {}, opts = {}) {
    return runStep(d, "applicant", "request", opts, async () => {
      if (!/^vetting-ticket:/.test(ticketUri || "")) throw new Error(`not a vetting-ticket link: ${String(ticketUri).slice(0, 60)}`);
      if (via === "scanner-paste") {
        await pasteLinkFromHome(d, ticketUri);
        // The ticket is held for the vetting screen, which fills it in.
        await openVetting(d);
      } else if (via === "deeplink") {
        await openLinkViaOs(d, ticketUri);
        // The link opens Get vetted, or holds the ticket for it.
        if ((await stepIdOf(d, "applicant")) === null) await openVetting(d);
      }
      await awaitStep(d, "applicant", "ticket", 60000);
      await scrollToTestId(d, "VettingTicketInput", 6).catch(() => undefined);
      const field = await waitForTestId(d, "VettingTicketInput", 60000);
      if (via !== "field") {
        // Routed in by the app: the field must now hold this ticket.
        const held = ((await field.getAttribute(isIos(d) ? "value" : "text").catch(() => "")) || "").trim();
        if (held !== ticketUri) {
          throw failWith(`the ticket was not handed to Get vetted via ${via} (the field holds "${held.slice(0, 40)}…")`, { held: held.slice(0, 80) });
        }
      }
      if (via === "field") {
        // setValue writes the native text without React's onChangeText often
        // enough on iOS that the button stays disabled: retype until it wakes.
        let enabled = false;
        for (let i = 0; i < 4 && !enabled; i++) {
          await field.clearValue().catch(() => undefined);
          await field.click().catch(() => undefined);
          if (i === 0) await field.setValue(ticketUri).catch(() => undefined);
          else await field.addValue(ticketUri).catch(() => undefined);
          await sleep(1200);
          enabled = await byTestId(d, "VettingRequestButton").isEnabled().catch(() => false);
        }
        if (!enabled) {
          const refused = await textOf(d, "VettingTicketRefused").catch(() => "");
          throw failWith(`the ticket never enabled "Use this link"${refused ? ` — the screen says: ${refused}` : ""}`, { ticketRefused: refused });
        }
      }
      // Keyboard away, then the button (the keyboard can cover it).
      await byTestId(d, "VettingSeatBanner").click().catch(() => undefined);
      await sleep(800);
      await scrollToTestId(d, "VettingRequestButton", 4);
      const cardBefore = await byTestId(d, "VettingRequestCard").isExisting().catch(() => false);
      const statusBefore = await textOf(d, "VettingRequestStatus").catch(() => "");
      await tapTestIdReliable(
        d,
        "VettingRequestButton",
        async () => {
          const card = await byTestId(d, "VettingRequestCard").isExisting().catch(() => false);
          if (!cardBefore) return card;
          return (await textOf(d, "VettingRequestStatus").catch(() => "")) !== statusBefore;
        },
        { attempts: 4, settleMs: 3000 }
      );
      const status = await textOf(d, "VettingRequestStatus").catch(() => "");
      return { observed: { requestStatus: status, via } };
    });
  },

  /** The vetter accepted the request. A refusal or a decline fails, naming it. */
  awaitAccepted(d, { timeoutMs = 120000 } = {}, opts = {}) {
    return runStep(d, "applicant", "awaitAccepted", opts, async () => {
      const status = await awaitText(d, "VettingRequestStatus", /Accepted|Refused|Declined/i, timeoutMs);
      if (!/Accepted/i.test(status)) throw failWith(`the request was answered "${status}"`, { requestStatus: status });
      return { observed: { requestStatus: status } };
    });
  },

  /** The session is open: the match code the applicant reads out. */
  readMatchCode(d, { timeoutMs = 120000 } = {}, opts = {}) {
    return runStep(d, "applicant", "readMatchCode", opts, async () => {
      await awaitStep(d, "applicant", "match", timeoutMs, () => applicantEvidence(d));
      await scrollToTestId(d, "VettingMatchCode", 6, LOW).catch(() => undefined);
      const code = (await awaitText(d, "VettingMatchCode", /[0-9A-Z]{4}-[0-9A-Z]{4}/, 30000)).trim();
      return { value: code };
    });
  },

  /**
   * The vetter reopened the session (plan F4): a new session document, so a
   * new match code, and a card for the old session is no longer accepted
   * (openvtc vetter.rs open_session / receive_card at 177a218). The value is
   * the new code; the page must be back on "match", not left on "checking".
   */
  awaitMatchCodeChange(d, { from, timeoutMs = 120000 } = {}, opts = {}) {
    return runStep(d, "applicant", "awaitMatchCodeChange", opts, async () => {
      if (!from) throw new Error("awaitMatchCodeChange needs the code it should change from");
      const until = Date.now() + timeoutMs;
      let last = from;
      while (Date.now() < until) {
        await scrollToTestId(d, "VettingMatchCode", 3, LOW).catch(() => undefined);
        last = (await textOf(d, "VettingMatchCode").catch(() => "")).trim();
        if (/[0-9A-Z]{4}-[0-9A-Z]{4}/.test(last) && last !== from) {
          await awaitStep(d, "applicant", "match", 30000, () => applicantEvidence(d));
          return { value: last, observed: { previous: from } };
        }
        await sleep(2500);
      }
      throw failWith(`the match code never changed from ${from} (last seen "${last}")`, { ...(await applicantEvidence(d)), matchCode: last });
    });
  },

  /** "Codes match" moves to sending the card; "Codes differ" ends the session. */
  confirmMatch(d, { match = true } = {}, opts = {}) {
    return runStep(d, "applicant", "confirmMatch", opts, async () => {
      const key = match ? "VettingCodesMatch" : "VettingCodesDiffer";
      await scrollToTestId(d, key, 4, LOW);
      if (match) {
        await tapTestIdReliable(d, key, async () => (await stepIdOf(d, "applicant")) === "send");
      } else {
        await tapTestIdReliable(d, key, async () => (await stepIdOf(d, "applicant")) !== "match");
      }
      return {};
    });
  },

  /** Sign and send the card on the open session. Ends waiting for the statement. */
  sendCard(d, opts = {}) {
    return runStep(d, "applicant", "sendCard", opts, async () => {
      await awaitStep(d, "applicant", "send", 30000);
      await scrollToTestId(d, "VettingSendCardButton", 4, LOW);
      await tapTestIdByCoordinates(d, "VettingSendCardButton");
      const cardSentMs = Date.now();
      await sleep(1500);
      await handleBiometricConfirmIfPresent(d);
      await awaitStep(d, "applicant", ["checking", "apply"], 60000, () => applicantEvidence(d));
      const cardSentAt = await textOf(d, "VettingCardSentAt").catch(() => "");
      // The value is when the card went, for awaitStatement's cardSentMs.
      return { value: { cardSentMs }, observed: { cardSentAt } };
    });
  },

  /**
   * The vetter's statement arrives and counts: the page leaves "checking" and
   * the checklist meets the published requirements. On the deadline it fails
   * as "stuck at checking for N s", with the request's status and the
   * checklist — the exact state a maintainer's phone was left in (2026-09-25).
   */
  awaitStatement(d, { timeoutMs = 300000, cardSentMs } = {}, opts = {}) {
    return runStep(d, "applicant", "awaitStatement", opts, async () => {
      // An openvtc vetter refuses a card older than 15 minutes, and refuses it
      // silently (verify_card, card.rs:42 at vta-sdk 0.42.1): past that, no
      // statement can come for this card, so the record says how old it was.
      const evidence = async () => ({
        ...(await applicantEvidence(d)),
        ...(cardSentMs ? { cardAgeSeconds: Math.round((Date.now() - cardSentMs) / 1000), cardLifetimeSeconds: 900 } : {}),
      });
      // A statement that arrived and could not be kept stays on "checking"
      // but says so (keyring-bifold#116): fail on it at once, with its reason,
      // rather than wait out the deadline for a statement that already came.
      const until = Date.now() + timeoutMs;
      for (;;) {
        const at = await stepIdOf(d, "applicant");
        if (at === "apply" || at === "member") break;
        if (!at && (await existsTestId(d, "EnterPIN", 500))) {
          // The inactivity lock, not a navigation: unlock and keep waiting.
          await unlockIfLocked(d);
          continue;
        }
        if (await existsTestId(d, "VettingStatementRefused", 500)) {
          const reason = await textOf(d, "VettingStatementRefusedDetails").catch(() => "");
          throw failWith(`the statement arrived and was refused${reason ? `: ${reason}` : ""}`, { ...(await evidence()), statementRefused: reason || true });
        }
        await throwIfEnvelopeRefused(d, evidence);
        if (Date.now() > until) await awaitStep(d, "applicant", ["apply", "member"], 0, evidence);
        await sleep(2000);
      }
      const checklist = await awaitText(d, "VettingChecklist", /meets the published requirements|statements?/i, 30000);
      if (!/meets the published requirements/.test(checklist)) {
        throw failWith(`the statement arrived but the checklist does not meet the requirements: "${checklist}"`, { checklist });
      }
      const grantUnchecked = await byTestId(d, "VettingGrantUnchecked").isExisting().catch(() => false);
      return { observed: { checklist, grantChecked: !grantUnchecked } };
    });
  },

  /**
   * Apply with the statements held. The value is what the SCREEN says
   * (member | deferred | pending | other); the caller asserts it against the
   * community's own records (joinOutcome.js), never on its own.
   */
  apply(d, { timeoutMs = 120000 } = {}, opts = {}) {
    return runStep(d, "applicant", "apply", opts, async () => {
      await awaitStep(d, "applicant", "apply", 30000);
      await scrollToTestId(d, "VettingApplyButton", 4, LOW);
      await tapTestIdByCoordinates(d, "VettingApplyButton");
      await sleep(1500);
      await handleBiometricConfirmIfPresent(d);
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        if ((await stepIdOf(d, "applicant")) === "member") {
          await scrollToTestId(d, "VettingAlreadyMember", 8, { ...LOW, direction: "up" }).catch(() => undefined);
          return { value: "member", observed: { line: await textOf(d, "VettingAlreadyMember").catch(() => "") } };
        }
        const state = await textOf(d, "VettingSubmissionState").catch(() => "");
        if (/asked for more|deferred/i.test(state)) return { value: "deferred", observed: { line: state } };
        if (/pending|waiting/i.test(state)) return { value: "pending", observed: { line: state } };
        await sleep(3000);
      }
      throw failWith("no outcome on screen after Apply", await applicantEvidence(d));
    });
  },
};

// ---------------------------------------------------------------- vetter

export const vetter = {
  /**
   * Into the vetter's desk, ready for a new ticket: ends a session an earlier
   * run left open, publishes the vetter's profile (a vetter with none is not
   * listed), and clears a finished request from the desk.
   */
  openDesk(d, opts = {}) {
    return runStep(d, "vetter", "openDesk", opts, async () => {
      await openVetting(d);
      for (let i = 0; i < 3; i++) {
        let ended = false;
        for (const key of ["VettingCodesDiffer", "VettingEndSession"]) {
          if (await byTestId(d, key).isExisting().catch(() => false)) {
            await tapTestIdByCoordinates(d, key);
            await sleep(3000);
            ended = true;
            break;
          }
        }
        if (!ended) break;
      }
      await waitForTestId(d, "VettingYouVetFor", 120000);
      const publish = await scrollToTestId(d, "VettingPublishProfileButton", 6).catch(() => undefined);
      if (publish) {
        const enabledBy = Date.now() + 60000;
        while (Date.now() < enabledBy && !(await publish.isEnabled().catch(() => false))) await sleep(1000);
        await tapTestIdReliable(d, "VettingPublishProfileButton", () => byTestId(d, "VettingProfilePublished").isExisting().catch(() => false), {
          attempts: 4,
          settleMs: 5000,
        });
      }
      if (await byTestId(d, "VettingVetSomeoneElse").isExisting().catch(() => false)) {
        await tapTestIdByCoordinates(d, "VettingVetSomeoneElse");
        await sleep(1500);
      }
      const clear = await scrollToTestId(d, "VettingDeskClearButton", 4).catch(() => undefined);
      if (clear) {
        await tapTestIdByCoordinates(d, "VettingDeskClearButton");
        await sleep(2500);
      }
      await awaitStep(d, "vetter", "ticket", 30000);
      const youVetFor = await textOf(d, "VettingYouVetFor").catch(() => "");
      return { observed: { youVetFor } };
    });
  },

  /** A new ticket; the value is its `vetting-ticket:` link, as the QR carries it. */
  issueTicket(d, opts = {}) {
    return runStep(d, "vetter", "issueTicket", opts, async () => {
      await scrollToTestId(d, "VettingNewTicketButton", 6, { direction: "up" }).catch(() => undefined);
      await waitForTestId(d, "VettingNewTicketButton", 20000);
      await tapTestIdReliable(
        d,
        "VettingNewTicketButton",
        async () => {
          await scrollToTestId(d, "VettingTicketLink", 4).catch(() => undefined);
          return byTestId(d, "VettingTicketLink").isExisting().catch(() => false);
        },
        { attempts: 4, settleMs: 3000 }
      );
      await scrollToTestId(d, "VettingTicketLink", 4).catch(() => undefined);
      const link = (await textOf(d, "VettingTicketLink")).trim();
      if (!link.startsWith("vetting-ticket:")) throw failWith(`no ticket link on the desk: "${link.slice(0, 60)}"`, { ticketLink: link });
      await scrollToTestId(d, "VettingTicketCode", 4, { direction: "up" }).catch(() => undefined);
      const code = (await textOf(d, "VettingTicketCode").catch(() => "")).trim();
      return { value: link, observed: { ticketCode: code, length: link.length } };
    });
  },

  /** A request arrived on the ticket: the desk offers to open a session. */
  awaitRequest(d, { timeoutMs = 180000 } = {}, opts = {}) {
    return runStep(d, "vetter", "awaitRequest", opts, async () => {
      await awaitStep(d, "vetter", "request", timeoutMs, async () => ({ desk: await textOf(d, "VettingDeskStatus").catch(() => "") }));
      return {};
    });
  },

  /** Open the session; the value is the match code the vetter reads out. */
  openSession(d, opts = {}) {
    return runStep(d, "vetter", "openSession", opts, async () => {
      const open = await scrollToTestId(d, "VettingOpenSessionButton", 6);
      await tapElement(d, open);
      await awaitStep(d, "vetter", "match", 60000);
      const el = await waitForTestId(d, "VettingMatchCode", 60000);
      const code = ((await el.getAttribute(isIos(d) ? "label" : "text")) || "").trim();
      if (!/[0-9A-Z]{4}-[0-9A-Z]{4}/.test(code)) throw failWith(`no match code on the desk: "${code}"`, { matchCode: code });
      return { value: code };
    });
  },

  /** "Codes match" moves to waiting for the card; "Codes differ" ends it. */
  confirmMatch(d, { match = true } = {}, opts = {}) {
    return runStep(d, "vetter", "confirmMatch", opts, async () => {
      const key = match ? "VettingCodesMatch" : "VettingCodesDiffer";
      await scrollToTestId(d, key, 4);
      await tapTestIdReliable(d, key, async () => (await stepIdOf(d, "vetter")) !== "match");
      return {};
    });
  },

  /** The applicant's card arrived; the value is the claims the desk shows. */
  awaitCard(d, { timeoutMs = 180000 } = {}, opts = {}) {
    return runStep(d, "vetter", "awaitCard", opts, async () => {
      await awaitStep(d, "vetter", "check", timeoutMs);
      let claimEl;
      const until = Date.now() + 60000;
      while (!claimEl && Date.now() < until) {
        claimEl = await scrollToTestId(d, "VettingCardClaim", 3).catch(() => undefined);
        if (!claimEl) await sleep(2000);
      }
      if (!claimEl) throw failWith("on the check step, but no card claim is shown", {});
      const claim = (await claimEl.getAttribute(isIos(d) ? "label" : "text")) || "";
      return { value: claim };
    });
  },

  /** Sign the statement and send it: the desk says it was issued. */
  attest(d, opts = {}) {
    return runStep(d, "vetter", "attest", opts, async () => {
      const button = await scrollToTestId(d, "VettingAttestButton", 6);
      await tapElement(d, button);
      await sleep(1500);
      await handleBiometricConfirmIfPresent(d);
      await awaitStep(d, "vetter", "done", 60000, async () => ({ error: await textOf(d, "VettingError").catch(() => "") }));
      const issued = await textOf(d, "VettingStatementIssued").catch(() => "");
      return { observed: { statementIssued: issued } };
    });
  },
};

// ---------------------------------------------------------------- community (F6/F7)

export const community = {
  /**
   * Leave the community from the phone (members/self-remove). `keep` is the
   * person's choice on the confirmation. The caller checks the community's
   * member list, which is what the plan asserts (F7).
   */
  leave(d, { keep = "purge" } = {}, opts = {}) {
    return runStep(d, "member", "leave", opts, async () => {
      await (await waitForTestId(d, "MyAgent", 30000)).click();
      await sleep(1500);
      if (!(await existsTestId(d, "AgentHome", 3000))) {
        const open = await scrollToTestId(d, "OpenYourAgentButton", 4).catch(() => undefined);
        if (open) await open.click();
      }
      const row = await scrollToTestId(d, "AgentMembershipRow", 6).catch(() => undefined);
      if (!row) throw failWith("the agent screen lists no community membership", {});
      await row.click();
      const leave = await scrollToTestId(d, "LeaveCommunityButton", 6).catch(() => undefined);
      if (!leave) throw failWith("the community screen offers no Leave", {});
      await leave.click();
      await waitForTestId(d, "LeaveCommunityConfirmCard", 10000);
      if (keep === "tombstone") await (await waitForTestId(d, "LeaveCommunityTombstone", 5000)).click();
      await (await scrollToTestId(d, "LeaveCommunityConfirm", 4)).click();
      // What the community applied, as the app says it (the toast), read the
      // platform's way at once: the toast does not wait for a slow lookup.
      let words = "";
      for (const until = Date.now() + 60000; Date.now() < until && !words; ) {
        if (await existsTestId(d, "ToastTitle", 2000)) {
          const title = byTestId(d, "ToastTitle");
          words = ((await (isIos(d) ? title.getAttribute("label") : title.getText()).catch(() => "")) || "").trim();
        } else if (await existsTestId(d, "CommunityError", 500)) {
          throw failWith("leaving was refused", { communityError: await textOf(d, "CommunityError").catch(() => "") });
        }
      }
      if (!words) throw failWith("nothing said what happened after Leave", {});
      if (keep === "purge" && !/erased your record|no longer had you/.test(words)) throw failWith(`asked to erase, but the app says "${words}"`, { toast: words });
      await sleep(3000);
      if (await existsTestId(d, "AgentMembershipRow", 3000)) throw failWith("the phone still lists the community after Leave", { toast: words });
      return { value: keep, observed: { toast: words } };
    });
  },
};
