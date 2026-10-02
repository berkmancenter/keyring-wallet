/**
 * An approval, on a build with nothing baked in: the phone is an approver of
 * its agent, a request arrives that needs consent, the person approves it on
 * the phone, and the request then passes.
 *
 * `run-vti-approve.js` drives the same protocol through two Developer-screen
 * buttons that read a baked `VTI_VTA_DID`, so it cannot run on a store build
 * (CI test builds refuse any `VTI_` value). This one uses only what a tester
 * has: a phone linked to an agent, and My Agent.
 *
 *   phone → already linked to the runner VTA by `run-vta-link.js` (E2E_KEEP_APP=1),
 *           which leaves artifacts/last-link.json
 *   host  → pnm: the phone's key joins an approver set; one task needs that set's consent
 *   host  → pnm: asks for that task → "consent required"
 *   phone → My Agent → the approval card → Approve → "Approved", the banner clears
 *   host  → pnm: the same request again → no longer "consent required"
 *   host  → the rule and the approver are removed; the link's keys too, unless
 *           E2E_KEEP_APP=1 hands the phone on to another step
 *
 * The task is `vta/contexts/get` on a context id that does not exist: it
 * changes nothing on the agent, and once consent is given its answer is
 * "not found" rather than "consent required".
 *
 * Usage: PLATFORM=android|ios [UDID=… | ANDROID_UDID=…] node run-vta-approvals.js
 *   RUNNER_VTA      the runner agent's pnm slug (default bob; never a person's own agent)
 *   PNM_BIN         the pnm that speaks to that agent's version
 *   E2E_KEEP_APP=1  leave the phone linked (and its keys on the agent) for a next step
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

import { dumpSource, ensureAppium, existsTestId, screenshot, scrollToTestId, sleep, stopAppium, tapTestId, waitForTestId } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { listAcl, ownedBy, removeRunKeys } from "./lib/aclCleanup.js";
import { printFailure, printSuccess } from "./lib/banner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PNM_LOCKED = path.resolve(here, "../scripts/openvtc/pnm-locked");
const PNM = process.env.PNM_BIN || path.join(os.homedir(), "vti-stack/bin/pnm");
const PLATFORM = process.env.PLATFORM || "android";
const UDID = PLATFORM === "android" ? process.env.ANDROID_UDID || process.env.UDID : process.env.UDID;
const TASK = "https://trusttasks.org/spec/vta/contexts/get/1.0";
const SET = process.env.APPROVER_SET || "e2e-approvals";

const link = JSON.parse(readFileSync(path.join(here, "artifacts", "last-link.json"), "utf8"));
const SLUG = process.env.RUNNER_VTA || process.env.VTA_SLUG || link.slug;
if (SLUG !== link.slug) throw new Error(`the phone was linked to "${link.slug}", not "${SLUG}"`);

const utc = () => new Date().toISOString().slice(11, 19) + "Z";
const log = (s) => console.log(`[e2e] ${utc()} ${s}`);

/** One pnm call on the runner VTA, through the slug's lock. Returns what it said, whatever its exit status. */
function pnm(args, timeout = 120000) {
  try {
    return execFileSync(PNM_LOCKED, ["--vta", SLUG, ...args], { encoding: "utf8", timeout, env: { ...process.env, PNM_BIN: PNM }, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    return `${err.stdout ?? ""}${err.stderr ?? ""}` || String(err.message);
  }
}
const lastLine = (out) => out.trim().split("\n").pop()?.slice(0, 160) ?? "";
function rules() {
  const out = pnm(["approvals", "list", "--json"]);
  const parsed = JSON.parse(out.slice(out.indexOf("{")));
  return parsed.rules ?? [];
}

let d;
let failed = true;
let approver;
try {
  // The phone's key on the agent. A key the phone rotated onto is recorded as
  // created by whoever granted its temporary key: the temporary key itself for
  // a QR link, the runner's own pnm key for a grant made by hand
  // (LINK_MODE=manual). So take the ownership chain when it leads somewhere,
  // and otherwise the one entry added between the link's snapshot and its end;
  // more than one is another run's overlap, and is refused rather than guessed.
  const before = new Set(link.before);
  const added = listAcl({ slug: SLUG, pnmHome: link.pnmHome }).filter((e) => !before.has(e.subject));
  const chain = ownedBy(added, link.tempDid).filter((e) => e.subject !== link.tempDid);
  const duringLink = added.filter((e) => String(e.createdAt) <= link.at);
  if (chain.length) approver = chain.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1).subject;
  else if (duringLink.length === 1) approver = duringLink[0].subject;
  else if (duringLink.length > 1) throw new Error(`${duringLink.length} keys were added to "${SLUG}" during the link: cannot tell which is this phone's`);
  if (!approver) throw new Error(`no key of this phone on "${SLUG}": link it first (run-vta-link.js with E2E_KEEP_APP=1)`);
  log(`approver = this phone's key ${approver.slice(0, 40)}… on ${SLUG}`);

  const rulesBefore = rules();
  if (rulesBefore.length) throw new Error(`"${SLUG}" already has ${rulesBefore.length} approval rule(s): another run is using it, or left them`);
  log(`approver set: ${lastLine(pnm(["approvals", "approvers", "add", SET, approver]))}`);
  log(`rule: ${lastLine(pnm(["approvals", "require", TASK, "--consent", "--set", SET]))}`);
  if (!rules().length) throw new Error("the consent rule did not take");

  await ensureAppium();
  d = await makeDriver({ platform: PLATFORM, udid: UDID, deviceName: process.env.IOS_DEVICE_NAME, keepState: true });
  await unlockToHome(d);
  await tapTestId(d, "MyAgent", 15000);
  await tapTestId(d, "AgentSegment_manage", 15000).catch(() => undefined);

  // The request. A fresh id each run: the same request has the same approval
  // code, and the agent would reuse an earlier grant.
  const contextId = `e2e-approvals-${Date.now()}`;
  const asked = pnm(["contexts", "get", contextId], 180000);
  if (!/consent required/i.test(asked)) throw new Error(`the request was not held for consent: ${lastLine(asked)}`);
  log(`request held: ${lastLine(asked)}`);

  const t0 = Date.now();
  let card = false;
  for (const until = Date.now() + 180000; Date.now() < until && !card; await sleep(2000)) {
    if (await existsTestId(d, "AgentApprovalBanner", 300)) await tapTestId(d, "AgentApprovalBanner", 3000).catch(() => undefined);
    card = (await existsTestId(d, "AgentApprovalCard", 500)) || Boolean(await scrollToTestId(d, "AgentApprovalCard", 2).catch(() => false));
  }
  if (!card) throw new Error("no approval card on the phone within 180 s");
  log(`approval card after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await scrollToTestId(d, "ApproveConsentButton", 3).catch(() => undefined);
  const code = (await existsTestId(d, "ApprovalMatchCode", 1000)) ? await textOf(d, "ApprovalMatchCode") : "(none)";
  log(`match code on the phone: "${code}"`);
  await screenshot(d, "vta-approvals-card");
  await tapTestId(d, "ApproveConsentButton", 10000);
  await waitForTestId(d, "AgentApprovalDecided", 30000);
  const decided = await textOf(d, "AgentApprovalDecided");
  log(`after Approve: "${decided}"`);
  if (!/approved/i.test(decided)) throw new Error(`the phone did not show the approval as given: "${decided}"`);
  await sleep(1500);
  await scrollToTestId(d, "AgentHomeTitle", 6).catch(() => undefined);
  if (await existsTestId(d, "AgentApprovalBanner", 1500)) throw new Error('the "requests wait" banner is still shown after the decision');

  // The same request again: it must now pass the consent gate.
  const again = pnm(["contexts", "get", contextId], 120000);
  if (/consent required/i.test(again)) throw new Error(`still held after the approval: ${lastLine(again)}`);
  log(`the same request again: ${lastLine(again)}`);

  failed = false;
  printSuccess("VTA APPROVAL — held for consent, approved on the phone, then let through");
} catch (err) {
  printFailure("vta-approvals", err);
  if (d) {
    await screenshot(d, "vta-approvals-failure").catch(() => undefined);
    await dumpSource(d, "vta-approvals-failure").catch(() => undefined);
  }
  process.exitCode = 1;
} finally {
  // The rule and the approver go whatever happened: a consent rule left on a
  // shared runner agent holds every later run's request.
  log(`rule removed: ${lastLine(pnm(["approvals", "remove", TASK]))}`);
  if (approver) log(`approver removed: ${lastLine(pnm(["approvals", "approvers", "remove", SET, approver]))}`);
  try {
    log(`rules after: ${rules().length}`);
  } catch (err) {
    log(`rules after: unreadable (${err.message.split("\n")[0]})`);
  }
  // The phone's own key ends the chain here, unless it is handed on. Kept on a
  // failure, as evidence, like every other run key (aclCleanup.js).
  if (process.env.E2E_KEEP_APP !== "1") {
    removeRunKeys({ slug: SLUG, pnmHome: link.pnmHome, before: new Set(link.before), tempDid: link.tempDid, failed });
    if (approver && !failed) log(`phone key removed: ${lastLine(pnm(["acl", "delete", approver]))}`);
    else if (approver) log(`phone key kept (failed run): ${PNM} --vta ${SLUG} acl delete '${approver}'`);
  }
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
