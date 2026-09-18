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
import { createSession, ensureAppium, stopAppium, screenshot, dumpSource, sleep, scrollToTestId, waitForTestId, byTestId } from "./lib/driver.js";
import { androidCaps, iosCaps } from "./lib/config.js";
import { openDeveloperScreen, unlockIfLocked } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const INVITE = path.resolve(here, "../scripts/openvtc/local-vti-stack/invite-persona.sh");
const APPROVER = path.resolve(here, "../scripts/openvtc/local-vti-stack/approver-setup.sh");
const platforms = (process.env.PLATFORMS || "android,ios").split(",");
const LEGAL_NAME = process.env.E2E_LEGAL_NAME || "Alice Example";
const keep = (caps) => ({ ...caps, "appium:fullReset": false, "appium:noReset": true, "appium:enforceAppInstall": false });
const textOf = async (d, key) => (await byTestId(d, key).getAttribute(d.e2ePlatform === "ios" ? "label" : "text")) || "";
const isIos = (d) => d.e2ePlatform === "ios";
// The applicant screen has two inputs mid-page: drag from below them.
const LOW = { from: 0.86 };

async function unlockToHome(d) {
  await waitForTestId(d, "EnterPIN", 120000).catch(() => undefined);
  await unlockIfLocked(d);
  await waitForTestId(d, "Contacts", 300000);
  await sleep(4000);
}
async function openVetting(d) {
  await (await waitForTestId(d, "MyAgent", 30000)).click();
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
  await (await waitForTestId(vetter, "VettingNewTicketButton", 20000)).click();
  await waitForTestId(vetter, "VettingTicketLink", 30000);
  const link = (await textOf(vetter, "VettingTicketLink")).trim();
  const code = (await textOf(vetter, "VettingTicketCode")).trim();
  if (!link.startsWith("vetting-ticket:")) throw new Error(`no ticket link on the vetter: ${link.slice(0, 60)}`);
  console.log(`[e2e] ${vetter.e2ePlatform}: ticket ${code} (${link.length} chars)`);
  await screenshot(vetter, "vetting-01-ticket");

  // — applicant: start over, identity, face, application, request
  await openDeveloperScreen(applicant);
  for (let i = 0; i < 45; i++) {
    const community = await textOf(applicant, "VtaProbeLog").catch(() => "");
    if (/verdict|no verdict|\[VTI-PROBE\] failed|no manifest/.test(community)) break;
    await sleep(2000);
  }
  for (let i = 0; i < 3; i++) if (!(await applicant.acceptAlert().then(() => true, () => false))) break;
  const forget = await scrollToTestId(applicant, "ForgetCommunityButton", 8).catch(() => undefined);
  if (forget) { await forget.click(); await sleep(1500); await applicant.acceptAlert().catch(() => undefined); }
  await applicant.back().catch(() => undefined); await sleep(800); await applicant.back().catch(() => undefined);
  await openVetting(applicant);
  const create = await byTestId(applicant, "VettingCreateIdentityButton").isExisting();
  if (create) { await byTestId(applicant, "VettingCreateIdentityButton").click(); console.log(`[e2e] ${applicant.e2ePlatform}: creating an identity`); }
  await waitForTestId(applicant, "VettingLegalNameInput", 240000);
  await byTestId(applicant, "VettingLegalNameInput").setValue(LEGAL_NAME);
  // The button stays disabled until the persona's mediator session is up.
  const start = await scrollToTestId(applicant, "VettingStartButton", 4);
  for (let i = 0; i < 30 && !(await start.isEnabled().catch(() => false)); i++) await sleep(2000);
  await start.click();
  await waitForTestId(applicant, "VettingRequirements", 60000);
  console.log(`[e2e] ${applicant.e2ePlatform}: ${await textOf(applicant, "VettingRequirements")}`);
  await (await scrollToTestId(applicant, "VettingTicketInput", 4)).setValue(link);
  await (await scrollToTestId(applicant, "VettingRequestButton", 4)).click();
  console.log(`[e2e] ${applicant.e2ePlatform}: request sent`);
  await scrollToTestId(applicant, "VettingRequestStatus", 4, LOW).catch(() => undefined);
  await waitText(applicant, "VettingRequestStatus", /Accepted/i, 120000);
  console.log(`[e2e] ${applicant.e2ePlatform}: accepted`);
  await screenshot(applicant, "vetting-02-accepted");

  // — vetter: open the session
  await scrollToTestId(vetter, "VettingOpenSessionButton", 6);
  await waitText(vetter, "VettingDeskStatus", /accepted|waiting/i, 60000);
  await (await scrollToTestId(vetter, "VettingOpenSessionButton", 4)).click();
  await waitForTestId(vetter, "VettingMatchCode", 60000);
  const vetterCode = (await textOf(vetter, "VettingMatchCode")).trim();
  await screenshot(vetter, "vetting-03-session");

  // — applicant: the same code, then the card
  await scrollToTestId(applicant, "VettingMatchCode", 6, LOW);
  const applicantCode = await waitText(applicant, "VettingMatchCode", /[0-9A-Z]{4}-[0-9A-Z]{4}/, 120000);
  console.log(`[e2e] match code vetter=${vetterCode} applicant=${applicantCode.trim()}`);
  if (vetterCode !== applicantCode.trim()) throw new Error(`match codes differ: ${vetterCode} vs ${applicantCode}`);
  await screenshot(applicant, "vetting-04-match-code");
  await (await scrollToTestId(applicant, "VettingSendCardButton", 4, LOW)).click();
  console.log(`[e2e] ${applicant.e2ePlatform}: card sent`);

  // — vetter: the card, the human check, the statement
  await scrollToTestId(vetter, "VettingCardClaim", 6).catch(() => undefined);
  const claim = await waitText(vetter, "VettingCardClaim", new RegExp(LEGAL_NAME), 120000);
  console.log(`[e2e] ${vetter.e2ePlatform}: card received — ${claim}`);
  await screenshot(vetter, "vetting-05-card");
  await (await scrollToTestId(vetter, "VettingAttestButton", 4)).click();
  await waitForTestId(vetter, "VettingStatementIssued", 60000);
  console.log(`[e2e] ${vetter.e2ePlatform}: statement issued`);
  await screenshot(vetter, "vetting-06-attested");

  // — applicant: the statement, the checklist, the application
  await scrollToTestId(applicant, "VettingChecklist", 6, LOW).catch(() => undefined);
  const check = await waitText(applicant, "VettingChecklist", /1 of 1/, 120000);
  console.log(`[e2e] ${applicant.e2ePlatform}: ${check}`);
  await screenshot(applicant, "vetting-07-checklist");
  await (await scrollToTestId(applicant, "VettingApplyButton", 4, LOW)).click();
  // The member line sits at the top of the screen; wait for the verdict, then scroll back up.
  await sleep(8000);
  await scrollToTestId(applicant, "VettingAlreadyMember", 8, { ...LOW, direction: "up" }).catch(() => undefined);
  const member = await waitText(applicant, "VettingAlreadyMember", /member/i, 120000);
  console.log(`[e2e] ${applicant.e2ePlatform}: ${member}`);
  await screenshot(applicant, "vetting-08-member");

  printSuccess("vti-vetting");
  process.exitCode = 0;
} catch (err) {
  printFailure("vti-vetting", err);
  for (const [d, name] of [[applicant, "applicant"], [vetter, "vetter"]]) {
    if (d) { try { await screenshot(d, `vetting-failure-${name}`); await dumpSource(d, `vetting-failure-${name}`); } catch { /* ignore */ } }
  }
  process.exitCode = 1;
} finally {
  if (keepalive) clearInterval(keepalive);
  try { execFileSync("bash", [INVITE, "--restore-invited"], { stdio: "ignore" }); } catch { /* best effort */ }
  for (const d of [applicant, vetter]) { if (d) { try { await d.deleteSession(); } catch { /* ignore */ } } }
  stopAppium();
}
