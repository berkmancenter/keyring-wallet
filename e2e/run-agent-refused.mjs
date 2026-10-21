#!/usr/bin/env node
/**
 * IN-350 (bifold #454, #455): this phone's own agent refuses it ("DID not in ACL"). The phone is linked to the main
 * runner already (the leg runs run-vta-link.js first, which records the link in last-link.json). This driver:
 *   1. joins community C by its review way, and the harness admin approves (as run-signin-member.mjs);
 *   2. checks C's own screen shows no agent notice while the grant stands: the positive control for row 4;
 *   3. removes this phone's own grant from the runner, the entries the link record names (lib/aclCleanup.js
 *      linkedPhoneEntries: the selection the end-of-leg cleanup makes, so never another leg's or a person's entry);
 *   4. waits on another screen (Contacts) through three of the persona inbox's 30 s sign-in rounds.
 * Rows (lib/rows.js):
 *   refused-member-joined      C lists the phone after its review-way request is approved
 *   refused-before             control: C's screen shows no PersonaAgentNotice while the agent still accepts the phone
 *   refused-no-toast           no app-wide toast (Toast) on Contacts while the refusal lands; a verdict only when the
 *                              phone's log shows the refusal in that window, else SKIP
 *   refused-link-removed       My Agent shows the link removed (RemovedPhone) with the way to link again (VtaLinkScanAgain)
 *   refused-community-notice   C's screen: PersonaAgentNotice saying the agent no longer accepts this phone, never "didn't
 *                              answer", and Open My Agent (PersonaAgentNoticeOpen) leads there
 * Cleanup removes the member this run made; the leg removes the phone's keys.
 *
 *   UDID=emulator-5572 APPIUM_PORT=4765 C_DID=… C_REST=… C_ADMIN_CRED=… LINK_FILE=…/last-link.json node run-agent-refused.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { deleteAcl, linkedPhoneEntries, listAcl } from "./lib/aclCleanup.js";
import { ensureAppium, existsTestId, screenshot, scrollToTestId, sleep, stopAppium, tapTestId, waitForTestId } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { join } from "./lib/pages/join.js";
import { createRows } from "./lib/rows.js";
import { createHvAdmin, requestsSince } from "./openvtc/hvAdmin.js";

const UDID = process.env.UDID;
const C_DID = process.env.C_DID;
/** The refused wording (en.json VtaLink.PersonaAgentRefusedLine) and the one it must never be (…UnreachableLine). */
const REFUSED_LINE = /no longer accepts this phone/i;
const UNREACHABLE_LINE = /didn't answer/i;
/** The persona inbox's own line for a refusal (vtiPersonaInbox.ts releaseWarn "[VTI] persona inbox (…): <why>"). */
const REFUSAL_LOG = /\[VTI\] persona inbox[^\n]*(refus|not in ACL|no longer accepts|permission ?denied)/i;
const rows = createRows({
  label: "refused",
  needs: {
    "refused-before": ["refused-member-joined"],
    "refused-no-toast": ["refused-before"],
    "refused-link-removed": ["refused-before"],
    "refused-community-notice": ["refused-before"],
  },
});
const adb = (...args) => execFileSync("adb", ["-s", UDID, ...args], { encoding: "utf8", timeout: 30000, maxBuffer: 256 * 1024 * 1024 });
const admin = createHvAdmin({ vtcBase: process.env.C_REST, communityDid: C_DID, adminCredential: process.env.C_ADMIN_CRED });

/** C's own screen, with what its agent notice says (empty when there is none). */
async function communityNotice(d) {
  await join.openCommunity(d, { did: C_DID, name: "" });
  const shown = await existsTestId(d, "PersonaAgentNotice", 8000);
  const line = shown ? await textOf(d, "PersonaAgentNoticeLine").catch(() => "") : "";
  return { shown, line };
}

let d;
let memberDid;
try {
  for (const [k, v] of Object.entries({ UDID, C_DID, C_REST: process.env.C_REST, LINK_FILE: process.env.LINK_FILE })) if (!v) throw new Error(`driver: ${k} is required`);
  const link = JSON.parse(readFileSync(process.env.LINK_FILE, "utf8"));
  await ensureAppium();
  d = await makeDriver({ platform: "android", udid: UDID, keepState: true });
  rows.setDriver(d);
  await unlockToHome(d);

  // 1. Join C by the review way; the harness admin approves the request this phone made.
  const since = new Date().toISOString();
  await rows.row("refused-member-joined", async () => {
    await join.openCommunity(d, { did: C_DID, name: "" });
    await join.ask(d, { tag: "refused" });
    await join.awaitSent(d, { required: true });
    // C is shared with other legs (kk, beside this one on the MacBook): approve only when this phone's request is the
    // one new request, and remember only the member it made, so the cleanup never removes someone else's (review on #549).
    let reqs = [];
    for (let i = 0; i < 24 && !reqs.length; i++) { reqs = requestsSince(admin.joinRequests("pending"), since); if (!reqs.length) await sleep(5000); }
    if (!reqs.length) throw new Error("no pending join request from this phone reached the community");
    if (reqs.length > 1) return { ok: false, detail: `${reqs.length} join requests appeared on C since this step began: another run is joining, so none is approved here` };
    const req = reqs[0];
    admin.decide(req.id, "approved");
    let member;
    for (let i = 0; i < 24 && !member; i++) { member = admin.members().find((m) => m.did === req.applicantDid); if (!member) await sleep(5000); }
    memberDid = member?.did;
    const done = await waitForTestId(d, "JoinDone", 240000).then(() => true, () => false);
    if (done) await join.done(d).catch(() => undefined);
    return { ok: Boolean(member && done), detail: `request ${req.id} approved; member ${member?.did ?? "not listed"} (its applicant); JoinDone ${done}` };
  });
  if (!memberDid) throw new Error("not a member: no community to show the notice");

  // 2. The control: while the agent still accepts the phone, C says nothing about it.
  await rows.row("refused-before", async () => {
    await sleep(35000); // one inbox round, so a notice that would show without a refusal has had its chance
    const n = await communityNotice(d);
    await screenshot(d, "refused-before").catch(() => undefined);
    return { ok: !n.shown, detail: n.shown ? `a notice already shows before any refusal: "${n.line}"` : "no PersonaAgentNotice while the grant stands" };
  });

  // 3. The runner forgets this phone: its own entries only, as the end-of-leg cleanup would remove them.
  const mine = linkedPhoneEntries(listAcl({ slug: link.slug, pnmHome: link.pnmHome }), link);
  if (!mine.length) throw new Error(`driver: the link record names no entry on ${link.slug} (tempDid ${String(link.tempDid).slice(0, 24)}…)`);
  // One phone holds its grant and perhaps a rotated key or two: more is not this phone's, so nothing is removed.
  if (mine.length > 3) throw new Error(`driver: ${mine.length} entries chained to this phone on ${link.slug}, more than a phone holds: nothing removed`);
  adb("logcat", "-c");
  const removedAt = Date.now();
  for (const e of mine) {
    deleteAcl({ slug: link.slug, pnmHome: link.pnmHome, subject: e.subject });
    console.log(`[e2e] removed this phone's entry ${e.subject.slice(0, 32)}… (${e.label ?? "-"}) from ${link.slug}`);
  }

  // 4. On another screen through three sign-in rounds: no toast, while the refusal lands.
  await tapTestId(d, "Contacts", 15000).catch(() => undefined);
  let toast = "";
  for (const until = removedAt + 95000; Date.now() < until && !toast; await sleep(2000)) {
    if (await existsTestId(d, "Toast", 500)) toast = (await textOf(d, "ToastTitle").catch(() => "")) || "(a toast)";
  }
  if (toast) await screenshot(d, "refused-toast").catch(() => undefined);
  const lines = adb("logcat", "-d", "-v", "time").split("\n").filter((l) => REFUSAL_LOG.test(l));
  const evidence = lines.length > 0;
  // No toast proves nothing unless the refusal happened in the window: without its line the row is no verdict.
  if (!toast && !evidence) rows.skip("refused-no-toast", "no verdict: no refusal line from the persona inbox in the 95 s window");
  else await rows.row("refused-no-toast", () => toast
    ? { ok: false, detail: `a toast showed on Contacts: "${toast}" (${evidence ? "with the refusal in the log" : "no refusal line yet"})` }
    : { ok: true, detail: `no toast on Contacts for 95 s; the refusal landed: ${lines[0].trim().slice(0, 140)}` });

  // 5. My Agent: the link is removed, with the way to link again.
  await rows.row("refused-link-removed", async () => {
    await tapTestId(d, "MyAgent", 15000);
    const removed = await existsTestId(d, "RemovedPhone", 30000);
    const again = removed && Boolean(await scrollToTestId(d, "VtaLinkScanAgain", 4).catch(() => false));
    await screenshot(d, "refused-my-agent").catch(() => undefined);
    return { ok: removed && again, detail: `RemovedPhone ${removed} · link again (VtaLinkScanAgain) ${again}` };
  });

  // 6. C's screen says the agent refused this phone, never that it didn't answer, and leads to My Agent.
  await rows.row("refused-community-notice", async () => {
    const n = await communityNotice(d);
    await screenshot(d, "refused-community").catch(() => undefined);
    let opened = false;
    if (n.shown && (await existsTestId(d, "PersonaAgentNoticeOpen", 3000))) {
      await tapTestId(d, "PersonaAgentNoticeOpen", 10000);
      opened = await existsTestId(d, "RemovedPhone", 15000);
    }
    const refused = REFUSED_LINE.test(n.line), unreachable = UNREACHABLE_LINE.test(n.line);
    return { ok: n.shown && refused && !unreachable && opened, detail: `PersonaAgentNotice ${n.shown} · line "${n.line.slice(0, 90)}" · refused wording ${refused} · "didn't answer" ${unreachable} · Open My Agent lands there ${opened}` };
  });
} catch (e) {
  rows.fatal(e);
  if (d) await screenshot(d, "refused-failure").catch(() => undefined);
} finally {
  if (memberDid) { const rm = admin.removeMember(memberDid, "refused leg cleanup"); console.log(`[cleanup] member ${memberDid.slice(-24)} removed: ${rm.status}`); }
  rows.summary();
  process.exitCode = rows.exitCode();
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
process.exit(process.exitCode ?? 0);
