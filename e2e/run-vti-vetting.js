/**
 * Two devices, the whole vetting guide, no terminal in the room.
 *
 *   iOS is the VETTER: its persona is a member holding the vetter grant.
 *   Android is the APPLICANT: a fresh persona, vetted in one session.
 *
 *   iOS  → Vetting → New ticket → the link
 *   Android → forget community → Vetting → identity → legal name → start →
 *             paste the link → Request            (iOS: Accepted, automatically)
 *   iOS  → Open session                            (both: the same XXXX-XXXX)
 *   Android → Send my card                         (iOS: card received)
 *   iOS  → Attest                                  (Android: statement received, 1 of 1)
 *   Android → Apply                                → allow → Member · Vetted
 *
 * Usage: E2E_KEEP_STATE=1 node run-vti-vetting.js   (PLATFORMS=android,ios)
 */
import { createSession, ensureAppium, stopAppium, screenshot, dumpSource, sleep, scrollToTestId, waitForTestId, byTestId, tapTestIdByCoordinates, tapElement, tapTestIdReliable } from "./lib/driver.js";
import { androidCaps, iosCaps, TEST_ID_PREFIX } from "./lib/config.js";
import { openDeveloperScreen, unlockIfLocked } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const INVITE = path.resolve(here, "../scripts/openvtc/local-vti-stack/invite-persona.sh");
const APPROVER = path.resolve(here, "../scripts/openvtc/local-vti-stack/approver-setup.sh");
const platforms = (process.env.PLATFORMS || "android,ios").split(",");
// E2E_REFUSAL=revoked-grant stages the refusal a community can actually see:
// the vetter's grant is revoked after the statement is issued and before the
// applicant applies. The statement then stops counting, the community answers
// `requestMore` ("vetting:statements:1") and the request stays open as
// DEFERRED — so this is also the live run of the applicant's way out, which
// withdraws it. The grant is re-issued afterwards, whatever happened.
const REFUSAL = process.env.E2E_REFUSAL || "";
const ADMIN = path.resolve(here, "../tsp-reference/ref-20-local-vetting/vtc-admin.mjs");
const STACK_ENV = path.join(process.env.STACK_DIR || path.join(process.env.HOME, "vti-stack"), "stack.env");
/** One vtc-admin call, as the lab's community administrator; returns its JSON. */
function admin(...args) {
  const env = Object.fromEntries(
    readFileSync(STACK_ENV, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
  );
  const out = execFileSync("node", [ADMIN, `${env.VTC_URL}/v1`, env.VTC_DID, path.join(path.dirname(STACK_ENV), "vtc-admin-credential.json"), ...args], { encoding: "utf8" });
  const json = out.slice(out.indexOf("{"));
  return json ? JSON.parse(json) : undefined;
}
/** The vetter this run's desk belongs to: the live grant whose profile was published last. */
function currentVetter() {
  const { vetters = [] } = admin("vetters-list") ?? {};
  const live = vetters.filter((v) => v.live && !v.revoked);
  live.sort((a, b) => String(b.profile?.updatedAt ?? "").localeCompare(String(a.profile?.updatedAt ?? "")));
  if (!live[0]) throw new Error("no live vetter grant to revoke");
  return live[0];
}
const deferredCount = () => (admin("join-list", "deferred")?.items ?? []).length;
let revokedVetterDid;
const LEGAL_NAME = process.env.E2E_LEGAL_NAME || "Alice Example";
const keep = (caps) => ({ ...caps, "appium:fullReset": false, "appium:noReset": true, "appium:enforceAppInstall": false });
const textOf = async (d, key) => (await byTestId(d, key).getAttribute(d.e2ePlatform === "ios" ? "label" : "text")) || "";
const isIos = (d) => d.e2ePlatform === "ios";
// The applicant screen has two inputs mid-page: drag from below them.
const LOW = { from: 0.86 };
// The desk lists requests newest first and XCUITest reports off-screen
// elements too, so an old request's "Statement issued" or Attest button
// satisfies a page-wide lookup. Scope the vetter's lookups to the first
// (current) VettingDeskRequest container.
const inCurrentRequest = (d, key) => {
  const attr = isIos(d) ? "@name" : "@resource-id";
  return d.$(`(//*[${attr}="${TEST_ID_PREFIX}VettingDeskRequest"])[1]//*[${attr}="${TEST_ID_PREFIX}${key}"]`);
};
async function waitInCurrentRequest(d, key, ms = 60000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const el = inCurrentRequest(d, key);
    if (await el.isExisting().catch(() => false)) return el;
    await sleep(2000);
  }
  throw new Error(`${d.e2ePlatform}: ${key} never appeared in the current desk request`);
}


async function unlockToHome(d) {
  await waitForTestId(d, "EnterPIN", 120000).catch(() => undefined);
  await unlockIfLocked(d);
  // A kept-state app resumes on whatever screen it was left on, and the VTA
  // probe reports with an alert as the Developer screen mounts — which hides
  // every testID behind it until it is dismissed.
  for (let i = 0; i < 4; i++) if (!(await d.acceptAlert().then(() => true, () => false))) break;
  await waitForTestId(d, "Contacts", 300000);
  await sleep(4000);
}
async function openVetting(d) {
  await (await waitForTestId(d, "MyAgent", 30000)).click();
  await sleep(1500);
  // My Agent shows its holdings — the vetting entry among them — only once the
  // phone's VTA session is up. A phone that was enrolled before reconnects on
  // its own, but a cold start offers "Connect my agent" instead and waits to
  // be asked; tap it when it is there.
  const connect = await byTestId(d, "ConnectMyAgentButton");
  if (await connect.isExisting().catch(() => false)) {
    await connect.click();
    console.log(`[e2e] ${d.e2ePlatform}: connecting my agent`);
  }
  await waitForTestId(d, "MyAgentVettingRow", 180000);
  await sleep(1500);
  const row = await scrollToTestId(d, "MyAgentVettingRow", 6);
  await row.click();
  await sleep(1500);
}
async function waitText(d, key, re, ms = 120000) {
  const until = Date.now() + ms;
  let last = "";
  while (Date.now() < until) {
    last = await textOf(d, key).catch(() => "");
    if (re.test(last)) return last;
    await sleep(2500);
  }
  throw new Error(`${d.e2ePlatform}: ${key} never matched ${re} (last: ${last.slice(0, 80)})`);
}

let applicant, vetter, keepalive;
try {
  execFileSync("bash", [INVITE, "--vetting-only"], { stdio: "inherit" });
  execFileSync("bash", [APPROVER, "clear"], { stdio: "ignore" });
  await ensureAppium();
  applicant = await createSession(platforms[0], keep(platforms[0] === "android" ? androidCaps() : iosCaps()));
  vetter = await createSession(platforms[1], keep(platforms[1] === "android" ? androidCaps() : iosCaps()));
  console.log(`[e2e] applicant = ${platforms[0]}, vetter = ${platforms[1]}`);
  keepalive = setInterval(() => { vetter.getWindowSize().catch(() => undefined); applicant.getWindowSize().catch(() => undefined); }, 20000);
  await Promise.all([unlockToHome(applicant), unlockToHome(vetter)]);

  // — vetter: the desk, a ticket
  await openVetting(vetter);
  await waitForTestId(vetter, "VettingYouVetFor", 120000);
  // A desk left over from earlier runs makes every page-wide lookup ambiguous.
  // Publish the vetter's profile — a vetter with none is invisible to the
  // community's listing, so this is part of being a vetter, not a nicety.
  const publish = await scrollToTestId(vetter, "VettingPublishProfileButton", 6).catch(() => undefined);
  if (publish) {
    // `.click()` on this one lands on the accessible Button wrapper and never
    // reaches the Pressable's onPress — measured: the element reports
    // clickable and enabled, the tap returns success, and the handler does not
    // run. The same thing bites the Lockout control, which is why
    // `tapTestIdByCoordinates` exists. Tap the centre of its bounds instead.
    // The button stays disabled until the persona's session is open, and a tap
    // on a disabled Pressable is silently dropped. A persona fresh from the
    // invite rung connects a couple of seconds after the desk renders — the
    // tap landed in that gap on 2026-09-21 and nothing was ever sent. Wait for
    // it to be enabled, and tap again if the first one still went nowhere.
    const enabledBy = Date.now() + 60000;
    while (Date.now() < enabledBy && !(await publish.isEnabled().catch(() => false))) await sleep(1000);
    const tapPublish = () =>
      tapTestIdByCoordinates(vetter, "VettingPublishProfileButton").catch(async () => {
        await publish.click();
      });
    await tapPublish();
    const until = Date.now() + 60000;
    let published = false;
    let retapAt = Date.now() + 15000;
    while (Date.now() < until && !published) {
      published = await byTestId(vetter, "VettingProfilePublished").isExisting().catch(() => false);
      if (!published && Date.now() > retapAt && (await publish.isEnabled().catch(() => false))) {
        await tapPublish();
        retapAt = Date.now() + 15000;
      }
      if (!published) await sleep(2500);
    }
    const err = await textOf(vetter, "VettingError").catch(() => "");
    if (!published) throw new Error(`${vetter.e2ePlatform}: the profile was not published${err ? ` — ${err}` : ""}`);
    console.log(`[e2e] ${vetter.e2ePlatform}: vetter profile published`);
  }
  const clear = await scrollToTestId(vetter, "VettingDeskClearButton", 4).catch(() => undefined);
  if (clear) { await tapTestIdByCoordinates(vetter, "VettingDeskClearButton"); await sleep(2500); console.log(`[e2e] ${vetter.e2ePlatform}: desk cleared`); }
  await scrollToTestId(vetter, "VettingNewTicketButton", 6, { direction: "up" }).catch(() => undefined);
  await waitForTestId(vetter, "VettingNewTicketButton", 20000);
  // Tap-and-verify: publishing the profile adds a line above this button, so
  // the layout can shift between reading its position and tapping it, and the
  // tap then lands on nothing. Retry until a ticket actually appears.
  await tapTestIdReliable(
    vetter,
    "VettingNewTicketButton",
    async () => {
      // The card renders BELOW this button, so a fresh ticket lands off the
      // bottom of the screen: present in the hierarchy, with children the
      // dump cannot populate because they were never laid out. Scroll to it
      // before deciding the tap did nothing.
      await scrollToTestId(vetter, "VettingTicketLink", 4).catch(() => undefined);
      return byTestId(vetter, "VettingTicketLink").isExisting().catch(() => false);
    },
    { attempts: 4, settleMs: 3000 }
  );
  await scrollToTestId(vetter, "VettingTicketLink", 4).catch(() => undefined);
  await waitForTestId(vetter, "VettingTicketLink", 30000);
  const link = (await textOf(vetter, "VettingTicketLink")).trim();
  const code = (await textOf(vetter, "VettingTicketCode")).trim();
  if (!link.startsWith("vetting-ticket:")) throw new Error(`no ticket link on the vetter: ${link.slice(0, 60)}`);
  console.log(`[e2e] ${vetter.e2ePlatform}: ticket ${code} (${link.length} chars)`);
  await screenshot(vetter, "vetting-01-ticket");

  // — applicant: start over, identity, face, application, request
  await openDeveloperScreen(applicant);
  let probe = "";
  for (let i = 0; i < 45; i++) {
    probe = await textOf(applicant, "VtaProbeLog").catch(() => "");
    if (/verdict|no verdict|manifest only|\[VTI-PROBE\] failed|no manifest/.test(probe)) break;
    await sleep(2000);
  }
  for (let i = 0; i < 3; i++) if (!(await applicant.acceptAlert().then(() => true, () => false))) break;
  // Only forget when this phone actually holds a membership. Forgetting wipes
  // the persona too, and re-minting one goes alice -> the DID host over
  // DIDComm through the tunnel, which times out often enough that roughly
  // every other run died there with "the VTA did not answer" — a fixture
  // latency problem that told us nothing about vetting. An applicant needs to
  // be a non-member, not a new identity.
  const alreadyMember = await byTestId(applicant, "MyAgentMembershipRole").isExisting().catch(() => false);
  // A probe that failed means membership is UNKNOWN, not false. Read as false,
  // the reset is skipped and the applicant carries the previous ceremony's
  // vetting state into this one — which is how a run once reported that the
  // vetter never accepted while the applicant's own screen still read
  // "Statement received" from the run before. Measured 2026-09-20, when a 421
  // on DID resolution broke the probe and cost a whole run downstream of it.
  // Unknown therefore resets: the worst case is a persona re-mint we did not
  // need, which is cheap and now reliable.
  const membershipUnknown = /\[VTI-PROBE\] failed/.test(probe);
  if (membershipUnknown) console.log(`[e2e] ${applicant.e2ePlatform}: the probe failed — membership unknown, resetting rather than assuming`);
  // Reset UNCONDITIONALLY. Membership was the wrong thing to key this on: the
  // state that breaks a ceremony is the VETTING state, and the two come apart.
  // An applicant that finished a previous run holds "1 of 1 statements · meets
  // the published requirements", so "Request vetting" has nothing to ask for,
  // no request is sent, and the run reports that the vetter never accepted —
  // which reads as a delivery failure and is a reset that never happened. That
  // cost three runs on 2026-09-20 and very nearly a wrong bug report against a
  // mediator upgrade that had nothing to do with it.
  //
  // The reset costs a persona re-mint, which is cheap and, since the
  // cached-token fix, reliable. Determinism is worth more than the minute.
  if (true) {
    const forget = await scrollToTestId(applicant, "ForgetCommunityButton", 8).catch(() => undefined);
    if (forget) {
      await forget.click();
      await sleep(1500);
      await applicant.acceptAlert().catch(() => undefined);
      console.log(`[e2e] ${applicant.e2ePlatform}: forgot the community (was a member)`);
    }
  } else {
    console.log(`[e2e] ${applicant.e2ePlatform}: not a member — keeping the persona, skipping the re-mint`);
  }
  await applicant.back().catch(() => undefined); await sleep(800); await applicant.back().catch(() => undefined);
  await openVetting(applicant);
  const create = await byTestId(applicant, "VettingCreateIdentityButton").isExisting();
  if (create) { await byTestId(applicant, "VettingCreateIdentityButton").click(); console.log(`[e2e] ${applicant.e2ePlatform}: creating an identity`); }
  await waitForTestId(applicant, "VettingLegalNameInput", 240000);
  await byTestId(applicant, "VettingLegalNameInput").setValue(LEGAL_NAME);
  // Dismiss the keyboard before looking for the button below it. On iOS the
  // keyboard covers the lower half of the screen, so "Start my application"
  // is never displayed and the scroll gives up after its swipes — which reads
  // as a missing button rather than a hidden one. `hideKeyboard` is avoided
  // deliberately: on Android it sends ESC, which cancels the PIN modal
  // elsewhere in this suite. Tapping a heading is inert on both.
  await byTestId(applicant, "VettingSeatBanner").click().catch(() => undefined);
  await sleep(800);
  // The button stays disabled until the persona's mediator session is up.
  const start = await scrollToTestId(applicant, "VettingStartButton", 4);
  for (let i = 0; i < 30 && !(await start.isEnabled().catch(() => false)); i++) await sleep(2000);
  await tapTestIdByCoordinates(applicant, "VettingStartButton");
  await waitForTestId(applicant, "VettingRequirements", 60000);
  console.log(`[e2e] ${applicant.e2ePlatform}: ${await textOf(applicant, "VettingRequirements")}`);
  // `setValue` with a link this long silently does nothing on iOS often
  // enough to matter: the field keeps its placeholder, "Request vetting" is
  // then tapped with an empty ticket, and the run reports that the vetter
  // never accepted — when nothing was ever sent. Set it, read it back, retry.
  {
    // The Request button is disabled on REACT state (`!ticketLink.trim()`),
    // not on the field's text. `setValue` writes the native text without
    // firing `onChangeText`, so the field can show all 324 characters while
    // the component still believes it is empty — the button stays disabled,
    // the tap is swallowed, and the run reports that the vetter never
    // accepted when nothing was ever sent. So the check that matters is not
    // what the field holds, it is whether the button came alive.
    const field = await scrollToTestId(applicant, "VettingTicketInput", 4);
    let enabled = false;
    for (let i = 0; i < 4 && !enabled; i++) {
      await field.clearValue().catch(() => undefined);
      await field.click().catch(() => undefined); // focus, so typing raises events
      if (i === 0) {
        await field.setValue(link).catch(() => undefined);
      } else {
        await field.addValue(link).catch(() => undefined);
      }
      await sleep(1200);
      enabled = await byTestId(applicant, "VettingRequestButton").isEnabled().catch(() => false);
      const held = ((await field.getAttribute(isIos(applicant) ? "value" : "text")) || "").trim();
      console.log(`[e2e] ${applicant.e2ePlatform}: ticket field ${held.length}/${link.length} chars, request button ${enabled ? "enabled" : "still disabled"}`);
    }
    if (!enabled) throw new Error(`${applicant.e2ePlatform}: the ticket never reached the component — request button stayed disabled`);
    // Typing leaves the keyboard up, which displaces the Request button off
    // the screen: it reports enabled and `visible="false"`, so a coordinate
    // tap computed from its location lands somewhere else entirely and the
    // run reports "request sent" having sent nothing.
    await byTestId(applicant, "VettingSeatBanner").click().catch(() => undefined);
    await sleep(800);
  }
  await scrollToTestId(applicant, "VettingRequestButton", 4);
  // Confirm the tap did something: a request card appears once the request is
  // saved. Without this the run announces "request sent" on a tap it never
  // verified, and the failure surfaces much later as the vetter not accepting.
  await tapTestIdReliable(
    applicant,
    "VettingRequestButton",
    () => byTestId(applicant, "VettingRequestCard").isExisting().catch(() => false),
    { attempts: 4, settleMs: 3000 }
  );
  console.log(`[e2e] ${applicant.e2ePlatform}: request sent`);
  await scrollToTestId(applicant, "VettingRequestStatus", 4, LOW).catch(() => undefined);
  await waitText(applicant, "VettingRequestStatus", /Accepted/i, 120000);
  console.log(`[e2e] ${applicant.e2ePlatform}: accepted`);
  await screenshot(applicant, "vetting-02-accepted");

  // — vetter: open the session
  const open = await scrollToTestId(vetter, "VettingOpenSessionButton", 6);
  await tapElement(vetter, open);
  const codeEl = await waitForTestId(vetter, "VettingMatchCode", 60000);
  const vetterCode = ((await codeEl.getAttribute(isIos(vetter) ? "label" : "text")) || "").trim();
  await screenshot(vetter, "vetting-03-session");

  // — applicant: the same code, then the card
  await scrollToTestId(applicant, "VettingMatchCode", 6, LOW);
  const applicantCode = await waitText(applicant, "VettingMatchCode", /[0-9A-Z]{4}-[0-9A-Z]{4}/, 120000);
  console.log(`[e2e] match code vetter=${vetterCode} applicant=${applicantCode.trim()}`);
  if (vetterCode !== applicantCode.trim()) throw new Error(`match codes differ: ${vetterCode} vs ${applicantCode}`);
  await screenshot(applicant, "vetting-04-match-code");
  await scrollToTestId(applicant, "VettingSendCardButton", 4, LOW);
  await tapTestIdByCoordinates(applicant, "VettingSendCardButton");
  console.log(`[e2e] ${applicant.e2ePlatform}: card sent`);

  // — vetter: the card, the human check, the statement
  // Scroll while waiting. The claim renders inside the request card, below the
  // match code, and on an emulator screen that lands below the fold depending
  // on where the view happened to be scrolled when the card arrived. Waiting
  // in place then times out on a card that is on the page — which is how this
  // step failed about every other run, always reading as the card not
  // arriving. The runbook's trap table already says to scroll before judging;
  // this step never did.
  let claimEl;
  const claimDeadline = Date.now() + 120000;
  while (Date.now() < claimDeadline) {
    claimEl = await scrollToTestId(vetter, "VettingCardClaim", 3).catch(() => undefined);
    if (claimEl && (await claimEl.isExisting().catch(() => false))) break;
    claimEl = undefined;
    await sleep(2000);
  }
  if (!claimEl) throw new Error(`${vetter.e2ePlatform}: the card's claims never appeared, even after scrolling`);
  const claim = (await claimEl.getAttribute(isIos(vetter) ? "label" : "text")) || "";
  if (!new RegExp(LEGAL_NAME).test(claim)) throw new Error(`${vetter.e2ePlatform}: unexpected card claim: ${claim}`);
  console.log(`[e2e] ${vetter.e2ePlatform}: card received — ${claim}`);
  await screenshot(vetter, "vetting-05-card");
  const attest = await scrollToTestId(vetter, "VettingAttestButton", 6);
  await tapElement(vetter, attest);
  await waitForTestId(vetter, "VettingStatementIssued", 60000);
  console.log(`[e2e] ${vetter.e2ePlatform}: statement issued`);
  await screenshot(vetter, "vetting-06-attested");

  // — applicant: the statement, the checklist, the application
  await scrollToTestId(applicant, "VettingChecklist", 6, LOW).catch(() => undefined);
  // A statement the mediator redelivers from an earlier run counts too, so
  // assert the verdict the screen states, not an exact tally.
  const check = await waitText(applicant, "VettingChecklist", /meets the published requirements/, 120000);
  console.log(`[e2e] ${applicant.e2ePlatform}: ${check}`);
  await screenshot(applicant, "vetting-07-checklist");
  // Whether the vetter's grant was checked against the community's status
  // list, and if not, why — a development build prints the stored reason.
  if (await byTestId(applicant, "VettingGrantUnchecked").isExisting().catch(() => false)) {
    const why = await textOf(applicant, "VettingGrantUncheckedReason").catch(() => "(no reason shown)");
    console.log(`[e2e] ${applicant.e2ePlatform}: vetter grant NOT checked — ${why}`);
  } else {
    console.log(`[e2e] ${applicant.e2ePlatform}: vetter grant checked against the status list`);
  }
  if (REFUSAL === "revoked-grant") {
    const vetterGrant = currentVetter();
    revokedVetterDid = vetterGrant.memberDid;
    const deferredBefore = deferredCount();
    const revoked = admin("revoke-endorsement", vetterGrant.endorsementId);
    console.log(`[e2e] community: vetter grant revoked (status-list bit ${revoked?.statusListIndex})`);
    await scrollToTestId(applicant, "VettingApplyButton", 4, LOW);
    await tapTestIdByCoordinates(applicant, "VettingApplyButton");
    await scrollToTestId(applicant, "VettingSubmissionState", 6, LOW).catch(() => undefined);
    const deferred = await waitText(applicant, "VettingSubmissionState", /asked for more/i, 120000);
    console.log(`[e2e] ${applicant.e2ePlatform}: ${deferred}`);
    if (!/vetting:statements/.test(deferred)) throw new Error(`${applicant.e2ePlatform}: deferred without naming the missing statement: ${deferred}`);
    await screenshot(applicant, "vetting-refusal-01-deferred");
    await scrollToTestId(applicant, "VettingWithdrawButton", 4, LOW);
    await tapTestIdByCoordinates(applicant, "VettingWithdrawButton");
    const withdrawn = await waitText(applicant, "VettingSubmissionState", /withdrew/i, 60000);
    console.log(`[e2e] ${applicant.e2ePlatform}: ${withdrawn}`);
    await screenshot(applicant, "vetting-refusal-02-withdrawn");
    const deferredNow = deferredCount();
    console.log(`[e2e] community: deferred requests ${deferredBefore} before the apply, ${deferredNow} after the withdraw`);
    if (deferredNow > deferredBefore) throw new Error("the withdrawn request is still listed as deferred");
    printSuccess("vti-vetting (revoked grant → deferred → withdrawn)");
    process.exitCode = 0;
  } else {
  await scrollToTestId(applicant, "VettingApplyButton", 4, LOW);
  await tapTestIdByCoordinates(applicant, "VettingApplyButton");
  // The member line sits at the top of the screen; wait for the verdict, then scroll back up.
  await sleep(8000);
  await scrollToTestId(applicant, "VettingAlreadyMember", 8, { ...LOW, direction: "up" }).catch(() => undefined);
  const member = await waitText(applicant, "VettingAlreadyMember", /member/i, 120000);
  console.log(`[e2e] ${applicant.e2ePlatform}: ${member}`);
  await screenshot(applicant, "vetting-08-member");

  printSuccess("vti-vetting");
  process.exitCode = 0;
  }
} catch (err) {
  printFailure("vti-vetting", err);
  for (const [d, name] of [[applicant, "applicant"], [vetter, "vetter"]]) {
    if (d) { try { await screenshot(d, `vetting-failure-${name}`); await dumpSource(d, `vetting-failure-${name}`); } catch { /* ignore */ } }
  }
  process.exitCode = 1;
} finally {
  if (keepalive) clearInterval(keepalive);
  try { execFileSync("bash", [INVITE, "--restore-invited"], { stdio: "ignore" }); } catch { /* best effort */ }
  if (revokedVetterDid) {
    // A revoked grant cannot be un-revoked; issue a new one and hand it over.
    try {
      admin("vetter-grant", revokedVetterDid);
      // Straight after a grant the community asks for a moment
      // (`retryAfterSecs: 2`); give it one, twice if need be.
      for (let attempt = 1; ; attempt++) {
        await sleep(3000);
        try { admin("vetter-resend", revokedVetterDid); break; } catch (e) { if (attempt >= 3) throw e; }
      }
      console.log("[e2e] community: vetter grant re-issued");
    } catch (e) {
      console.log(`[e2e] community: could not re-issue the vetter grant — ${e?.message ?? e}`);
    }
  }
  for (const d of [applicant, vetter]) { if (d) { try { await d.deleteSession(); } catch { /* ignore */ } } }
  stopAppium();
}
