/**
 * Own my agent — the OFFLINE TWIN run (own_agent_subtask.md §1, §4, §8).
 *
 * The Farm is replaced by a dedicated lab VTA (scripts/openvtc/own-agent-twin,
 * default `carol`) whose admin is whatever DID the phone shows — admitted with
 * `vta import-did --role admin`, the command upstream's guide pairs with the
 * Farm's "Admin DID → Provision agent" (admit-owner.sh). Then:
 *
 *   1 createAgent   owner phone: address first, then its owner code (its key)
 *   2 admit         harness: admit-owner.sh <that key>   (the Farm stand-in)
 *   3 connect       owner phone: sign in as the key, swap onto a long-term key
 *                   ACL: the long-term key is an unrestricted permanent admin;
 *                   the temporary key is gone
 *   4 backupLink    backup phone: address (the owner's QR, pasted here), then
 *                   its own code — no QR on either side
 *   5 ownerGrants   owner phone: scans the backup's code → acl/grant/0.1
 *                   PENDING: not implemented in the app yet (throws)
 *   6 backupFinish  backup phone: sign in, swap; ACL: a second owner row
 *   7 removeOwner   backup phone: removes the first phone
 *                   PENDING: not implemented in the app yet (throws)
 *                   ACL: the owner phone's key is gone, the backup's remains
 *
 * Also checked on the way (the release gate's §1): the empty state is saved
 * (screenshot + page source) for scripts/replay-filled.mjs; Copy puts exactly
 * the code shown on the clipboard; Share opens the system sheet; with the
 * keyboard up the step's button is in view (E2E_KEYBOARD_UP); and on the
 * backup's device list "This phone" has no Remove while the other phone has
 * one. The app moves on by itself once the agent admits a code, so the admit
 * and connect checks accept a phone that is already past them.
 *
 * The screens of §7 do not exist yet. Where a new screen's testID is not on the
 * phone, the step drives today's "Link without a QR code" machinery instead and
 * says so; each such place carries a `TODO(own-agent §7)` naming the future
 * testIDs (docs/plans/keyring-on-the-vta-farm/2026-09-25-uiux.md, "Test IDs").
 *
 * Usage (lab stack up, twin up — see scripts/openvtc/own-agent-twin/README.md):
 *
 *   OWNER_PLATFORM=android OWNER_UDID=emulator-5554 \
 *   BACKUP_PLATFORM=ios BACKUP_UDID=<simulator udid> \
 *     node run-own-agent.js
 *
 *   SKIP_BACKUP=1               steps 1–3 only (one device)
 *   E2E_BACKUP_GRANT=harness    step 5 done by the harness (pnm acl create) in
 *                               place of the owner phone, so 6 can run today.
 *                               It proves nothing about the owner phone's grant.
 *   E2E_FRESH_INSTALL=1         install the app fresh (default: drive what is
 *                               installed, noReset; a phone with no wallet is
 *                               onboarded, a phone already linked is refused)
 *   E2E_KEYBOARD_UP=1           fail when the keyboard hides a step's button
 *                               (iOS; recorded with a screenshot either way)
 *   E2E_ACL_CLEANUP=always|never   default: reset.sh after a pass, keep the
 *                               rows as evidence after a failure
 *   TWIN_ENV=~/vti-stack/carol/twin.env
 *
 * Exit: 0 pass · 1 fail · 3 reached a step the app does not implement yet.
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { byTestId, dumpSource, ensureAppium, existsTestId, screenshot, scrollToTestId, sleep, stopAppium, tapTestId, waitForTestId } from "./lib/driver.js";
import { completeOnboarding, dismissTourIfPresent, handleBiometricConfirmIfPresent } from "./lib/flows.js";
import { makeDriver, startDeviceLog, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { printFailure, printSuccess } from "./lib/banner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const TWIN_DIR_SCRIPTS = path.resolve(here, "../scripts/openvtc/own-agent-twin");
const ARTIFACTS = path.resolve(here, "artifacts");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

// ---------------------------------------------------------------- the twin

const TWIN_ENV = process.env.TWIN_ENV || path.join(os.homedir(), "vti-stack/carol/twin.env");
const twin = Object.fromEntries(
  readFileSync(TWIN_ENV, "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
if (!twin.TWIN_VTA_DID?.startsWith("did:")) throw new Error(`${TWIN_ENV} names no TWIN_VTA_DID — run twin-vta.sh up`);
// The lab's shared agents are never the twin: alice is a person's, bob the
// other runners'. The scripts refuse them too; say it here before any phone moves.
if (["alice", "bob", "community"].includes(twin.TWIN_SLUG)) throw new Error(`refusing: ${twin.TWIN_SLUG} is a shared lab agent, not the twin`);
const AGENT_DID = twin.TWIN_VTA_DID;
const twinEnv = { ...process.env, TWIN_NAME: twin.TWIN_SLUG, TWIN_PORT: twin.TWIN_PORT };

const sh = (script, args = [], opts = {}) =>
  execFileSync("bash", [path.join(TWIN_DIR_SCRIPTS, script), ...args], { encoding: "utf8", env: twinEnv, ...opts });

/** The twin's ACL, full entries (show-acl.sh --json). */
const acl = () => JSON.parse(sh("show-acl.sh", ["--json"]));
const baseline = () => new Set(JSON.parse(readFileSync(path.join(twin.TWIN_DIR, "acl-baseline.json"), "utf8")).map((e) => e.subject));
const contextsOf = (e) => e.contexts ?? e.scopes ?? [];
const isOwnerRow = (e) => e && e.role === "admin" && contextsOf(e).length === 0 && !e.expiresAt;

/** The rows reachable from `did` by createdBy (a swap keeps the chain). */
function chainFrom(entries, did) {
  const mine = new Set([did]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of entries) if (!mine.has(e.subject) && mine.has(e.createdBy)) mine.add(e.subject), (grew = true);
  }
  return entries.filter((e) => mine.has(e.subject));
}

/**
 * After a swap: `tempDid` is gone, and exactly one row it created holds an
 * unrestricted, permanent admin grant. Returns that row's DID.
 */
function assertSwappedToOwner(tempDid, who) {
  const entries = acl();
  if (entries.some((e) => e.subject === tempDid)) throw new Error(`${who}: the temporary key ${tempDid} is still in the ACL`);
  const created = entries.filter((e) => e.createdBy === tempDid);
  if (created.length !== 1) throw new Error(`${who}: expected one long-term key created by the temporary key, found ${created.length}`);
  const row = created[0];
  if (!isOwnerRow(row)) {
    throw new Error(`${who}: the long-term key is not an unrestricted permanent admin: ${JSON.stringify({ role: row.role, contexts: contextsOf(row), expiresAt: row.expiresAt })}`);
  }
  console.log(`[acl] ${who}: temporary key gone; long-term ${row.subject.slice(0, 40)}… is an unrestricted, permanent admin`);
  return row.subject;
}

// ---------------------------------------------------------------- pending app work

/** A step the app does not implement yet: the run stops here, exit 3. */
class PendingAppStep extends Error {
  constructor(step, what) {
    super(`${step}: not implemented in the app yet — ${what}`);
    this.name = "PendingAppStep";
  }
}

// ---------------------------------------------------------------- phone helpers

/** Swipe the content up from mid-screen (the fixed footer scrolls nothing). */
async function swipeUp(d) {
  const { width, height } = await d.getWindowRect();
  await d
    .action("pointer")
    .move({ x: Math.floor(width / 2), y: Math.floor(height * 0.5) })
    .down()
    .pause(100)
    .move({ x: Math.floor(width / 2), y: Math.floor(height * 0.25), duration: 400 })
    .up()
    .perform()
    .catch(() => undefined);
  await sleep(600);
}


// ------------------------------------------------ the owner checks' prompt
//
// Owner acts ask the phone's own lock (react-native-keychain,
// BIOMETRY_ANY_OR_DEVICE_PASSCODE; core module/ownerConfirm.ts). A device with
// no lock refuses "Create my agent", so the owner device gets one for the run:
// a PIN on an Android emulator, an enrolled Face ID on an iOS simulator. The
// prompt is answered the way a person would: the PIN typed, a face matched.

const OWNER_PIN = process.env.OWNER_PIN || "1111";

function adb(udid, ...args) {
  return execFileSync("adb", ["-s", udid, ...args], { encoding: "utf8" });
}

/** Give the device a lock the owner checks can use; returns an undo. */
function ownerLockSetup(platform, udid) {
  if (!udid) throw new Error(`${platform}: the owner device needs a udid, to give it a screen lock`);
  if (platform === "android") {
    adb(udid, "shell", "locksettings", "set-pin", OWNER_PIN);
    return () => {
      try {
        adb(udid, "shell", "locksettings", "clear", "--old", OWNER_PIN);
      } catch (e) {
        console.log(`[lock] could not clear the emulator PIN: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
    };
  }
  execFileSync("xcrun", ["simctl", "spawn", udid, "notifyutil", "-s", "com.apple.BiometricKit.enrollmentChanged", "1"]);
  execFileSync("xcrun", ["simctl", "spawn", udid, "notifyutil", "-p", "com.apple.BiometricKit.enrollmentChanged"]);
  return () => undefined;
}

/** Answer the owner prompt if one comes up within `ms`: the PIN on Android, a face match on iOS. */
/**
 * With the keyboard up, is the step's button in view? Recorded always, with a
 * screenshot; E2E_KEYBOARD_UP=1 makes it a failure (builds before
 * keyring-bifold#151 hid it on iOS).
 */
async function keyboardUp(d, shot, buttonId) {
  await screenshot(d, shot);
  const visible = (await byTestId(d, buttonId).getAttribute("visible").catch(() => "false")) === "true";
  console.log(`[e2e] keyboard up: ${buttonId} ${visible ? "in view" : "HIDDEN behind the keyboard"}`);
  if (!visible && process.env.E2E_KEYBOARD_UP === "1") throw new Error(`the keyboard hides ${buttonId}`);
}

/** Put known text on the phone's clipboard, so a Copy that does nothing cannot pass. */
async function setClipboardText(d, text) {
  await d.setClipboard(Buffer.from(text).toString("base64"), "plaintext").catch(() => undefined);
}

async function answerOwnerPrompt(platform, udid, ms = 20000) {
  if (!udid) return;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (platform === "android") {
      const focus = adb(udid, "shell", "dumpsys", "window").split("\n").find((l) => l.includes("mCurrentFocus")) || "";
      if (/systemui|ConfirmDeviceCredential|BiometricPrompt|settings\/.*Confirm/i.test(focus)) {
        await sleep(800);
        adb(udid, "shell", "input", "text", OWNER_PIN);
        adb(udid, "shell", "input", "keyevent", "66");
        console.log("[lock] answered the owner prompt with the PIN");
        await sleep(1500);
        return;
      }
    } else {
      execFileSync("xcrun", ["simctl", "spawn", udid, "notifyutil", "-p", "com.apple.BiometricKit_Sim.pearl.match"]);
    }
    await sleep(1000);
  }
}


/** The phone names its own entry "Keyring — <device name>" in the background after the swap. */
async function assertLabelled(did, who, ms = 30000) {
  for (const until = Date.now() + ms; Date.now() < until; await sleep(2000)) {
    const row = acl().find((e) => e.subject === did);
    if (row?.label?.startsWith("Keyring")) {
      console.log(`[acl] ${who}: its entry is labelled "${row.label}"`);
      return row.label;
    }
  }
  throw new Error(`${who}: its access entry was not labelled "Keyring…" within ${ms / 1000} s (label: ${JSON.stringify(acl().find((e) => e.subject === did)?.label)})`);
}

/** A phone ready to start: unlocked at home with no agent, or onboarded fresh. */
async function readyPhone(d, name) {
  // A fresh install's first launch can take well past a few seconds to show
  // its first screen (2026-09-25: "Get Started" came after the 8 s check, and
  // the run took the already-onboarded path). Wait for whichever comes first.
  let fresh = false;
  for (const until = Date.now() + 90000; Date.now() < until; ) {
    if (await existsTestId(d, "GetStarted", 1500)) { fresh = true; break; }
    if ((await existsTestId(d, "EnterPIN", 1000)) || (await existsTestId(d, "Contacts", 1000))) break;
  }
  if (fresh) {
    await completeOnboarding(d, { firstName: name, lastName: "Twin" });
  } else {
    await unlockToHome(d);
  }
  await dismissTourIfPresent(d);
  await (await waitForTestId(d, "MyAgent", 30000)).click();
  await sleep(1500);
  if ((await existsTestId(d, "AgentHome", 2000)) || (await existsTestId(d, "OpenYourAgentButton", 2000))) {
    throw new Error(`NOT FRESH: the ${name} phone already has an agent — unlink it (or E2E_FRESH_INSTALL=1) and run reset.sh`);
  }
}

/**
 * Bring the agent's address and reveal this phone's code. New screens when the
 * build has them, else today's "Link without a QR code". Returns the key shown.
 */
async function addressThenCode(d, { owner }) {
  // TODO(own-agent §7): owner path = AgentCreate → AgentCreateIntro →
  //   AgentCreateContinue → AgentCreateAddress (+ AgentCreatePasteAddress /
  //   AgentCreateScanAddress) → AgentCreateAddressContinue → AgentCreateOwnerCode
  //   → AgentCreateShowCode → AgentCreateOwnerDid. Errors: AgentCreateError.
  if (owner && (await existsTestId(d, "AgentCreate", 2000))) {
    // Release gate §1: the empty state, for replay-filled ("Claim your agent" is its one filled button).
    await sleep(1500);
    await screenshot(d, "own-agent-00-claim");
    await dumpSource(d, "own-agent-00-claim");
    await tapTestId(d, "AgentCreate", 15000);
    await waitForTestId(d, "AgentCreateIntro", 15000);
    await tapTestId(d, "AgentCreateContinue", 15000);
    const addressField = (await existsTestId(d, "AgentCreateAddressInput", 5000)) ? "AgentCreateAddressInput" : "AgentCreateAddress";
    await (await waitForTestId(d, addressField, 15000)).setValue(AGENT_DID);
    // The keyboard is up on iOS here: the step's button must still be in view
    // (it was not before keyring-bifold#151). Return runs the step since then.
    if (OWNER_PLATFORM === "ios") {
      await keyboardUp(d, "own-agent-00b-address-keyboard", "AgentCreateAddressContinue");
      await (await waitForTestId(d, addressField, 5000)).addValue("\n");
      await sleep(1500);
    }
    if (await existsTestId(d, "AgentCreateAddressContinue", 1000)) await tapTestId(d, "AgentCreateAddressContinue", 15000);
    if (await existsTestId(d, "AgentCreateError", 3000)) throw new Error(`address refused: ${await textOf(d, "AgentCreateError")}`);
    await waitForTestId(d, "AgentCreateOwnerCode", 60000);
    await handleBiometricConfirmIfPresent(d); // making the code asks for Face ID (§3)
    if (!(await existsTestId(d, "AgentCreateOwnerDid", 2000))) {
      const show = await scrollToTestId(d, "AgentCreateShowCode", 4).catch(() => undefined);
      if (show) await show.click();
      await answerOwnerPrompt(OWNER_PLATFORM, process.env.OWNER_UDID);
    }
    await waitForTestId(d, "AgentCreateOwnerDid", 15000);
    const shown = (await textOf(d, "AgentCreateOwnerDid")).trim();
    // Release gate §1: Copy puts exactly the code shown on the clipboard; Share opens the system sheet.
    await setClipboardText(d, "gate-before-copy");
    await tapTestId(d, "AgentCreateCopyCode", 15000);
    await answerOwnerPrompt(OWNER_PLATFORM, process.env.OWNER_UDID, 4000);
    await sleep(1500);
    const copied = Buffer.from(await d.getClipboard("plaintext"), "base64").toString("utf8").trim();
    console.log(`[e2e] copy: clipboard ${copied === shown ? "EQUALS" : "DIFFERS FROM"} the code shown (${copied.slice(0, 24)}…)`);
    if (copied !== shown) throw new Error(`Copy put "${copied.slice(0, 40)}" on the clipboard, not the code shown`);
    await tapTestId(d, "AgentCreateShareCode", 15000);
    await answerOwnerPrompt(OWNER_PLATFORM, process.env.OWNER_UDID, 4000);
    await sleep(2500);
    await screenshot(d, "own-agent-01b-share-sheet");
    const sheet = await d.getPageSource();
    const sheetUp = OWNER_PLATFORM === "android" ? /com\.android\.intentresolver|android:id\/resolver|chooser/i.test(sheet) : /ActivityListView|XCUIElementTypeCollectionView[^>]*/.test(sheet) && /Copy|Close/.test(sheet);
    console.log(`[e2e] share: system sheet ${sheetUp ? "open" : "NOT FOUND"}`);
    if (!sheetUp) throw new Error("Share did not open the system share sheet");
    if (OWNER_PLATFORM === "android") await d.back();
    else {
      // The iOS sheet has no Close: a person taps the dimmed page above it.
      const { width, height } = await d.getWindowSize();
      await d.performActions([{ type: "pointer", id: "tap", parameters: { pointerType: "touch" }, actions: [
        { type: "pointerMove", duration: 0, x: Math.round(width / 2), y: Math.round(height * 0.12) },
        { type: "pointerDown", button: 0 }, { type: "pause", duration: 80 }, { type: "pointerUp", button: 0 } ] }]);
      await d.releaseActions().catch(() => undefined);
    }
    await sleep(1500);
    const still = /ActivityListView|Save to Files/.test(await d.getPageSource());
    if (still) throw new Error("the share sheet did not close");
    await waitForTestId(d, "AgentCreateOwnerDid", 15000);
    return shown;
  }
  console.log(`[e2e] ${owner ? "owner" : "backup"}: ${owner ? "no AgentCreate on this build — " : ""}today's "Link without a QR code"`);
  // TODO(own-agent §7): backup path = LinkYourAgentButton ("I already have one
  //   — link it") → Link without a QR code → scan the owner's AgentBackupAddressQr.
  //   A simulator cannot scan another screen, so the harness pastes the same
  //   address the QR carries.
  await tapTestId(d, "LinkWithoutQrButton", 30000);
  if (!(await existsTestId(d, "VtaLinkAgentAddress", 2000))) await tapTestId(d, "VtaLinkWithoutQr", 15000).catch(() => undefined);
  await (await waitForTestId(d, "VtaLinkAgentAddress", 15000)).setValue(`${AGENT_DID}\n`);
  // The key sits behind "Show the code" (older builds: "Show my code"), below
  // the fold on Android; tap each toggle as it appears until the key shows.
  const by = Date.now() + 60000;
  const tapped = new Set();
  while (!(await existsTestId(d, "VtaLinkManualDid", 1500)) && Date.now() < by) {
    let found = false;
    for (const key of ["VtaLinkShowTheCode", "VtaLinkShowMyCode"]) {
      if (tapped.has(key) || !(await byTestId(d, key).isExisting().catch(() => false))) continue;
      found = true;
      await swipeUp(d);
      const el = await scrollToTestId(d, key, 4, { from: 0.5 }).catch(() => undefined);
      if (el) await el.click().catch(() => undefined);
      tapped.add(key);
      break;
    }
    if (!found) await swipeUp(d);
  }
  await waitForTestId(d, "VtaLinkManualDid", 5000);
  return (await textOf(d, "VtaLinkManualDid")).trim();
}

/** "It's online — connect" / "I've been added": sign in, swap, until linked. */
async function connect(d, who) {
  // TODO(own-agent §7): AgentCreateConnect → AgentCreateProgress with
  //   AgentCreateStep_signIn / _owner / _ready → AgentBackup (step 5).
  //   "Not admitted yet" is AgentCreateError; fail fast on it.
  // With auto-detect (AgentCreateWaiting) the screen moves on by itself once
  // the agent admits the code; the manual "check now" is only a nudge, and it
  // no longer asks for Face ID (the Copy/Share did, once per visit).
  // The app watches for the admit and moves on by itself, so by the time this
  // looks it may be waiting, mid-swap, or already done: poll for any of them.
  let waiting = false;
  for (const by = Date.now() + 60000; Date.now() < by; ) {
    if (await existsTestId(d, "AgentBackup", 700)) return "AgentBackup";
    if (await existsTestId(d, "AgentCreateReady", 700)) return "AgentCreateReady";
    if (await existsTestId(d, "AgentCreateError", 300)) throw new Error(`${who}: ${await textOf(d, "AgentCreateError")}`);
    waiting = await existsTestId(d, "AgentCreateWaiting", 700);
    if (waiting || (await existsTestId(d, "AgentCreateConnect", 300)) || (await existsTestId(d, "VtaLinkCheckGrant", 300))) break;
  }
  if (waiting || (await existsTestId(d, "AgentCreateConnect", 1000))) {
    if (!waiting) {
      await tapTestId(d, "AgentCreateConnect", 15000);
      await answerOwnerPrompt(OWNER_PLATFORM, process.env.OWNER_UDID, 8000);
      await handleBiometricConfirmIfPresent(d);
    }
    const by = Date.now() + 180000;
    while (Date.now() < by) {
      if (await existsTestId(d, "AgentCreateError", 1000)) throw new Error(`${who}: ${await textOf(d, "AgentCreateError")}`);
      if (await existsTestId(d, "AgentBackup", 1000)) return "AgentBackup";
      // Setup without a backup step (Alberto, 2026-09-25) ends on Ready.
      if (await existsTestId(d, "AgentCreateReady", 500)) return "AgentCreateReady";
      if (await existsTestId(d, "AgentCreateCheckAgain", 500)) await tapTestId(d, "AgentCreateCheckAgain", 5000);
      await sleep(1500);
    }
    throw new Error(`${who}: Connecting never reached "Add a backup" or Ready`);
  }
  await tapTestId(d, "VtaLinkCheckGrant", 15000);
  await handleBiometricConfirmIfPresent(d);
  await waitForTestId(d, "VtaLinkDone", 180000);
  await screenshot(d, `own-agent-${who}-linked`);
  await tapTestId(d, "VtaLinkContinue", 15000);
  if (await existsTestId(d, "AgentIntro", 15000)) for (let i = 0; i < 3; i++) await tapTestId(d, "AgentIntroNext", 15000);
  await waitForTestId(d, "AgentHome", 30000);
  return "AgentHome";
}

// ---------------------------------------------------------------- the run

const OWNER_PLATFORM = process.env.OWNER_PLATFORM || process.env.PLATFORM || "android";
const BACKUP_PLATFORM = process.env.BACKUP_PLATFORM || "ios";
const SKIP_BACKUP = process.env.SKIP_BACKUP === "1";
const BACKUP_GRANT = process.env.E2E_BACKUP_GRANT || "app";
const FRESH = process.env.E2E_FRESH_INSTALL === "1";
const record = { runId: RUN_ID, agent: AGENT_DID, twin: twin.TWIN_SLUG, steps: [] };
const step = (name, data = {}) => {
  record.steps.push({ step: name, at: new Date().toISOString(), ...data });
  console.log(`[e2e] ✓ ${name}${Object.keys(data).length ? " " + JSON.stringify(data) : ""}`);
};

let owner;
let backup;
let undoLock;
const logs = [];
let outcome = "fail";
try {
  // Preflight: the twin is up and holds only its baseline, so every row the
  // assertions look at is this run's.
  const extra = acl().filter((e) => !baseline().has(e.subject));
  if (extra.length && process.env.E2E_ALLOW_DIRTY !== "1") {
    throw new Error(`NOT FRESH: ${twin.TWIN_SLUG} holds ${extra.length} row(s) from an earlier run — scripts/openvtc/own-agent-twin/reset.sh`);
  }

  await ensureAppium();
  const keepState = !FRESH;
  undoLock = ownerLockSetup(OWNER_PLATFORM, process.env.OWNER_UDID);
  owner = await makeDriver({ platform: OWNER_PLATFORM, udid: process.env.OWNER_UDID, keepState });
  if (process.env.OWNER_UDID) logs.push(startDeviceLog({ platform: OWNER_PLATFORM, udid: process.env.OWNER_UDID, file: path.join(ARTIFACTS, `own-agent-${RUN_ID}-owner.log`) }));
  await readyPhone(owner, "Owner");

  // 1 — create my agent: the address, then this phone's owner code.
  const ownerTemp = await addressThenCode(owner, { owner: true });
  record.ownerTemp = ownerTemp;
  await screenshot(owner, "own-agent-01-owner-code");
  step("createAgent", { ownerTemp: `${ownerTemp.slice(0, 32)}…` });

  // 2 — the Farm stand-in: the pasted Admin DID becomes an unrestricted admin.
  console.log(sh("admit-owner.sh", [ownerTemp]));
  // The app watches for the admit and swaps at once: on a fast phone the
  // temporary key is already gone when this reads the ACL (225 gate, iOS
  // owner). A long-term owner row the temporary key created proves the admit too.
  let admitted;
  try {
    admitted = execFileSync("bash", [path.join(TWIN_DIR_SCRIPTS, "show-acl.sh"), "--owner", ownerTemp], { encoding: "utf8", env: twinEnv });
  } catch (err) {
    const swapped = acl().find((e) => e.createdBy === ownerTemp && isOwnerRow(e));
    if (!swapped) throw err;
    admitted = `admitted, and already swapped by the app: ${swapped.subject.slice(0, 32)}… created by the temporary key`;
  }
  step("admit", { acl: admitted.trim() });

  // 3 — connect: sign in as that key, swap onto the long-term key.
  const landed = await connect(owner, "owner");
  const ownerKey = assertSwappedToOwner(ownerTemp, "owner");
  record.ownerLabel = await assertLabelled(ownerKey, "owner");
  record.ownerKey = ownerKey;
  step("connect", { landed, ownerKey: `${ownerKey.slice(0, 32)}…` });

  if (SKIP_BACKUP) {
    outcome = "pass";
    printSuccess("OWN AGENT (twin) — created, admitted, connected, swapped to an owner key");
  } else {
    const undoOwnerLock = undoLock;
    const undoBackupLock = ownerLockSetup(BACKUP_PLATFORM, process.env.BACKUP_UDID);
    undoLock = () => {
      undoOwnerLock?.();
      undoBackupLock();
    };
    backup = await makeDriver({ platform: BACKUP_PLATFORM, udid: process.env.BACKUP_UDID, keepState });
    if (process.env.BACKUP_UDID) logs.push(startDeviceLog({ platform: BACKUP_PLATFORM, udid: process.env.BACKUP_UDID, file: path.join(ARTIFACTS, `own-agent-${RUN_ID}-backup.log`) }));
    await readyPhone(backup, "Backup");

    // 4 — the owner shows the agent's address; the backup brings it and shows its code.
    // TODO(own-agent §7): owner: AgentBackup → AgentBackupPhone → AgentBackupAddressQr.
    if (await existsTestId(owner, "AgentBackupPhone", 2000)) {
      await tapTestId(owner, "AgentBackupPhone", 15000);
      await waitForTestId(owner, "AgentBackupAddressQr", 15000);
      await screenshot(owner, "own-agent-04-address-qr");
    } else if ((await existsTestId(owner, "AgentCreateReady", 2000)) || (await existsTestId(owner, "AgentHome", 2000))) {
      // No backup step in setup: My Agent → My devices → Add another device.
      if (await existsTestId(owner, "AgentCreateDone", 1500)) await tapTestId(owner, "AgentCreateDone", 15000);
      const row = (await existsTestId(owner, "AgentDevices", 5000)) ? true : await scrollToTestId(owner, "AgentDevices", 4).catch(() => undefined);
      if (!row) throw new PendingAppStep("backupLink", "My Agent has no My devices row on this build");
      await tapTestId(owner, "AgentDevices", 15000);
      await tapTestId(owner, "AgentDeviceAdd", 15000);
      await waitForTestId(owner, "AgentBackupAddressQr", 15000);
      await screenshot(owner, "own-agent-04-address-qr");
    } else {
      console.log('[e2e] owner: no "Add a backup" on this build — the harness hands the backup the address the QR would carry');
    }
    const backupTemp = await addressThenCode(backup, { owner: false });
    record.backupTemp = backupTemp;
    await screenshot(backup, "own-agent-04-backup-code");
    step("backupLink", { backupTemp: `${backupTemp.slice(0, 32)}…` });

    // 5 — the owner phone grants it (acl/grant/0.1: admin, no contexts).
    // TODO(own-agent §7): AgentBackupScanCode (scan or paste) → Face ID → AgentBackupAdded.
    if (BACKUP_GRANT === "harness") {
      console.log("[e2e] E2E_BACKUP_GRANT=harness: the HARNESS grants the backup in place of the owner phone — this proves nothing about the app's grant");
      execFileSync(path.resolve(here, "../scripts/openvtc/pnm-locked"), ["--vta", twin.TWIN_SLUG, "acl", "create", "--did", backupTemp, "--role", "admin", "--label", "backup-harness-standin"], { stdio: "inherit" });
      step("ownerGrants", { by: "harness stand-in" });
    } else if ((await existsTestId(owner, "AgentBackupNext", 2000)) || (await existsTestId(owner, "AgentBackupCodeInput", 2000))) {
      if (await existsTestId(owner, "AgentBackupNext", 1000)) await tapTestId(owner, "AgentBackupNext", 15000);
      // A simulator cannot scan the other phone: paste its code (the screen offers paste, §7 step 5.3).
      await (await waitForTestId(owner, "AgentBackupCodeInput", 15000)).setValue(backupTemp);
      if (OWNER_PLATFORM === "ios") {
        await keyboardUp(owner, "own-agent-05b-backup-code-keyboard", "AgentBackupAdd");
        await (await waitForTestId(owner, "AgentBackupCodeInput", 5000)).addValue("\n");
        await sleep(1500);
      }
      if (await existsTestId(owner, "AgentBackupAdd", 1000)) await tapTestId(owner, "AgentBackupAdd", 15000);
      await answerOwnerPrompt(OWNER_PLATFORM, process.env.OWNER_UDID);
      // Setup's backup step ends on AgentBackupAdded; "Add another device" from
      // My devices goes back to the list, where the new row is the sign.
      const addedRow = `AgentDevice_${backupTemp.slice(-8)}`;
      for (const until = Date.now() + 60000; ; ) {
        if ((await existsTestId(owner, "AgentBackupAdded", 1000)) || (await existsTestId(owner, addedRow, 1000))) break;
        if (await existsTestId(owner, "AgentCreateError", 500)) throw new Error(`adding the backup was refused: ${await textOf(owner, "AgentCreateError")}`);
        if (Date.now() > until) throw new Error(`neither AgentBackupAdded nor ${addedRow} within 60 s`);
      }
      const row = acl().find((e) => e.subject === backupTemp);
      if (!isOwnerRow(row)) throw new Error(`the owner's grant is not an unrestricted admin: ${JSON.stringify(row)}`);
      if (row.createdBy !== ownerKey) throw new Error(`the backup's row was created by ${row.createdBy}, not the owner phone's key`);
      step("ownerGrants", { by: "owner phone" });
    } else {
      throw new PendingAppStep("ownerGrants", "the owner phone has no \"Add a backup\" (acl/grant/0.1) — own_agent_subtask.md §4 step 3");
    }

    // 6 — the backup notices the grant, signs in and swaps: a second owner row.
    await connect(backup, "backup");
    const backupKey = assertSwappedToOwner(backupTemp, "backup");
    record.backupLabel = await assertLabelled(backupKey, "backup");
    const owners = acl().filter((e) => [ownerKey, backupKey].includes(e.subject) && isOwnerRow(e));
    if (owners.length !== 2) throw new Error(`expected two owner rows (owner phone and backup), found ${owners.length}`);
    record.backupKey = backupKey;
    step("backupFinish", { backupKey: `${backupKey.slice(0, 32)}…` });

    // 7 — the backup removes the first phone: My Agent → Devices → Remove on
    //   the owner's row (a fresh owner confirmation first), and the ACL loses it.
    //   testIDs agreed with UI/UX: AgentDevices, AgentDevice_<last 8 of the DID>,
    //   AgentDeviceRemove_<same>, AgentDeviceRemoved.
    // The Devices row sits in AgentHome's top card, after the seat line.
    const devicesRow = (await existsTestId(backup, "AgentDevices", 2000)) ? true : await scrollToTestId(backup, "AgentDevices", 4).catch(() => undefined);
    if (!devicesRow) {
      throw new PendingAppStep("removeOwner", "the backup phone has no way to remove another phone — own_agent_subtask.md §4, D3");
    }
    const tail = ownerKey.slice(-8);
    await tapTestId(backup, "AgentDevices", 15000);
    await waitForTestId(backup, "AgentDeviceList", 30000);
    const row = await waitForTestId(backup, `AgentDevice_${tail}`, 30000).catch(() => scrollToTestId(backup, `AgentDevice_${tail}`, 4));
    if (!row) throw new Error(`the device list shows no row for the owner phone (${tail})`);
    // Release gate §1: "This phone" has no Remove; the other phone has one. Rows are
    // found by what they say: deviceKey (the DID's last 8) is the same for two
    // did:peer:2 keys on one mediator, so a row's testID can name two rows.
    await screenshot(backup, "own-agent-06-devices");
    const android = BACKUP_PLATFORM === "android";
    const txt = android ? "@text" : "@label";
    const idAttr = android ? "@resource-id" : "@name";
    // Android flattens a row: its texts and buttons are siblings of the row
    // view, inside its bounds. So rows are matched to what they hold by geometry.
    const rectOf = async (el) => ({ ...(await el.getLocation()), ...(await el.getSize()) });
    const inside = (r, p) => { const cx = p.x + p.width / 2, cy = p.y + p.height / 2; return cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height; };
    const rows = [];
    for (const el of await backup.$$(`//*[starts-with(${idAttr},"com.ariesbifold:id/AgentDevice_")]`)) rows.push(await rectOf(el));
    const removes = [];
    for (const el of await backup.$$(`//*[starts-with(${idAttr},"com.ariesbifold:id/AgentDeviceRemove_")]`)) removes.push({ el, r: await rectOf(el) });
    const rowWith = async (words) => {
      const t = await backup.$(`//*[${txt}="${words}"]`);
      if (!(await t.isExisting())) return undefined;
      const tr = await rectOf(t);
      return rows.find((r) => inside(r, tr));
    };
    const thisRow = await rowWith("This phone");
    if (!thisRow) throw new Error('the device list has no "This phone" row');
    const otherName = `Keyring — ${OWNER_PLATFORM === "ios" ? "iPhone 17 Pro" : "sdk_gphone64_arm64"}`;
    const otherRow = await rowWith(otherName);
    if (!otherRow) throw new Error(`the device list has no "${otherName}" row`);
    const thisRemoves = removes.filter((b) => inside(thisRow, b.r)).length;
    const otherRemove = removes.filter((b) => inside(otherRow, b.r));
    console.log(`[e2e] devices: "This phone" Remove buttons=${thisRemoves}; "${otherName}" Remove buttons=${otherRemove.length}`);
    if (thisRemoves !== 0) throw new Error("the device list offers Remove on this phone");
    if (otherRemove.length !== 1) throw new Error(`the other phone's row ("${otherName}") has ${otherRemove.length} Remove buttons, not one`);
    const mine = backupKey.slice(-8);
    if (mine === tail) console.log(`[e2e] note: this phone and the other phone share deviceKey "${tail}": two rows carry the same testIDs`);
    await otherRemove[0].el.click();
    await answerOwnerPrompt(BACKUP_PLATFORM, process.env.BACKUP_UDID);
    for (const until = Date.now() + 60000; ; ) {
      if (await existsTestId(backup, "AgentDeviceRemoved", 1500)) break;
      if (await existsTestId(backup, "AgentDeviceError", 500)) throw new Error(`removing the owner phone was refused: ${await textOf(backup, "AgentDeviceError")}`);
      if (Date.now() > until) throw new Error("no AgentDeviceRemoved within 60 s");
    }
    const after = acl();
    if (after.some((e) => e.subject === ownerKey)) throw new Error("the owner phone's key is still in the ACL after the backup removed it");
    if (!isOwnerRow(after.find((e) => e.subject === backupKey))) throw new Error("the backup's key lost its owner grant");
    step("removeOwner");

    outcome = "pass";
    printSuccess("OWN AGENT (twin) — created, admitted, swapped; backup linked, granted, and removed the first phone");
  }
} catch (err) {
  outcome = err instanceof PendingAppStep ? "pending" : "fail";
  console.error(err);
  for (const [d, who] of [[owner, "owner"], [backup, "backup"]]) {
    if (!d) continue;
    await screenshot(d, `own-agent-${outcome}-${who}`).catch(() => undefined);
    await dumpSource(d, `own-agent-${outcome}-${who}`).catch(() => undefined);
  }
  if (outcome === "pending") console.log(`\n[e2e] PENDING (exit 3): ${err.message}\n`);
  else printFailure("OWN AGENT (twin)", err);
} finally {
  undoLock?.();
  process.exitCode = outcome === "pass" ? 0 : outcome === "pending" ? 3 : 1;
  record.outcome = outcome;
  try {
    record.aclAtEnd = acl();
  } catch {
    /* recorded as missing */
  }
  mkdirSync(ARTIFACTS, { recursive: true });
  const file = path.join(ARTIFACTS, `own-agent-${RUN_ID}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2));
  console.log(`[e2e] record: ${file}`);
  // The twin's rows: removed after a pass, kept as evidence otherwise.
  const mode = process.env.E2E_ACL_CLEANUP || "";
  if (mode === "always" || (outcome === "pass" && mode !== "never")) {
    try {
      console.log(sh("reset.sh"));
    } catch (e) {
      console.log(`[acl] reset failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
  } else {
    console.log(`[acl] keeping this run's rows on ${twin.TWIN_SLUG}; remove them with scripts/openvtc/own-agent-twin/reset.sh`);
  }
  for (const l of logs) l.stop();
  for (const d of [owner, backup]) if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
