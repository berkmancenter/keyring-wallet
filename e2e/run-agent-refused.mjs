#!/usr/bin/env node
/**
 * IN-350 (bifold #454, #455): this phone's own agent refuses it ("DID not in ACL"). The phone is linked to the main
 * runner already (the leg runs run-vta-link.js first, which records the link in last-link.json). This driver:
 *   1. joins community C by its review way, and the harness admin approves (as run-signin-member.mjs);
 *   2. checks C's own screen shows no agent notice while the grant stands: the positive control for row 4;
 *   3. removes this phone's own grant from the runner, the entries the link record names (lib/aclCleanup.js
 *      linkedPhoneEntries: the selection the end-of-leg cleanup makes, so never another leg's or a person's entry);
 *   4. relaunches the app (the persona's key leaves memory, so the inbox asks the agent again) and waits on another
 *      screen (Contacts) through three of the persona inbox's 30 s rounds; or (REFUSED_PATH=heartbeat) stays open two
 *      presence ticks (REFUSED_HEARTBEAT_S, 660), reading the link's status on My Agent each minute.
 * Rows (lib/rows.js):
 *   refused-member-joined      C lists the phone after its review-way request is approved
 *   refused-before             control: C's screen shows no PersonaAgentNotice while the agent still accepts the phone
 *   refused-no-toast           no app-wide toast (Toast) on Contacts while the refusal lands; a verdict only when the
 *                              phone's log shows the refusal in that window, else SKIP
 *   refused-link-removed       My Agent shows the link removed (RemovedPhone) with the way to link again (VtaLinkScanAgain)
 *   refused-community-notice   after a refusal that unlinked the phone (RemovedPhone, the end state: My Agent's "removed,
 *                              link again"), C's route asks to link first (JoinNeedsAgent) and never says "didn't
 *                              answer". A refusal that left the link (a persona-only one): C's screen shows
 *                              PersonaAgentNotice saying the agent no longer accepts this phone, never "didn't answer",
 *                              and Open My Agent (PersonaAgentNoticeOpen) leads there
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
import { restartApp } from "./lib/flows.js";
import { join } from "./lib/pages/join.js";
import { createRows } from "./lib/rows.js";
import { createHvAdmin, soleRequestSince } from "./openvtc/hvAdmin.js";

const UDID = process.env.UDID;
const C_DID = process.env.C_DID;
/** The refused wording (en.json VtaLink.PersonaAgentRefusedLine) and the one it must never be (…UnreachableLine). */
const REFUSED_LINE = /no longer accepts this phone/i;
const UNREACHABLE_LINE = /didn't answer/i;
/** The persona inbox's own line for a refusal (vtiPersonaInbox.ts releaseWarn "[VTI] persona inbox (…): <why>"). */
const REFUSAL_LOG = /\[VTI\] persona inbox[^\n]*(refus|not in ACL|no longer accepts|permission ?denied)/i;
// REFUSED_PATH: "relaunch" (default) reopens the app, so the persona inbox asks the agent again (refetchPersonaKeys);
// "heartbeat" keeps it open past AgentPresence's 5 min tick, which also meets NOT_ON_ACL (bifold #454). Rows of the
// heartbeat path are named refused-heartbeat-*.
const HEARTBEAT = process.env.REFUSED_PATH === "heartbeat";
// Two of AgentPresence's 5 min ticks after the removal, so a window that starts just after a tick still holds one (362 s
// could miss it: 1022-1726). REFUSED_HEARTBEAT_S overrides it.
const HEARTBEAT_S = Number(process.env.REFUSED_HEARTBEAT_S || 660);
// The build says, on C's Join route, that the agent no longer accepts this phone (bifold #473; the leg reads the bundle).
const JOIN_LINE = process.env.REFUSED_JOIN_LINE === "1";
const N = (name) => (HEARTBEAT ? name.replace(/^refused-/, "refused-heartbeat-") : name);
const rows = createRows({
  label: "refused",
  needs: {
    [N("refused-before")]: [N("refused-member-joined")],
    [N("refused-no-toast")]: [N("refused-before")],
    [N("refused-link-removed")]: [N("refused-before")],
    [N("refused-community-notice")]: [N("refused-before")],
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
  await rows.row(N("refused-member-joined"), async () => {
    await join.openCommunity(d, { did: C_DID, name: "" });
    await join.ask(d, { tag: "refused" });
    await join.awaitSent(d, { required: true });
    // C is shared with other legs (kk, beside this one on the MacBook): approve only when this phone's request is the
    // one new request, and remember only the member it made, so the cleanup never removes someone else's (review on #549).
    const { req, count } = await soleRequestSince(() => admin.joinRequests("pending"), since);
    if (!req && !count) throw new Error("no pending join request from this phone reached the community");
    if (!req) return { skip: `${count} join requests on C since this step began (read twice, 5 s apart): another run is joining, so none is approved and this run cannot judge the app` };
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
  await rows.row(N("refused-before"), async () => {
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
  // The link's connection as My Agent shows it (VtaStatusText: online, connecting, reconnecting, offline, gone), or
  // "removed" once the link is: presence ticks only while the link is online (vtaPresence.ts isLinkOnline), so a link
  // that was not online never meets the refusal. On 267 presence logs only failures, so this is the tick's only witness.
  const linkStatus = async () => {
    await tapTestId(d, "MyAgent", 15000);
    const status = (await existsTestId(d, "RemovedPhone", 3000)) ? "removed" : await textOf(d, "VtaStatusText").catch(() => "(no status line)");
    await tapTestId(d, "Contacts", 15000).catch(() => undefined);
    return status;
  };
  const statusBefore = await linkStatus();
  console.log(`[e2e] link status before the removal: ${statusBefore}`);
  adb("logcat", "-c");
  const removedAt = Date.now();
  for (const e of mine) {
    deleteAcl({ slug: link.slug, pnmHome: link.pnmHome, subject: e.subject });
    console.log(`[e2e] removed this phone's entry ${e.subject.slice(0, 32)}… (${e.label ?? "-"}) from ${link.slug}`);
  }

  // 4a. relaunch: the person opens the app again. A live session never asks the agent again: the persona inbox only
  // "listens" while connected, and asks the agent (refetchPersonaKeys, where the refusal comes back) only when the
  // persona's borrowed key is not in memory: after an install, a restart or a lock (vtiPersonaInbox.ts; 1022-0523 waited
  // on a live session for ~3 min and nothing could refuse). So relaunch, unlock, and watch another screen 95 s.
  // 4b. heartbeat: stay open, no relaunch, past AgentPresence's 5 min tick (bifold #454), on another screen.
  if (!HEARTBEAT) { await restartApp(d); await unlockToHome(d); }
  const from = HEARTBEAT ? removedAt : Date.now();
  const windowMs = HEARTBEAT ? HEARTBEAT_S * 1000 : 95000;
  await tapTestId(d, "Contacts", 15000).catch(() => undefined);
  let toast = "";
  // heartbeat: the link's status each minute, kept as its changes ("+Ns status"); the watch ends 30 s after the removal shows.
  const statuses = [];
  let nextSample = Date.now(), removedSeenAt = 0;
  for (let until = from + windowMs; Date.now() < until && !toast; await sleep(2000)) {
    if (await existsTestId(d, "Toast", 500)) toast = (await textOf(d, "ToastTitle").catch(() => "")) || "(a toast)";
    if (!HEARTBEAT || removedSeenAt || Date.now() < nextSample) continue;
    nextSample = Date.now() + 60000;
    const status = await linkStatus();
    const at = `+${Math.round((Date.now() - removedAt) / 1000)}s ${status}`;
    console.log(`[e2e] link status ${at}`);
    if (statuses.at(-1)?.replace(/^\+\d+s /, "") !== status) statuses.push(at);
    if (status === "removed") { removedSeenAt = Date.now(); until = Math.min(until, removedSeenAt + 30000); }
  }
  if (toast) await screenshot(d, N("refused-toast")).catch(() => undefined);
  const lines = adb("logcat", "-d", "-v", "time").split("\n").filter((l) => REFUSAL_LOG.test(l));
  // The refusal's evidence: the persona inbox's line (relaunch), or the link itself removed (heartbeat, read below).
  let evidence = lines.length > 0;
  const secs = Math.round(windowMs / 1000);

  // 5. My Agent: the link is removed, with the way to link again.
  let removedShown = false;
  await rows.row(N("refused-link-removed"), async () => {
    await tapTestId(d, "MyAgent", 15000);
    removedShown = await existsTestId(d, "RemovedPhone", 30000);
    const again = removedShown && Boolean(await scrollToTestId(d, "VtaLinkScanAgain", 4).catch(() => false));
    await screenshot(d, N("refused-my-agent")).catch(() => undefined);
    const link = HEARTBEAT ? ` · link before: ${statusBefore} · after: ${statuses.join(", ") || "(not sampled)"}` : ` · link before: ${statusBefore}`;
    return { ok: removedShown && again, detail: `${HEARTBEAT ? `open ${Math.round((Date.now() - removedAt) / 1000)} s after the removal, no relaunch` : "after a relaunch"} · RemovedPhone ${removedShown} · link again (VtaLinkScanAgain) ${again}${link}` };
  });
  if (HEARTBEAT) evidence = evidence || removedShown;
  // No toast proves nothing unless the refusal happened in the window: without its evidence the row is no verdict.
  if (!toast && !evidence) rows.skip(N("refused-no-toast"), `no verdict: no sign of the refusal (no persona inbox line${HEARTBEAT ? ", no RemovedPhone" : ""}) in the ${secs} s window`);
  else await rows.row(N("refused-no-toast"), () => toast
    ? { ok: false, detail: `a toast showed on Contacts: "${toast}" (${evidence ? "with the refusal seen" : "no refusal seen yet"})` }
    : { ok: true, detail: `no toast on Contacts for ${secs} s; the refusal landed: ${lines[0]?.trim().slice(0, 140) ?? "the link shows removed (RemovedPhone)"}` });

  // 6. (relaunch only: the heartbeat path does not ask the persona inbox) C's screen says the agent refused this phone, never that it didn't answer, and leads to My Agent.
  if (HEARTBEAT) rows.skip(N("refused-community-notice"), "the heartbeat path: the persona inbox is not asked until the app reopens (the relaunch path checks this)");
  else await rows.row(N("refused-community-notice"), async () => {
    const n = await communityNotice(d);
    await screenshot(d, N("refused-community")).catch(() => undefined);
    if (removedShown) {
      // The refusal unlinked the phone: the person is told on My Agent (refused-link-removed). An unlinked phone has no
      // community screen to carry a notice, so C's route asks to link first, and must never blame the agent's silence.
      // With bifold #473 the route says why instead (JoinAgentRefused, read a beat after the screen: the identity is read
      // async) and leads to My Agent; before it, it asks to link first (pre-fix).
      const unreachable = UNREACHABLE_LINE.test(n.line);
      if (JOIN_LINE) {
        const shown = await existsTestId(d, "JoinAgentRefused", 15000);
        const line = shown ? await textOf(d, "JoinAgentRefused").catch(() => "") : "";
        const needsAgent = await existsTestId(d, "JoinNeedsAgent", 1000);
        let opened = false;
        if (shown && (await existsTestId(d, "JoinOpenMyAgent", 3000))) {
          await tapTestId(d, "JoinOpenMyAgent", 10000);
          opened = await existsTestId(d, "RemovedPhone", 15000);
        }
        const refused = REFUSED_LINE.test(line), silent = UNREACHABLE_LINE.test(line) || unreachable;
        return { ok: shown && refused && !silent && !needsAgent && opened, detail: `unlinked: JoinAgentRefused ${shown} · line "${line.slice(0, 90)}" · refused wording ${refused} · "didn't answer" ${silent} · JoinNeedsAgent ${needsAgent} (expected absent) · Open My Agent lands there ${opened}` };
      }
      const needsAgent = await existsTestId(d, "JoinNeedsAgent", 5000);
      return { ok: needsAgent && !unreachable, detail: `unlinked, expected: Link your agent first (pre-fix) · JoinNeedsAgent ${needsAgent} · PersonaAgentNotice ${n.shown} · "didn't answer" ${unreachable}` };
    }
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
