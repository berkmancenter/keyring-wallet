/**
 * Two devices, one VTA: the manager asks, the approver consents (§2.4 B, the
 * approver rung). Android is the manager, iOS the approver — the "nicer demo".
 *
 *   iOS  → Developer → show manager identity   (its DID is enrolled on alice already)
 *   host → approver-setup.sh add <iosDid>       (approver set + consent on keys/export-secret)
 *   Android → Developer → connect and mint a persona → the key borrow is HELD
 *   iOS  → My Agent → an approval card appears → Approve
 *   Android → the borrow completes → community session as the persona
 *
 * Usage: E2E_KEEP_STATE=1 node run-vti-approve.js      (PLATFORMS=android,ios)
 */
import { createSession, ensureAppium, stopAppium, screenshot, dumpSource, sleep, scrollToTestId, waitForTestId, byTestId } from "./lib/driver.js";
import { androidCaps, iosCaps } from "./lib/config.js";
import { openDeveloperScreen, unlockIfLocked } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const SETUP = path.resolve(here, "../scripts/openvtc/local-vti-stack/approver-setup.sh");
const ENROL = path.resolve(here, "../scripts/openvtc/local-vti-stack/enrol-manager.sh");
const platforms = (process.env.PLATFORMS || "android,ios").split(",");
const keep = (caps) => ({ ...caps, "appium:fullReset": false, "appium:noReset": true, "appium:enforceAppInstall": false });

const textOf = async (driver, key) =>
  (await byTestId(driver, key).getAttribute(driver.e2ePlatform === "ios" ? "label" : "text")) || "";

async function unlockToHome(driver) {
  await waitForTestId(driver, "EnterPIN", 120000).catch(() => undefined);
  await unlockIfLocked(driver);
  await waitForTestId(driver, "Contacts", 300000);
  await sleep(4000);
}

async function settleDeveloperScreen(driver) {
  await openDeveloperScreen(driver);
  for (let i = 0; i < 45; i++) {
    const community = await textOf(driver, "VtaProbeLog").catch(() => "");
    if (/verdict|no verdict|\[VTI-PROBE\] failed|no manifest/.test(community)) break;
    await sleep(2000);
  }
  for (let i = 0; i < 3; i++) if (!(await driver.acceptAlert().then(() => true, () => false))) break;
}

async function managerDidOf(driver) {
  let show;
  for (let i = 0; i < 3 && !show; i++) {
    await driver.acceptAlert().catch(() => undefined);
    show = await scrollToTestId(driver, "ShowManagerIdentityButton", 8).catch(() => undefined);
  }
  await show.click();
  let log = "";
  for (let i = 0; i < 20 && !log.includes("MANAGER_DID="); i++) {
    await sleep(1500);
    log = await textOf(driver, "VtaManagerProbeLog").catch(() => "");
  }
  return /MANAGER_DID=(did:[^\s]+)/.exec(log)?.[1];
}

let manager, approver;
try {
  await ensureAppium();
  manager = await createSession(platforms[0], keep(platforms[0] === "android" ? androidCaps() : iosCaps()));
  approver = await createSession(platforms[1], keep(platforms[1] === "android" ? androidCaps() : iosCaps()));
  console.log(`[e2e] manager = ${platforms[0]}, approver = ${platforms[1]}`);
  await Promise.all([unlockToHome(manager), unlockToHome(approver)]);

  // 1 — who the approver is, and the policy that names it.
  await settleDeveloperScreen(approver);
  const approverDid = await managerDidOf(approver);
  if (!approverDid) throw new Error("approver has no manager identity on screen");
  console.log(`[e2e] approver identity ${approverDid.slice(0, 40)}…`);
  const policy = execFileSync("bash", [SETUP, "add", approverDid], { encoding: "utf8" });
  console.log(`[e2e] ${policy.trim().split("\n").slice(-4).join(" | ")}`);
  if (/No approval rules/.test(policy)) throw new Error(`the consent rule did not take:\n${policy}`);
  // Back to My Agent, where the approver listens.
  await (await waitForTestId(approver, "MyAgent", 30000)).click();
  await waitForTestId(approver, "MyAgentNoApprovals", 30000);

  // 2 — the manager asks for a key; the VTA holds it. The manager must be a
  // NON-admin role: an admin (PolicyAdmin) is exempt from its own consent
  // policy (VTI-22), so enrol it as `initiator` — which still carries KeyMint
  // and Sign, all a persona mint and a key borrow need.
  await settleDeveloperScreen(manager);
  const managerDid = await managerDidOf(manager);
  if (!managerDid) throw new Error("manager has no identity on screen");
  // The manager stays admin: minting a persona and exporting its key both
  // require admin (webvh/dids/create, keys/export-secret). The consent gate is
  // enabled by config.policy.enforcement on the VTA and the rule on the key
  // borrow; whether it holds an admin is exactly what this run measures.
  void managerDid;
  const probe = await scrollToTestId(manager, "ProbeVtaManagerButton", 8);
  await probe.click();
  await waitForTestId(manager, "VtaManagerProbeLog", 60000);
  let mlog = "";
  for (let i = 0; i < 90 && !/consent required|key borrowed|\[VTA-PROBE\] failed/.test(mlog); i++) {
    await sleep(2000);
    await manager.acceptAlert().catch(() => undefined);
    mlog = (await textOf(manager, "VtaManagerProbeLog").catch(() => mlog)) || mlog;
  }
  if (!mlog.includes("consent required")) throw new Error(`manager was not held for consent:\n${mlog}`);
  console.log(`[e2e] ${manager.e2ePlatform}: held for consent`);
  await screenshot(manager, "vti-approve-held");

  // 3 — the approver sees it and consents.
  await waitForTestId(approver, "MyAgentApprovalCard", 90000);
  await screenshot(approver, "vti-approve-asked");
  await (await waitForTestId(approver, "ApproveConsentButton", 10000)).click();
  console.log(`[e2e] ${approver.e2ePlatform}: approved`);
  let decided = "";
  for (let i = 0; i < 30 && !decided; i++) {
    await sleep(2000);
    decided = await textOf(approver, "MyAgentApprovalDecided").catch(() => "");
  }
  await screenshot(approver, "vti-approve-decided");
  if (!/Approved/i.test(decided)) throw new Error(`approver's decision did not land: ${decided}`);

  // 4 — the manager's task completes.
  for (let i = 0; i < 60 && !/key borrowed|\[VTA-PROBE\] failed/.test(mlog); i++) {
    await sleep(2000);
    await manager.acceptAlert().catch(() => undefined);
    mlog = (await textOf(manager, "VtaManagerProbeLog").catch(() => mlog)) || mlog;
  }
  for (let i = 0; i < 30 && !/manifest as persona|\[VTA-PROBE\] failed/.test(mlog); i++) {
    await sleep(2000);
    await manager.acceptAlert().catch(() => undefined);
    mlog = (await textOf(manager, "VtaManagerProbeLog").catch(() => mlog)) || mlog;
  }
  await manager.acceptAlert().catch(() => undefined);
  await screenshot(manager, "vti-approve-result");
  if (!mlog.includes("key borrowed")) throw new Error(`manager's borrow never completed:\n${mlog}`);
  console.log(`[e2e] ${manager.e2ePlatform}: key borrowed after consent`);
  printSuccess("vti-approve");
  process.exitCode = 0;
} catch (err) {
  printFailure("vti-approve", err);
  for (const [d, name] of [[manager, "manager"], [approver, "approver"]]) {
    if (d) { try { await screenshot(d, `vti-approve-failure-${name}`); await dumpSource(d, `vti-approve-failure-${name}`); } catch { /* ignore */ } }
  }
  process.exitCode = 1;
} finally {
  try { execFileSync("bash", [SETUP, "clear"], { stdio: "inherit" }); } catch { /* best effort */ }
  for (const d of [manager, approver]) { if (d) { try { await d.deleteSession(); } catch { /* ignore */ } } }
  stopAppium();
}
