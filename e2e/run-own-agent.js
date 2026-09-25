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

/** A phone ready to start: unlocked at home with no agent, or onboarded fresh. */
async function readyPhone(d, name) {
  if (await existsTestId(d, "GetStarted", 8000)) {
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
    await tapTestId(d, "AgentCreate", 15000);
    await waitForTestId(d, "AgentCreateIntro", 15000);
    await tapTestId(d, "AgentCreateContinue", 15000);
    await (await waitForTestId(d, "AgentCreateAddress", 15000)).setValue(AGENT_DID);
    await tapTestId(d, "AgentCreateAddressContinue", 15000);
    if (await existsTestId(d, "AgentCreateError", 3000)) throw new Error(`address refused: ${await textOf(d, "AgentCreateError")}`);
    await waitForTestId(d, "AgentCreateOwnerCode", 60000);
    await handleBiometricConfirmIfPresent(d); // making the code asks for Face ID (§3)
    if (!(await existsTestId(d, "AgentCreateOwnerDid", 2000))) {
      const show = await scrollToTestId(d, "AgentCreateShowCode", 4).catch(() => undefined);
      if (show) await show.click();
    }
    await waitForTestId(d, "AgentCreateOwnerDid", 15000);
    return (await textOf(d, "AgentCreateOwnerDid")).trim();
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
  if (await existsTestId(d, "AgentCreateConnect", 2000)) {
    await tapTestId(d, "AgentCreateConnect", 15000);
    await handleBiometricConfirmIfPresent(d);
    const by = Date.now() + 180000;
    while (Date.now() < by) {
      if (await existsTestId(d, "AgentCreateError", 1000)) throw new Error(`${who}: ${await textOf(d, "AgentCreateError")}`);
      if (await existsTestId(d, "AgentBackup", 1000)) return "AgentBackup";
      await sleep(1500);
    }
    throw new Error(`${who}: Connecting never reached "Add a backup"`);
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
  const admitted = execFileSync("bash", [path.join(TWIN_DIR_SCRIPTS, "show-acl.sh"), "--owner", ownerTemp], { encoding: "utf8", env: twinEnv });
  step("admit", { acl: admitted.trim() });

  // 3 — connect: sign in as that key, swap onto the long-term key.
  const landed = await connect(owner, "owner");
  const ownerKey = assertSwappedToOwner(ownerTemp, "owner");
  record.ownerKey = ownerKey;
  step("connect", { landed, ownerKey: `${ownerKey.slice(0, 32)}…` });

  if (SKIP_BACKUP) {
    outcome = "pass";
    printSuccess("OWN AGENT (twin) — created, admitted, connected, swapped to an owner key");
  } else {
    backup = await makeDriver({ platform: BACKUP_PLATFORM, udid: process.env.BACKUP_UDID, keepState });
    if (process.env.BACKUP_UDID) logs.push(startDeviceLog({ platform: BACKUP_PLATFORM, udid: process.env.BACKUP_UDID, file: path.join(ARTIFACTS, `own-agent-${RUN_ID}-backup.log`) }));
    await readyPhone(backup, "Backup");

    // 4 — the owner shows the agent's address; the backup brings it and shows its code.
    // TODO(own-agent §7): owner: AgentBackup → AgentBackupPhone → AgentBackupAddressQr.
    if (await existsTestId(owner, "AgentBackupPhone", 2000)) {
      await tapTestId(owner, "AgentBackupPhone", 15000);
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
    } else if (await existsTestId(owner, "AgentBackupScanCode", 2000)) {
      await tapTestId(owner, "AgentBackupScanCode", 15000);
      // A simulator cannot scan the other phone: paste its code (the screen offers paste, §7 step 5.3).
      const pasteField = await waitForTestId(owner, "AgentBackupScanCode", 5000);
      await pasteField.setValue(backupTemp).catch(() => undefined);
      await handleBiometricConfirmIfPresent(owner);
      await waitForTestId(owner, "AgentBackupAdded", 60000);
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
    const owners = acl().filter((e) => [ownerKey, backupKey].includes(e.subject) && isOwnerRow(e));
    if (owners.length !== 2) throw new Error(`expected two owner rows (owner phone and backup), found ${owners.length}`);
    record.backupKey = backupKey;
    step("backupFinish", { backupKey: `${backupKey.slice(0, 32)}…` });

    // 7 — the backup removes the first phone.
    // TODO(own-agent §7): no testIDs are defined for removing a device yet
    //   (2026-09-25-uiux.md lists none); AgentDevices / AgentDeviceRemove are
    //   placeholders until the screens document names them.
    if (!(await existsTestId(backup, "AgentDevices", 2000))) {
      throw new PendingAppStep("removeOwner", "the backup phone has no way to remove another phone — own_agent_subtask.md §4, D3");
    }
    await tapTestId(backup, "AgentDevices", 15000);
    await tapTestId(backup, "AgentDeviceRemove", 15000);
    await handleBiometricConfirmIfPresent(backup);
    await sleep(5000);
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
