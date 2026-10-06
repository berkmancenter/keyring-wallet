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
 * The task is `vta/contexts/get` on a context this run creates for the purpose
 * and deletes at the end. It has to exist: an agent from vta-service 0.50.0
 * answers "not found" for a context that does not, before it looks at any
 * consent rule (0.49.0 held that request for consent first), so a made-up id
 * no longer proves anything.
 *
 * Usage: PLATFORM=android|ios [UDID=… | ANDROID_UDID=…] node run-vta-approvals.js
 *   RUNNER_VTA      the runner agent's pnm slug (default bob; never a person's own agent)
 *   PNM_BIN         the pnm that speaks to that agent's version
 *   E2E_KEEP_APP=1  leave the phone linked (and its keys on the agent) for a next step
 *   DEVICE_PIN      Android: set this screen lock after the link and type it into the owner
 *                   check. Since keyring-bifold #317 Approve asks for the owner (Face ID, or
 *                   the device PIN), and a phone with no lock cannot approve at all.
 *   CARD_ROWS=1     the card in plain words (#321, #328): "<who> asks your agent to <what>" with no DID, no "run "
 *                   and no raw task name; the task's technical name only behind RequestTaskToggle; and the card
 *                   saying what the task does (ApprovalTaskDoes + ApprovalOutcomeUnknown, or ApprovalOutcome).
 *   OWNER_ROWS=1    Android, with DEVICE_PIN: #317's rows. Approve asks; a cancelled check
 *                   leaves the request waiting; Decline (a second request) does not ask.
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

const link = JSON.parse(readFileSync(path.join(process.env.E2E_RUN_DIR || path.join(here, "artifacts"), "last-link.json"), "utf8"));
const SLUG = process.env.RUNNER_VTA || process.env.VTA_SLUG || link.slug;
if (SLUG !== link.slug) throw new Error(`the phone was linked to "${link.slug}", not "${SLUG}"`);

const utc = () => new Date().toISOString().slice(11, 19) + "Z";
const log = (s) => console.log(`[e2e] ${utc()} ${s}`);

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** A rate-limit answer from the agent or the proxy in front of it (the 236 gate's setup, 12:48Z). */
const RATE_LIMITED = /\b429\b|too many requests|rate.?limit|proxy \/ load balancer/i;

/**
 * One pnm call on the runner VTA, through the slug's lock. Returns what it said, whatever its exit status.
 * A rate-limited answer is retried with backoff (5, 10, 20, 40 s), and each one is logged with its time
 * as `RATE-LIMITED <utc> <args>`: evidence for the Farm's rate-limit question, not only a retry.
 */
function pnm(args, timeout = 120000) {
  let out = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      out = execFileSync(PNM_LOCKED, ["--vta", SLUG, ...args], { encoding: "utf8", timeout, env: { ...process.env, PNM_BIN: PNM }, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      out = `${err.stdout ?? ""}${err.stderr ?? ""}` || String(err.message);
    }
    if (!RATE_LIMITED.test(out)) return out;
    console.log(`RATE-LIMITED ${new Date().toISOString()} pnm ${args.slice(0, 3).join(" ")} (attempt ${attempt + 1})`);
    if (attempt < 4) pause(5000 * 2 ** attempt);
  }
  return out;
}
const PIN_DEV = PLATFORM === "android" ? process.env.DEVICE_PIN || "" : "";
const OWNER_ROWS = process.env.OWNER_ROWS === "1" && Boolean(PIN_DEV);
const row = (name, ok, detail) => console.log(`ROW ${name} ${ok ? "PASS" : "FAIL"} — ${detail}`);
function adb(...args) {
  try {
    return execFileSync("adb", ["-s", UDID, ...args], { encoding: "utf8", timeout: 30000 });
  } catch (err) {
    return `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
}
/** The system's owner-check window (BiometricPrompt / device credential), or "" when none shows within `ms`. */
async function authWindow(ms) {
  for (const until = Date.now() + ms; Date.now() < until; await sleep(500)) {
    const ws = adb("shell", "dumpsys", "window", "windows");
    const win = (ws.match(/Window\{[^}]*(AuthContainer|BiometricPrompt|ConfirmDeviceCredential|CredentialView|biometric)[^}]*\}/i) || [""])[0];
    if (win) return win;
  }
  return "";
}
/** Type the device PIN into the owner check; only into one, since Enter on the app presses its focused row. */
async function answerOwner(d, tag) {
  const win = await authWindow(8000);
  if (!win) {
    log(`owner check (${tag}): no prompt in 8 s; nothing typed`);
    return false;
  }
  log(`owner check (${tag}): ${win.slice(0, 120)}; typing the PIN`);
  adb("shell", "input", "text", PIN_DEV);
  adb("shell", "input", "keyevent", "66");
  await sleep(2500);
  return true;
}
/** Into the approval card for a held request: the banner on Your agent, or the card on Requests. */
async function awaitCard(d, ms) {
  let card = false;
  for (const until = Date.now() + ms; Date.now() < until && !card; await sleep(2000)) {
    if (await existsTestId(d, "AgentApprovalBanner", 300)) await tapTestId(d, "AgentApprovalBanner", 3000).catch(() => undefined);
    card = (await existsTestId(d, "AgentApprovalCard", 500)) || Boolean(await scrollToTestId(d, "AgentApprovalCard", 2).catch(() => false));
  }
  return card;
}
const lastLine = (out) => out.trim().split("\n").pop()?.slice(0, 160) ?? "";
function approvalsList() {
  const out = pnm(["approvals", "list", "--json"]);
  return JSON.parse(out.slice(out.indexOf("{")));
}
function rules() {
  return approvalsList().rules ?? [];
}
/** The agent's record of this phone as a device: whether it can be woken (`pushCapable`), or "unregistered". */
function pushCapableOf(did) {
  const out = pnm(["device", "list", "--json"]);
  try {
    const dev = (JSON.parse(out.slice(out.indexOf("{"))).devices ?? []).find((x) => x.consumerDid === did);
    return dev ? String(dev.pushCapable === true) : "unregistered";
  } catch {
    return `unreadable (${lastLine(out)})`;
  }
}
/** The approver sets as a stable string, to say whether cleanup put them back as they were. */
const setsOf = (list) => JSON.stringify(Object.fromEntries(Object.entries(list.approverSets ?? {}).sort(([a], [b]) => a.localeCompare(b))));

/**
 * From the Requests screen back to Your agent. Its own button shows only when nothing
 * waits, last in the list (scroll to it); else the header back, which is a plain stack
 * back to Your agent (RequestsHeaderBack when the screen was opened from a link).
 */
async function backFromRequests(d) {
  const own = await scrollToTestId(d, "RequestsBackToAgent", 4).catch(() => undefined);
  if (own) return own.click();
  // Opened from a notification link the screen has its own header back.
  if (await existsTestId(d, "RequestsHeaderBack", 1000)) return tapTestId(d, "RequestsHeaderBack", 5000);
  if (d.e2ePlatform === "ios") {
    const back = d.$('-ios predicate string:type == "XCUIElementTypeButton" AND (name == "Back" OR label == "Back")');
    if (await back.isExisting().catch(() => false)) return back.click();
  }
  return d.back();
}

let d;
let failed = true;
let approver;
let probeContext;
let declineContext;
let setsBefore;
let pinSet = false;
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

  setsBefore = setsOf(approvalsList());
  log(`approver sets before: ${setsBefore}`);
  const rulesBefore = rules();
  if (rulesBefore.length) throw new Error(`"${SLUG}" already has ${rulesBefore.length} approval rule(s): another run is using it, or left them`);
  // The context the request will ask for, made before the rule exists so that
  // making it needs no consent. A fresh id each run: the same request has the
  // same approval code, and the agent would reuse an earlier grant.
  probeContext = `e2e-approvals-${Date.now()}`;
  log(`probe context: ${lastLine(pnm(["contexts", "create", "--id", probeContext, "--name", "e2e approvals probe"]))}`);
  if (/consent required|not found/i.test(pnm(["contexts", "get", probeContext]))) throw new Error(`the probe context "${probeContext}" cannot be read back before the rule is set`);
  pause(3000); // the setup calls a few seconds apart: back to back they met the Farm's rate limit (12:48Z)
  log(`approver set: ${lastLine(pnm(["approvals", "approvers", "add", SET, approver]))}`);
  pause(3000);
  log(`rule: ${lastLine(pnm(["approvals", "require", TASK, "--consent", "--set", SET]))}`);
  if (!rules().length) throw new Error("the consent rule did not take");

  await ensureAppium();
  d = await makeDriver({ platform: PLATFORM, udid: UDID, deviceName: process.env.IOS_DEVICE_NAME, keepState: true });
  await unlockToHome(d);
  if (PIN_DEV) {
    adb("shell", "locksettings", "set-pin", PIN_DEV);
    pinSet = true;
    // A key made in the 5 s after a lock is set does not prompt yet (10-04): wait past it.
    log("device PIN set (after the link)");
    await sleep(8000);
  }
  await tapTestId(d, "MyAgent", 15000);
  // Manage: a segment before bifold #297, the "Agent settings" row after.
  if (await existsTestId(d, "AgentSegment_manage", 5000)) {
    await tapTestId(d, "AgentSegment_manage", 5000);
  } else if (!(await existsTestId(d, "AgentRequestsRow", 1500))) {
    await scrollToTestId(d, "AgentSettings", 8).catch(() => undefined);
    await tapTestId(d, "AgentSettings", 10000).catch(() => undefined);
  }

  // The request: read the probe context, which the rule now holds for consent.
  const contextId = probeContext;
  const asked = pnm(["contexts", "get", contextId], 180000);
  if (!/consent required/i.test(asked)) throw new Error(`the request was not held for consent: ${lastLine(asked)}`);
  log(`request held: ${lastLine(asked)}`);

  const t0 = Date.now();
  const card = await awaitCard(d, 180000);
  if (!card) throw new Error("no approval card on the phone within 180 s");
  log(`approval card after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await scrollToTestId(d, "ApproveConsentButton", 3).catch(() => undefined);
  const code = (await existsTestId(d, "ApprovalMatchCode", 1000)) ? await textOf(d, "ApprovalMatchCode") : "(none)";
  log(`match code on the phone: "${code}"`);
  await screenshot(d, "vta-approvals-card");
  // #321: the card names who asks and what for, never as a DID.
  const asks = (await existsTestId(d, "RequestAsks", 1500)) ? (await textOf(d, "RequestAsks")).trim() : "";
  const does = (await existsTestId(d, "ApprovalTaskDoes", 1000)) ? (await textOf(d, "ApprovalTaskDoes")).trim() : "";
  log(`card says: "${asks}" · task "${does}"`);
  if (process.env.CARD_ROWS === "1") {
    const plain = /asks your agent to \S/.test(asks) && !/did:/i.test(asks) && !/\brun\b/i.test(asks) && !/vta\//i.test(asks);
    row("card in plain words", plain, `"${asks}"`);
    // The raw task name lives behind "Technical name" (RequestTaskToggle → RequestTaskDid), never in the sentence.
    let technical = "";
    if (await scrollToTestId(d, "RequestTaskToggle", 3).catch(() => undefined)) {
      await tapTestId(d, "RequestTaskToggle", 5000).catch(() => undefined);
      technical = (await existsTestId(d, "RequestTaskDid", 5000)) ? (await textOf(d, "RequestTaskDid")).trim() : "";
    }
    row("card technical name behind the toggle", /contexts\/get/.test(technical), technical ? `"${technical}"` : "no RequestTaskToggle / RequestTaskDid");
    // What it would do: the agent's own effects (ApprovalOutcome), else Keyring's words with the caution line.
    const outcome = await existsTestId(d, "ApprovalOutcome", 1000);
    const unknown = await existsTestId(d, "ApprovalOutcomeUnknown", 1000);
    row("card says what it would do", outcome || (Boolean(does) && unknown), outcome ? "the agent's effects (ApprovalOutcome)" : `"${does}"${unknown ? " + ApprovalOutcomeUnknown" : " (no ApprovalOutcomeUnknown)"}`);
    await scrollToTestId(d, "ApproveConsentButton", 3).catch(() => undefined);
  }
  if (OWNER_ROWS) {
    // #317: Approve asks for the owner; a cancelled check leaves the request as it was.
    await tapTestId(d, "ApproveConsentButton", 10000);
    const asked = await authWindow(8000);
    await screenshot(d, "vta-approvals-owner-prompt").catch(() => log("screenshot vta-approvals-owner-prompt not taken (the owner check is a secure window)"));
    row("317 Approve asks the owner", Boolean(asked), asked ? asked.slice(0, 100) : "no owner check within 8 s of Approve");
    // Cancel: Back until the prompt is gone. One Back left Android's BiometricPrompt up (236 rerun, 13:48Z: the
    // secure window still there 11 s later), which hid the card and stopped the second Approve.
    let promptGone = !asked;
    for (let i = 0; i < 4 && !promptGone; i++) {
      adb("shell", "input", "keyevent", "4");
      await sleep(1500);
      promptGone = !(await authWindow(1500));
    }
    log(`owner check cancelled: prompt gone ${promptGone}`);
    await sleep(1500);
    const still = (await existsTestId(d, "ApproveConsentButton", 5000)) || Boolean(await scrollToTestId(d, "ApproveConsentButton", 3).catch(() => undefined));
    const page = await d.getPageSource().catch(() => "");
    const said = (page.match(/text="[^"]{6,160}"/g) ?? []).filter((t) => /confirm|cancel|owner|lock|not approved|try again/i.test(t)).slice(0, 3);
    const heldNow = /consent required/i.test(pnm(["contexts", "get", contextId], 120000));
    await screenshot(d, "vta-approvals-owner-cancelled").catch(() => log("screenshot vta-approvals-owner-cancelled not taken (the owner check is a secure window)"));
    row("317 cancel keeps it waiting", Boolean(asked) && promptGone && still && heldNow, `prompt gone ${promptGone}; card still there ${still}; agent still holds it ${heldNow}; on screen ${JSON.stringify(said)}`);
  }
  // An iPhone's wake channel was cleared during an approval (236, under review): read the agent's
  // pushCapable for this phone before and after, so the run shows whether Approve's owner check
  // turns waking off.
  const pushBefore = pushCapableOf(approver);
  await scrollToTestId(d, "ApproveConsentButton", 3).catch(() => undefined);
  await tapTestId(d, "ApproveConsentButton", 10000);
  if (PIN_DEV) await answerOwner(d, "approve");
  await waitForTestId(d, "AgentApprovalDecided", 30000);
  await sleep(5000);
  const pushAfter = pushCapableOf(approver);
  console.log(`PUSH-CAPABLE ${PLATFORM} before Approve ${pushBefore}, after ${pushAfter}`);
  if (pushBefore === "true") row("push stays on through Approve", pushAfter === "true", `pushCapable ${pushBefore} → ${pushAfter}`);
  const decided = await textOf(d, "AgentApprovalDecided");
  log(`after Approve: "${decided}"`);
  if (!/approved/i.test(decided)) throw new Error(`the phone did not show the approval as given: "${decided}"`);
  await sleep(1500);
  // Since keyring-bifold #260 the card sits on its own Requests screen, where
  // the banner never is: go back to Your agent before checking it went away.
  if (await existsTestId(d, "Requests", 1500)) {
    await backFromRequests(d);
    await sleep(1000);
    log("back from Requests to Your agent");
  }
  await scrollToTestId(d, "AgentHomeTitle", 6).catch(() => undefined);
  if (!(await existsTestId(d, "AgentHomeTitle", 5000))) throw new Error("not on Your agent: the banner check below would prove nothing");
  if (await existsTestId(d, "AgentApprovalBanner", 1500)) throw new Error('the "requests wait" banner is still shown after the decision');

  // The same request again: it must now pass the consent gate.
  const again = pnm(["contexts", "get", contextId], 120000);
  if (/consent required/i.test(again)) throw new Error(`still held after the approval: ${lastLine(again)}`);
  if (/not found/i.test(again)) throw new Error(`the approved request did not read the probe context: ${lastLine(again)}`);
  log(`the same request again: ${lastLine(again)}`);

  if (OWNER_ROWS) {
    // #317: Decline needs no owner check. A second request (another context: the same one would be the
    // approved grant again), declined from the card.
    declineContext = `e2e-decline-${Date.now()}`;
    log(`decline context: ${lastLine(pnm(["contexts", "create", "--id", declineContext, "--name", "e2e approvals decline"]))}`);
    const asked2 = pnm(["contexts", "get", declineContext], 180000);
    const held2 = /consent required/i.test(asked2);
    const card2 = held2 && (await awaitCard(d, 180000));
    let prompted = "";
    let gone = false;
    let decided2 = "";
    if (card2) {
      await scrollToTestId(d, "DenyConsentButton", 3).catch(() => undefined);
      await tapTestId(d, "DenyConsentButton", 10000);
      prompted = await authWindow(5000);
      if (prompted) adb("shell", "input", "keyevent", "4");
      for (let i = 0; i < 20 && !gone; i++) {
        await sleep(1000);
        gone = !(await existsTestId(d, "DenyConsentButton", 500));
      }
      decided2 = (await existsTestId(d, "AgentApprovalDecided", 2000)) ? await textOf(d, "AgentApprovalDecided") : "";
      await screenshot(d, "vta-approvals-declined").catch(() => log("screenshot vta-approvals-declined not taken (the owner check is a secure window)"));
    }
    row("317 Decline does not ask", card2 && !prompted && gone, card2 ? `owner check ${prompted ? "SHOWN" : "none"}; card cleared ${gone}; "${decided2}"` : `no card for the second request (held ${held2}: ${lastLine(asked2)})`);
  }

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
  // After the rule is gone, so removing the probe context needs no consent.
  // Say what happened, not what was asked: a refused delete (a rate-limited DID
  // host, 429) was logged as "removed" and the context stayed on the runner
  // (10-03, found 10-05). Retry a few times, then check the list.
  for (const ctx of [probeContext, declineContext].filter(Boolean)) {
    // Gone only when a list that was read (it always holds the agent's own
    // "vta" context) no longer names it; an unreadable list proves nothing.
    const gone = () => {
      const listed = pnm(["contexts", "list"]);
      return /"id":\s*"vta"/.test(listed) && !listed.includes(`"${ctx}"`);
    };
    let said = "";
    let removed = false;
    for (let attempt = 1; attempt <= 4 && !removed; attempt++) {
      said = lastLine(pnm(["contexts", "delete", "--yes", ctx]));
      removed = gone();
      if (!removed) pause(15000);
    }
    log(removed ? `context ${ctx} removed: ${said}` : `context ${ctx} NOT confirmed removed (${said}): ${PNM} --vta ${SLUG} contexts delete --yes ${ctx}`);
  }
  try {
    const after = approvalsList();
    log(`rules after: ${(after.rules ?? []).length}`);
    if (setsBefore !== undefined) {
      const setsAfter = setsOf(after);
      log(`approver sets after: ${setsAfter} — ${setsAfter === setsBefore ? "as before" : `NOT as before (${setsBefore})`}`);
    }
  } catch (err) {
    log(`rules after: unreadable (${err.message.split("\n")[0]})`);
  }
  // The phone's own key ends the chain here, unless it is handed on. Kept on a
  // failure, as evidence, like every other run key (aclCleanup.js).
  if (process.env.E2E_KEEP_APP !== "1") {
    removeRunKeys({ slug: SLUG, pnmHome: link.pnmHome, before: new Set(link.before), tempDid: link.tempDid, heirs: link.heirs ?? [], failed });
    if (approver && !failed) log(`phone key removed: ${lastLine(pnm(["acl", "delete", approver]))}`);
    else if (approver) log(`phone key kept (failed run): ${PNM} --vta ${SLUG} acl delete '${approver}'`);
  }
  if (pinSet) log(`device PIN cleared: ${adb("shell", "locksettings", "clear", "--old", PIN_DEV).trim().slice(0, 60)}`);
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
