#!/usr/bin/env node
/**
 * 235 evidence (Alberto, 10-06): the community card's "Show the code they see" WHILE a join is still waiting.
 * On a linked Android phone: open C by its link, Ask to join (the admin-review way), then My Agent → the card's
 * identity line → screenshot community-card-waiting.png into PERSONA_SHOTS. Prints `PERSONA-DID …` and
 * `WAITING-STATUS …`. The caller declines the request afterwards, unless JOIN_APPROVE=1.
 *
 * JOIN_APPROVE=1 (C_ADMIN="<rest> <did> <admin credential>"): flow B, a plain join approved by the community.
 * After the waiting checks the community's admin approves the request, and the rows are:
 *   join-request-is-mine     (a) the newest pending request is from the identity the phone showed
 *   join-approved-card       (b) Your agent's card for C turns to member: on its own within 90 s, else after Check now
 *   join-approved-listed     (c) the community lists that identity as a member
 *   join-approved-wallet     (d) the Wallet shows C's membership card
 * Always, before approving: choose-how-to-join (#326): C's screen offers "Choose how to join" → Join.
 * Prints `JOIN_MEMBER <did>` so the caller removes the member afterwards.
 *   E2E_APP_ID=… UDID=emulator-5572 C_DID=… C_NAME="Keyring Lab Community" PERSONA_SHOTS=<dir> node run-join-waiting.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsTestId, scrollToTestId, sleep, stopAppium, tapTestId, waitForTestId, ensureAppium, screenshot } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { handleBiometricConfirmIfPresent, pasteLinkFromHome } from "./lib/flows.js";
import { capturePersonaDid, footClear } from "./lib/personaDid.js";
import { communityCardKey } from "./lib/testIdKeys.js";

const C_DID = process.env.C_DID;
const key = communityCardKey(C_DID || "");
const C_NAME = process.env.C_NAME || "Keyring Lab Community";
const ADMIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../tsp-reference/ref-20-local-vetting/vtc-admin.mjs");
const admin = (...a) =>
  execFileSync("node", [ADMIN, ...(process.env.C_ADMIN || "").split(" ").filter(Boolean), ...a], { encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] });
const json = (t) => JSON.parse(t.slice(t.indexOf("{")));
const row = (name, ok, detail) => console.log(`ROW ${name} ${ok ? "PASS" : "FAIL"} — ${detail}`);
const log = (m) => console.log(`[e2e] ${new Date().toISOString().slice(11, 23)}Z ${m}`);
/** C's status on Your agent, polled up to `tries` × 1.5 s: the status line, else the row's own label after ", ". */
async function statusOf(d, tries) {
  let status = "";
  for (let i = 0; i < tries && !status; i++) {
    await sleep(1500);
    status = (await textOf(d, `AgentCommunityStatus_${key}`).catch(() => "")).replace(/\s+/g, " ").trim();
    if (!status) {
      for (const id of [`AgentCommunityOpen_${key}`, "AgentMembershipRow"]) {
        const el = await d.$(`android=new UiSelector().resourceId("com.ariesbifold:id/${id}")`);
        const label = String((await el.getAttribute("content-desc").catch(() => "")) || "");
        if (label.includes(", ")) status = label.slice(label.indexOf(", ") + 2).trim();
        if (status) break;
      }
    }
  }
  return status;
}

/** The card's own words for a member ("You're a member of <C>."), not any status that mentions members. */
const isMember = (status) => /you(?:'|’)?re a member/i.test(status);

/**
 * #326 (IN-127): C's own screen never sends a request; its button is "Choose how to join" and leads to Join's
 * ways in. Opened from Your agent's card for C while this phone's request waits. Row: choose-how-to-join.
 */
async function chooseHowToJoin(d) {
  await tapTestId(d, "MyAgent", 10000).catch(() => undefined);
  const open = (await existsTestId(d, `AgentCommunityOpen_${key}`, 5000)) ? `AgentCommunityOpen_${key}` : (await existsTestId(d, "AgentMembershipRow", 1500)) ? "AgentMembershipRow" : "";
  if (!open) return row("choose-how-to-join", false, `no card for C on Your agent (AgentCommunityOpen_${key})`);
  await tapTestId(d, open, 10000);
  const btn = await scrollToTestId(d, "ApplyToCommunityButton", 6).catch(() => undefined);
  const words = btn ? String((await btn.getAttribute("text").catch(() => "")) || (await textOf(d, "ApplyToCommunityButton").catch(() => ""))).trim() : "";
  if (!btn) {
    await screenshot(d, "choose-how-to-join-missing").catch(() => undefined);
    return row("choose-how-to-join", false, "C's screen shows no ApplyToCommunityButton");
  }
  await btn.click();
  let landed = "";
  for (const id of ["JoinWays", "JoinAsks", "JoinStanding", "JoinAsk"]) if (!landed && (await existsTestId(d, id, id === "JoinWays" ? 15000 : 2000))) landed = id;
  await screenshot(d, "choose-how-to-join").catch(() => undefined);
  row("choose-how-to-join", Boolean(landed) && !/apply to join/i.test(words), `button "${words || "?"}" → ${landed || "no Join screen"}`);
  await tapTestId(d, "MyAgent", 10000).catch(() => undefined);
}

/**
 * 238 (#344): Join for a member says so (JoinMemberCheck) and ends on Done, which goes to Your agent with C's card
 * set apart (AgentCommunityHighlighted). Rows: join-done-member, join-done-highlight.
 */
async function doneFlow(d) {
  await tapTestId(d, "MyAgent", 10000).catch(() => undefined);
  await pasteLinkFromHome(d, `keyring://vti/community?d=${encodeURIComponent(C_DID)}&n=${encodeURIComponent(C_NAME)}`);
  const check = await existsTestId(d, "JoinMemberCheck", 30000);
  const done = Boolean(await scrollToTestId(d, "JoinDone", 4, { from: 0.5 }).catch(() => undefined));
  const open = await existsTestId(d, "JoinOpenCommunity", 1500);
  await screenshot(d, "join-done-member").catch(() => undefined);
  row("join-done-member", check && done, `JoinMemberCheck ${check} · JoinDone ${done} · JoinOpenCommunity ${open}`);
  // IN-142 (239 re-pin): a member's Join still offers "A different community", and it opens the scanner (#344 hid
  // it, a dead end for joining a second community).
  const other = await scrollToTestId(d, "JoinScanCommunity", 4, { from: 0.5 }).catch(() => undefined);
  let scanner = false;
  if (other) {
    await other.click();
    for (let i = 0; i < 3 && !scanner; i++) {
      scanner = await existsTestId(d, "PasteUrlButton", 5000);
      if (!scanner && (await existsTestId(d, "Continue", 1500))) await tapTestId(d, "Continue", 5000).catch(() => undefined);
    }
    await screenshot(d, "member-join-different-community").catch(() => undefined);
    await d.back().catch(() => undefined);
    await existsTestId(d, "JoinMemberCheck", 10000);
  }
  row("member-join-different-community", Boolean(other) && scanner, `JoinScanCommunity on a member's Join ${Boolean(other)} · the scanner opened ${scanner} (IN-142)`);
  await scrollToTestId(d, "JoinDone", 4, { from: 0.5 }).catch(() => undefined);
  if (!done) return row("join-done-highlight", false, "no JoinDone to tap");
  await tapTestId(d, "JoinDone", 10000);
  const home = await existsTestId(d, "AgentHome", 15000);
  const lit = await existsTestId(d, "AgentCommunityHighlighted", 10000);
  await screenshot(d, "join-done-highlight").catch(() => undefined);
  row("join-done-highlight", home && lit, `Your agent ${home} · AgentCommunityHighlighted ${lit}`);
}

/**
 * IN-144 (#362): a member of C, and again after leaving C, scans a vetter's ticket for another community B: Get vetted
 * opens for B with the ticket in hand, and the scanner says nothing about a "different community". Read-only on B (the
 * request is not sent). B is a parameter: COMMUNITY_B_DID and COMMUNITY_B_TICKET_CMD (a shell command printing a fresh
 * vetting-ticket: link for B, from a B vetter on a runner); without them the rows are SKIP.
 */
async function otherTicketFlow(d, me) {
  const B = process.env.COMMUNITY_B_DID;
  const cmd = process.env.COMMUNITY_B_TICKET_CMD;
  if (!B || !cmd) {
    for (const n of ["member-scan-other-ticket", "left-scan-other-ticket"]) console.log(`ROW ${n} SKIP — SKIP: no community B (COMMUNITY_B_DID / COMMUNITY_B_TICKET_CMD unset)`);
    return;
  }
  const scan = async (name, when) => {
    const ticket = execFileSync("bash", ["-c", cmd], { encoding: "utf8", timeout: 120000 }).trim().split("\n").pop();
    if (!/^vetting-ticket:/.test(ticket)) return row(name, false, `${when}: no vetting-ticket from COMMUNITY_B_TICKET_CMD ("${ticket.slice(0, 40)}")`);
    await tapTestId(d, "MyAgent", 10000).catch(() => undefined);
    await pasteLinkFromHome(d, ticket).catch((e) => log(`${name}: ${String(e.message).split("\n")[0]}`));
    const field = await scrollToTestId(d, "VettingTicketInput", 6).catch(() => undefined);
    const held = field ? String((await field.getAttribute("text").catch(() => "")) || "").trim() : "";
    const different = /different community/i.test(await d.getPageSource());
    await screenshot(d, name).catch(() => undefined);
    row(name, held === ticket && !different, `${when}: Get vetted holds B's ticket ${held === ticket} · "different community" shown ${different} (IN-144)`);
    await d.back().catch(() => undefined);
  };
  await scan("member-scan-other-ticket", "a member of C");
  // Leave C (the community removes the member, as the leg's cleanup would), then scan again.
  const said = admin("member-remove", me, "gate: IN-144, left before the second scan").split("\n").filter((l) => /->/.test(l)).pop() ?? "";
  log(`left C: ${said.trim()}`);
  await sleep(10000);
  await scan("left-scan-other-ticket", "after leaving C");
}

/** Flow B: the community's admin approves the waiting request, and the phone must show and hold the membership. */
async function approvedFlow(d, me) {
  const pending = (json(admin("join-list", "pending")).items ?? []).sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  const req = pending.filter((r) => r.applicantDid === me).pop();
  row("join-request-is-mine", Boolean(me && req), req ? `request ${req.id} from ${me}` : `no pending request from ${me ?? "(no identity read)"}; newest is from ${pending.at(-1)?.applicantDid ?? "nobody"}`);
  if (!req) return;
  const said = admin("join-decide", req.id, "approved").split("\n").filter((l) => /->/.test(l)).pop() ?? "";
  log(`admin approves ${req.id}: ${said.trim()}`);
  console.log(`JOIN_MEMBER ${me}`);
  // (b) On its own first: Keyring is told, or finds out at its next read. Then once by Check now.
  const t0 = Date.now();
  let status = "";
  let how = "";
  for (const until = Date.now() + 90000; Date.now() < until && !isMember(status); ) {
    await tapTestId(d, "MyAgent", 10000).catch(() => undefined);
    status = await statusOf(d, 3);
    if (isMember(status)) how = `on its own after ${Math.round((Date.now() - t0) / 1000)} s`;
  }
  if (!isMember(status) && (await existsTestId(d, `AgentCommunityCheck_${key}`, 3000))) {
    await tapTestId(d, `AgentCommunityCheck_${key}`, 10000);
    const t1 = Date.now();
    for (const until = Date.now() + 60000; Date.now() < until && !isMember(status); ) status = await statusOf(d, 3);
    if (isMember(status)) how = `after Check now (${Math.round((Date.now() - t1) / 1000)} s; nothing in the first 90 s)`;
  }
  await screenshot(d, "join-approved-card").catch(() => undefined);
  row("join-approved-card", isMember(status), `${how || "not a member after 90 s and Check now"}; status "${status}"`);
  // (c) The community's own list.
  const members = (json(admin("members")).items ?? []).map((m) => m.did);
  row("join-approved-listed", members.includes(me), members.includes(me) ? `${me} is a member` : `${me} is not among ${members.length} members`);
  // (d) The Wallet card. The Wallet's first-visit tour sits over the list: close it first.
  await tapTestId(d, "Wallet", 10000).catch(() => undefined);
  await sleep(2000);
  for (let i = 0; i < 5 && (await existsTestId(d, "Close", 1500).catch(() => false)); i++) await tapTestId(d, "Close", 5000).catch(() => tapTestId(d, "Next", 5000));
  const card = d.$(`android=new UiSelector().resourceId("com.ariesbifold:id/CredentialName").textContains("${C_NAME}")`);
  let shown = false;
  for (const until = Date.now() + 60000; Date.now() < until && !shown; await sleep(2000)) shown = await card.isExisting().catch(() => false);
  const words = shown ? String(await card.getAttribute("text").catch(() => "")) : "";
  await screenshot(d, "join-approved-wallet").catch(() => undefined);
  row("join-approved-wallet", shown, shown ? `"${words}"` : `no card naming ${C_NAME} in 60 s`);
  if (is238) await doneFlow(d);
  await otherTicketFlow(d, me);
}

let d;
let is238 = false;
try {
  await ensureAppium();
  d = await makeDriver({ platform: "android", udid: process.env.UDID, keepState: true });
  await d.activateApp(process.env.E2E_APP_ID);
  await unlockToHome(d).catch(async (e) => {
    if (!(await existsTestId(d, "MyAgent", 10000))) throw e;
  });
  await pasteLinkFromHome(d, `keyring://vti/community?d=${encodeURIComponent(C_DID)}&n=${encodeURIComponent(C_NAME)}`);
  await scrollToTestId(d, "JoinAsk", 6, { from: 0.45 }).catch(() => undefined);
  const ask = (await existsTestId(d, "JoinAsk", 5000)) ? "JoinAsk" : "JoinStart";
  await tapTestId(d, ask, 15000);
  await waitForTestId(d, "JoinMakeIdentity", 30000).catch(() => undefined);
  if (await existsTestId(d, "JoinAsContinue", 3000)) await tapTestId(d, "JoinAsContinue", 10000);
  await handleBiometricConfirmIfPresent(d).catch(() => undefined);
  log(`asked to join by ${ask}`);
  // Sent: the standing, or the "request was sent" line when the answer is late. Either way, it is waiting.
  const shown = await waitForTestId(d, "JoinStanding", 120000).then(() => "standing", () => "no standing in 120 s");
  log(`Join after sending: ${shown}`);
  // 236: #319 the Join screen names the identity it asked with; #322 its actions end above the tab bar.
  const nameLine = (await existsTestId(d, "JoinStandingIdentityName", 3000)) ? (await textOf(d, "JoinStandingIdentityName")).trim() : "";
  console.log(`JOIN-IDENTITY-NAME ${nameLine || "(none)"}`);
  // #334: the line names the identity as a persona ID; 238 (#344): the bare word, under "You asked to join as".
  const bareWord = /^[a-z]+(?:-[a-z]+)+$/.test(nameLine);
  row("join-persona-id", /^Your persona ID: \S/.test(nameLine) || bareWord, `"${nameLine}"${bareWord ? " (the bare word, #344)" : ""}`);
  // 238 (#344): the waiting state says so in a title and what shows when accepted, and offers no ways in.
  is238 = await existsTestId(d, "JoinRequestSent", 2000);
  if (is238) {
    const willShow = await existsTestId(d, "JoinWillShow", 2000);
    row("join-request-sent", willShow, `JoinRequestSent "${(await textOf(d, "JoinRequestSent").catch(() => "")).trim()}" · JoinWillShow ${willShow}`);
  }
  const actionsY = async () => {
    const el = await d.$(`android=new UiSelector().resourceId("com.ariesbifold:id/JoinActions")`);
    return (await el.isExisting().catch(() => false)) ? Math.round((await el.getLocation()).y) : undefined;
  };
  const yBefore = await actionsY();
  await capturePersonaDid(d, "JoinStandingIdentity", "join-standing-identity");
  // To the very end of the page: the question is whether its last line can rise above the tab bar.
  const { width: w, height: h } = await d.getWindowSize();
  for (let i = 0; i < 4; i++) {
    await d.action("pointer").move({ x: Math.floor(w / 2), y: Math.floor(h * 0.7) }).down().pause(80).move({ x: Math.floor(w / 2), y: Math.floor(h * 0.3), duration: 400 }).up().perform();
    await sleep(600);
  }
  await footClear(d, "JoinActions", "join-actions");
  // #334: Join's buttons scroll with the page (nothing hides behind them), so a swipe moves them.
  const yAfter = await actionsY();
  // Moved by the swipe, or brought into view by it (off screen before, so not in the tree): either way it scrolls.
  // A page that fits above the tab bar has nothing to scroll (238's shorter waiting state): its buttons stay put and
  // in view, which is what the row is for. Otherwise the swipe must move them.
  const { height: wh } = await d.getWindowSize();
  const fits = yBefore !== undefined && yAfter === yBefore && yAfter < wh * 0.85;
  row("join-actions-scroll", (yAfter !== undefined && yAfter !== yBefore) || fits, fits ? `the page fits: JoinActions stays at y ${yAfter} of ${wh}, in view (nothing to scroll)` : `JoinActions y ${yBefore ?? "off screen"} → ${yAfter ?? "absent"} after swiping`);
  if (is238) {
    // Swiped to the end of the page: no ways in anywhere on it while the request waits.
    const ways = (await existsTestId(d, "JoinWays", 1500)) || (await existsTestId(d, "JoinWaysOthers", 500));
    row("join-waiting-no-ways", !ways, ways ? "the waiting state still shows ways in" : "no JoinWays while waiting");
  }
  await tapTestId(d, "MyAgent", 15000);
  // The status settles after the journey read; it is the row's own label after the first ", " (one accessible
  // element: AgentCommunityOpen_<key> or AgentMembershipRow), or the status child's text on Android.
  const status = await statusOf(d, 10);
  console.log(`WAITING-STATUS ${status || "(no status line)"}`);
  const me = await capturePersonaDid(d, `AgentCommunityIdentity_${key}`, "community-card-waiting");
  await screenshot(d, "community-card-waiting").catch(() => undefined);
  await chooseHowToJoin(d);
  if (process.env.JOIN_APPROVE === "1") await approvedFlow(d, me);
} catch (e) {
  log(`error: ${e.message.split("\n")[0]}`);
  if (d) await screenshot(d, "community-card-waiting-failure").catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
