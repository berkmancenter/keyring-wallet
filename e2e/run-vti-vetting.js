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
 * Two real iOS devices: PLATFORMS=ios,ios APPLICANT_IOS_UDID=… VETTER_IOS_UDID=…
 *   (each gets its own WebDriverAgent port: 8131 applicant, 8130 vetter)
 */
import { createSession, deviceTag, ensureAppium, stopAppium, screenshot, dumpSource, sleep, scrollToTestId, waitForTestId, byTestId, existsTestId, tapTestIdByCoordinates, tapElement, tapTestIdReliable } from "./lib/driver.js";
import { androidCaps, iosCaps, iosDeviceCaps, TEST_ID_PREFIX } from "./lib/config.js";
import os from "node:os";
import { handleBiometricConfirmIfPresent, leaveCommunityInApp, pasteLinkFromHome, unlockIfLocked } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";
import { holdCriteriaLock } from "./lib/criteriaLock.js";
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
// E2E_REFUSAL=supplement: the same deferral, answered in place — the grant is
// re-issued, and the applicant's second apply supplements the open request.
// E2E_REFUSAL=dead-grant: the ticket is issued while the grant is live, the
// grant is revoked before the applicant redeems it, and the same ticket is
// used again after the role is restored. It proves the refusal does not SPEND
// the ticket — "a refusal happened" is equally true of a version that burns
// it, which is what the tidier-looking code does.
const REFUSAL = process.env.E2E_REFUSAL || "";
const ADMIN = path.resolve(here, "../tsp-reference/ref-20-local-vetting/vtc-admin.mjs");
const STACK_ENV = path.join(process.env.STACK_DIR || path.join(process.env.HOME, "vti-stack"), "stack.env");
/** One vtc-admin call, as the lab's community administrator; returns its JSON. */
function admin(...args) {
  const env = Object.fromEntries(
    readFileSync(STACK_ENV, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
  );
  // Another community than the lab's (a Farm Full Stack's) is named outright.
  const base = process.env.KEYRING_COMMUNITY_REST || `${env.VTC_URL}/v1`;
  const did = process.env.KEYRING_COMMUNITY_DID || env.VTC_DID;
  const cred = process.env.KEYRING_COMMUNITY_ADMIN_CRED || path.join(path.dirname(STACK_ENV), "vtc-admin-credential.json");
  const out = execFileSync("node", [ADMIN, base, did, cred, ...args], { encoding: "utf8" });
  const json = out.slice(out.indexOf("{"));
  return json ? JSON.parse(json) : undefined;
}
/**
 * The vetter this run's desk belongs to. VETTER_DID names it outright (the
 * suite knows its vetter phone's persona); otherwise the live grant whose
 * profile was published last — which misleads once a revocation has deleted
 * that vetter's profile, and then revokes someone else's grant.
 */
function currentVetter() {
  const { vetters = [] } = admin("vetters-list") ?? {};
  const live = vetters.filter((v) => v.live && !v.revoked);
  if (process.env.VETTER_DID) {
    const mine = live.find((v) => v.memberDid === process.env.VETTER_DID);
    if (!mine) throw new Error(`no live vetter grant for ${process.env.VETTER_DID}`);
    return mine;
  }
  live.sort((a, b) => String(b.profile?.updatedAt ?? "").localeCompare(String(a.profile?.updatedAt ?? "")));
  if (!live[0]) throw new Error("no live vetter grant to revoke");
  return live[0];
}
/** Lines the lab community logged since `since` (ISO), colour codes removed. */
const vtcLogSince = (since) =>
  readFileSync(path.join(path.dirname(STACK_ENV), "logs", "vtc.log"), "utf8")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .filter((l) => l.slice(0, 27) >= since.slice(0, 27));
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
  // This suite needs a device that has been through the journey once: a wallet
  // created, an agent linked. Pointed at a fresh one it used to wait out
  // 120s for a PIN screen that was never coming and then 300s for a Contacts
  // tab, and report "EnterPIN not found" — which says nothing about the real
  // problem. Three runs were lost to that on two platforms before it was worth
  // ten seconds to say so. Onboarding is the first screen, so it is cheap to
  // recognise.
  if (await existsTestId(d, "GetStarted", 8000)) {
    throw new Error(
      `${d.e2ePlatform}: this device has no wallet yet — it is sitting on onboarding. ` +
        `Run run-vta-link.js against it first (it onboards and links an agent); this suite starts from a linked phone.`
    );
  }
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
  await holdCriteriaLock("vetting " + (process.env.E2E_REFUSAL || "").trim());
  execFileSync("bash", [INVITE, "--vetting-only"], { stdio: "inherit" });
  execFileSync("bash", [APPROVER, "clear"], { stdio: "ignore" });
  await ensureAppium();
  // A real iPhone/iPad per role when its UDID is given; otherwise a simulator.
  const capsFor = (platform, udid, wdaLocalPort, mjpegServerPort) =>
    platform === "android"
      ? androidCaps()
      : udid
        ? iosDeviceCaps(udid, {
            wdaLocalPort,
            mjpegServerPort,
            derivedDataPath: path.join(os.homedir(), `Library/Developer/Xcode/DerivedData/WDA-e2e-${udid.slice(-8)}`),
          })
        : iosCaps();
  // Two simulators, one per role (APPLICANT_IOS_SIM / VETTER_IOS_SIM name them):
  // each needs its own device and its own WebDriverAgent port.
  const simCaps = (caps, name, wdaLocalPort, mjpegServerPort) =>
    name ? { ...caps, "appium:deviceName": name, "appium:wdaLocalPort": wdaLocalPort, "appium:mjpegServerPort": mjpegServerPort } : caps;
  applicant = await createSession(platforms[0], keep(simCaps(capsFor(platforms[0], process.env.APPLICANT_IOS_UDID, Number(process.env.APPLICANT_WDA_PORT || 8131), Number(process.env.APPLICANT_MJPEG_PORT || 9131)), process.env.APPLICANT_IOS_SIM, 8133, 9133)));
  vetter = await createSession(platforms[1], keep(simCaps(capsFor(platforms[1], process.env.VETTER_IOS_UDID, Number(process.env.VETTER_WDA_PORT || 8130), Number(process.env.VETTER_MJPEG_PORT || 9130)), process.env.VETTER_IOS_SIM, 8134, 9134)));
  console.log(`[e2e] applicant = ${platforms[0]}, vetter = ${platforms[1]}`);
  keepalive = setInterval(() => { vetter.getWindowSize().catch(() => undefined); applicant.getWindowSize().catch(() => undefined); }, 20000);
  await Promise.all([unlockToHome(applicant), unlockToHome(vetter)]);

  // — vetter: the desk, a ticket
  await openVetting(vetter);
  // A session left open by an earlier run holds the desk on its step: end it
  // the way a vetter would ("Codes differ" on the match step, "End this
  // session" on the others) — both decline it, which the applicant hears.
  for (let i = 0; i < 3; i++) {
    let ended = false;
    for (const key of ["VettingCodesDiffer", "VettingEndSession"]) {
      if (await byTestId(vetter, key).isExisting().catch(() => false)) {
        await tapTestIdByCoordinates(vetter, key);
        console.log(`[e2e] ${vetter.e2ePlatform}: ended a session left open by an earlier run (${key})`);
        await sleep(3000);
        ended = true;
        break;
      }
    }
    if (!ended) break;
  }
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
  // The desk shows one step at a time: a finished request from an earlier run
  // sits on its "statement issued" step until the vetter moves on.
  if (await byTestId(vetter, "VettingVetSomeoneElse").isExisting().catch(() => false)) {
    await tapTestIdByCoordinates(vetter, "VettingVetSomeoneElse");
    await sleep(1500);
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
  const issued = (await textOf(vetter, "VettingTicketLink")).trim();
  // E2E_REFUSAL=bad-ticket: the same ticket with its secret altered. Its id is
  // one the vetter issued, so the vetter answers `vetting/request:invalidTicket`
  // (a wrong CODE is never answered at all, by design — nothing to assert on).
  const link =
    REFUSAL === "bad-ticket"
      ? issued.replace(/([?&]secret=)([^&]+)/, (_, k, v) => `${k}${v.slice(0, -4)}${v.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`)
      : issued;
  if (REFUSAL === "bad-ticket" && link === issued) throw new Error("the ticket link carries no secret to alter");
  // The code sits above the QR and the link: scrolling down to the link puts
  // it off the top of the screen, where Android reports no such element.
  await scrollToTestId(vetter, "VettingTicketCode", 4, { direction: "up" }).catch(() => undefined);
  const code = (await textOf(vetter, "VettingTicketCode")).trim();
  if (!link.startsWith("vetting-ticket:")) throw new Error(`no ticket link on the vetter: ${link.slice(0, 60)}`);
  console.log(`[e2e] ${vetter.e2ePlatform}: ticket ${code} (${link.length} chars)`);
  await screenshot(vetter, "vetting-01-ticket");

  // E2E_REFUSAL=dead-grant: the ticket is issued while the grant is live and
  // the grant dies before the applicant redeems it — the case the desk cannot
  // reach, because the acceptance happens in the module when the ticket
  // arrives. The refusal must not spend the ticket, so the same ticket has to
  // work again once the role is restored; a version that refuses AND burns it
  // passes every check up to that point.
  if (REFUSAL === "dead-grant") {
    const live = currentVetter();
    revokedVetterDid = live.memberDid;
    const revoked = admin("revoke-endorsement", live.endorsementId);
    console.log(`[e2e] community: vetter grant revoked before the ticket is used (status-list bit ${revoked?.statusListIndex})`);
    // The vetter's own desk must say so — the seat stays, the reason appears.
    await scrollToTestId(vetter, "VettingStandingLine", 6, { direction: "up" }).catch(() => undefined);
    const said = await waitText(vetter, "VettingStandingLine", /taken away|revok/i, 120000);
    console.log(`[e2e] ${vetter.e2ePlatform}: the desk says "${said}"`);
    const ticketButton = byTestId(vetter, "VettingNewTicketButton");
    if ((await ticketButton.isEnabled().catch(() => false)) === true) {
      throw new Error("the desk still offers a new ticket with no live grant");
    }
    await screenshot(vetter, "vetting-dead-grant-01-desk");
  }

  // — applicant: start over, identity, face, application, request
  // Reset UNCONDITIONALLY — the vetting state, not membership, is what breaks
  // a ceremony: an applicant that finished a previous run holds "1 of 1
  // statements · meets the published requirements", so "Request vetting" has
  // nothing to ask for and the run reads as a delivery failure (three runs on
  // 2026-09-20). The reset is the person's own Leave community (UI/UX plan U1),
  // so the harness no longer opens the Developer screen; it costs a persona
  // re-mint, which is cheap and reliable. Determinism is worth more than the minute.
  await leaveCommunityInApp(applicant);
  if (process.env.APPLICANT_DOOR === "link") {
    // Door 2, as a person meets it: a community link → what it asks → make
    // the identity (Face ID) → straight into Get vetted for that community.
    const communityDid = process.env.KEYRING_COMMUNITY_DID;
    if (!communityDid) throw new Error("APPLICANT_DOOR=link needs KEYRING_COMMUNITY_DID");
    const name = process.env.KEYRING_COMMUNITY_NAME || "keyring-test";
    await pasteLinkFromHome(applicant, `keyring://vti/community?d=${encodeURIComponent(communityDid)}&n=${encodeURIComponent(name)}`);
    await waitForTestId(applicant, "JoinAsks", 60000);
    const asks = await textOf(applicant, "JoinAsks").catch(() => "");
    console.log(`[e2e] ${applicant.e2ePlatform}: the community asks — ${asks.replace(/\s+/g, " ").slice(0, 160)}`);
    await (await waitForTestId(applicant, "JoinStart", 30000)).click();
    await waitForTestId(applicant, "JoinMakeIdentity", 30000);
    await tapTestIdByCoordinates(applicant, "JoinAsContinue");
    await handleBiometricConfirmIfPresent(applicant);
    console.log(`[e2e] ${applicant.e2ePlatform}: joining through the link — making the identity`);
  } else {
    await openVetting(applicant);
  }
  // The reset must have taken: a fresh applicant has no persona (Create
  // identity) or at least no checklist that already meets the requirements.
  const stale = await byTestId(applicant, "VettingChecklist")
    .getAttribute(isIos(applicant) ? "label" : "text")
    .catch(() => "");
  if (/meets the published requirements/.test(stale || "")) {
    await screenshot(applicant, "vetting-applicant-not-reset");
    throw new Error(`${applicant.e2ePlatform}: the applicant was not reset — it still meets the requirements from a previous run`);
  }
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
  /**
   * Hand the vetter's ticket to the applicant and send the request.
   *
   * Extracted verbatim so `dead-grant` can do it twice — once against a dead
   * grant, once after the role is restored — and every line of it was earned
   * from a real failure, so nothing here is incidental. The second call does
   * NOT start from the same screen as the first: it runs after a refusal, so
   * it waits for the ticket field before touching anything rather than
   * assuming the screen it left.
   */
  const presentTicket = async (link) => {
    await scrollToTestId(applicant, "VettingTicketInput", 6).catch(() => undefined);
    await waitForTestId(applicant, "VettingTicketInput", 60000);
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
    //
    // But "a card exists" is only evidence on the FIRST use. This function is
    // called twice by design (dead-grant re-presents the same ticket), and the
    // second time the refused request's card and status are still on screen —
    // so the check passes BEFORE any tap, tapTestIdReliable reports "already
    // satisfied, no tap needed", and the run announces a request it never sent.
    // The stale "Refused" then fails the final assertion, which reads as the
    // product having spent the ticket. Measured 2026-09-23.
    //
    // So verify a CHANGE from what was on screen before the tap, not a state
    // that a previous attempt already satisfies.
    const statusBefore = await textOf(applicant, "VettingRequestStatus").catch(() => "");
    const cardBefore = await byTestId(applicant, "VettingRequestCard").isExisting().catch(() => false);
    await tapTestIdReliable(
      applicant,
      "VettingRequestButton",
      async () => {
        const card = await byTestId(applicant, "VettingRequestCard").isExisting().catch(() => false);
        if (!cardBefore) return card;
        const now = await textOf(applicant, "VettingRequestStatus").catch(() => "");
        return now !== statusBefore;
      },
      { attempts: 4, settleMs: 3000 }
    ).catch((err) => {
      // On a re-presentation the screen gives us nothing that changes whether
      // the answer is Accepted or Refused: the card is keyed by vetter, it
      // carries no request id or timestamp, and the only submit-time signal is
      // a transient busy indicator with no testID. So if the status never
      // moved, "the tap did not land" and "it landed and was refused again"
      // are INDISTINGUISHABLE from here — and the second of those is the very
      // bug this rung exists to catch. Say that, rather than reporting a tap
      // failure and burying a product finding as a harness one.
      if (!cardBefore) throw err;
      throw new Error(
        `[${deviceTag(applicant)}] re-presented the ticket and the status stayed "${statusBefore}". ` +
          `This run CANNOT tell whether the request was never sent or was sent and refused again — ` +
          `the screen exposes no per-request id, timestamp or pending state. Treat as INCONCLUSIVE, ` +
          `not as a refusal that spent the ticket. Needs a testID on the request card (id or timestamp) ` +
          `or on the submit's busy state. Original: ${err.message}`
      );
    });
    console.log(`[e2e] ${applicant.e2ePlatform}: request sent`);
  };

  await presentTicket(link);
  await scrollToTestId(applicant, "VettingRequestStatus", 4, LOW).catch(() => undefined);
  if (REFUSAL === "dead-grant") {
    // The applicant is told, immediately, rather than after a whole ceremony.
    const status = await waitText(applicant, "VettingRequestStatus", /Refused/i, 120000);
    console.log(`[e2e] ${applicant.e2ePlatform}: ${status} — the vetter's grant had died`);
    await screenshot(applicant, "vetting-dead-grant-02-refused");

    // Restore the role, and resend it: delivery of a re-granted vetter role is
    // a separate defect, so without this the last step could fail for a reason
    // that has nothing to do with the ticket.
    const regrantedVetterDid = revokedVetterDid;
    admin("vetter-grant", regrantedVetterDid);
    for (let attempt = 1; ; attempt++) {
      await sleep(3000);
      try { admin("vetter-resend", regrantedVetterDid); break; } catch (e) { if (attempt >= 3) throw e; }
    }
    console.log("[e2e] community: vetter granted again");

    // Three states share one symptom here, and telling them apart is the
    // difference between a rung that reports a bug and one that misnames it.
    // The community is asked FIRST: if the grant was never re-issued, the app
    // will never show it, and a wait would blame delivery for something that
    // never left the community.
    const listsLive = (who) =>
      ((admin("vetters-list") ?? {}).vetters ?? []).some((v) => v.memberDid === who && v.live && !v.revoked);
    if (!listsLive(regrantedVetterDid)) {
      throw new Error(`the community lists no live grant for ${regrantedVetterDid} — it was never re-issued, so nothing below can mean anything`);
    }
    console.log("[e2e] community: the grant is listed live");

    // Then the app's own view, which is what actually gates the ticket: it
    // cannot mean anything until the phone can act again.
    await scrollToTestId(vetter, "VettingNewTicketButton", 6, { direction: "up" }).catch(() => undefined);
    const restored = Date.now() + 180000;
    let holdsAgain = false;
    while (!holdsAgain && Date.now() < restored) {
      holdsAgain =
        (await byTestId(vetter, "VettingNewTicketButton").isEnabled().catch(() => false)) === true &&
        !(await byTestId(vetter, "VettingStandingLine").isExisting().catch(() => false));
      if (!holdsAgain) await sleep(5000);
    }
    if (!holdsAgain) {
      await screenshot(vetter, "vetting-dead-grant-03-not-restored");
      throw new Error(
        "the community lists the grant live but the vetter's app does not show it: delivery — either the community never pushed it, " +
          "or `vetter-resend` itself failed and this run retried it three times without saying so, or the app failed to collect it. " +
          "Not the ticket, and not the same bug in all three cases."
      );
    }
    // The mirror image, which after keyring-bifold#70 should be impossible:
    // the app acting on a grant the community has withdrawn. Its chooser reads
    // the status list, so a disagreement in THIS direction means that fix has
    // stopped working, and whoever meets it later will not know that unless
    // the message says so.
    if (!listsLive(regrantedVetterDid)) {
      await screenshot(vetter, "vetting-dead-grant-03-client-ahead");
      throw new Error(
        "the desk says the role is restored while the community lists no live grant — the client is trusting a grant the community has withdrawn (regression of keyring-bifold#70)"
      );
    }
    console.log(`[e2e] ${vetter.e2ePlatform}: the desk shows the role restored, and the community agrees`);
    // Re-granted here, so the run's cleanup has nothing to put back.
    revokedVetterDid = undefined;

    // The assertion that cannot be faked: the SAME ticket, used again.
    await presentTicket(link);
    const second = await waitText(applicant, "VettingRequestStatus", /Accepted/i, 180000);
    console.log(`[e2e] ${applicant.e2ePlatform}: ${second} — the refusal did not spend the ticket`);
    await screenshot(applicant, "vetting-dead-grant-04-accepted");
    printSuccess("vti-vetting (grant died before the ticket was used → refused, ticket still good)");
    process.exitCode = 0;
    throw Object.assign(new Error("done"), { done: true });
  }
  if (REFUSAL === "bad-ticket") {
    const status = await waitText(applicant, "VettingRequestStatus", /Refused/i, 120000);
    console.log(`[e2e] ${applicant.e2ePlatform}: ${status} — the vetter refused an altered ticket`);
    await screenshot(applicant, "vetting-refusal-bad-ticket");
    printSuccess("vti-vetting (altered ticket → refused by the vetter)");
    process.exitCode = 0;
    throw Object.assign(new Error("done"), { done: true });
  }
  await waitText(applicant, "VettingRequestStatus", /Accepted/i, 120000);
  console.log(`[e2e] ${applicant.e2ePlatform}: accepted`);
  await screenshot(applicant, "vetting-02-accepted");
  // E2E_REFUSAL=declined: the vetter ends the session it just accepted
  // ("End this session", vetting/decline/0.1). The applicant's request reads
  // Declined and the screen returns to the ticket step, saying so.
  if (REFUSAL === "declined") {
    const end = await scrollToTestId(vetter, "VettingEndSession", 6);
    await tapTestIdReliable(
      vetter,
      "VettingEndSession",
      async () => !(await byTestId(vetter, "VettingEndSession").isExisting().catch(() => false)),
      { attempts: 4, settleMs: 3000 }
    ).catch(async () => { await tapElement(vetter, end); });
    console.log(`[e2e] ${vetter.e2ePlatform}: ended the session`);
    await scrollToTestId(applicant, "VettingRequestStatus", 6, LOW).catch(() => undefined);
    const status = await waitText(applicant, "VettingRequestStatus", /Declined/i, 120000);
    const ended = await byTestId(applicant, "VettingSessionEnded").isExisting().catch(() => false);
    console.log(`[e2e] ${applicant.e2ePlatform}: ${status}${ended ? " — the screen says the session ended" : ""}`);
    if (!ended) throw new Error(`${applicant.e2ePlatform}: declined, but the ticket step does not say the session ended`);
    await screenshot(applicant, "vetting-refusal-declined");
    printSuccess("vti-vetting (vetter ended the session → declined)");
    process.exitCode = 0;
    throw Object.assign(new Error("done"), { done: true });
  }

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
  // Both people say the codes match before anything is signed (UI/UX plan §5.3–5.4).
  // Tap-and-verify: a coordinate tap on a control that moved or is disabled
  // reports success and does nothing, and would surface later as "card never
  // sent". Each tap must bring the next step.
  await scrollToTestId(applicant, "VettingCodesMatch", 4, LOW);
  await tapTestIdReliable(applicant, "VettingCodesMatch", async () => {
    await scrollToTestId(applicant, "VettingSendCardButton", 3, LOW).catch(() => undefined);
    return byTestId(applicant, "VettingSendCardButton").isExisting().catch(() => false);
  });
  await scrollToTestId(vetter, "VettingCodesMatch", 4);
  await tapTestIdReliable(vetter, "VettingCodesMatch", async () =>
    !(await byTestId(vetter, "VettingCodesMatch").isExisting().catch(() => true))
  );
  console.log("[e2e] codes match — confirmed on both phones");
  await scrollToTestId(applicant, "VettingSendCardButton", 4, LOW);
  await tapTestIdByCoordinates(applicant, "VettingSendCardButton");
  // Every signing act asks for the person's face or fingerprint. On a real
  // device with biometrics on, tap Confirm and hand the OS prompt to the
  // operator; elsewhere the modal never appears and this is a no-op.
  await sleep(1500);
  await handleBiometricConfirmIfPresent(applicant);
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
  await sleep(1500);
  await handleBiometricConfirmIfPresent(vetter);
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
  if (REFUSAL === "revoked-grant" || REFUSAL === "supplement") {
    const vetterGrant = currentVetter();
    revokedVetterDid = vetterGrant.memberDid;
    const deferredBefore = deferredCount();
    const revoked = admin("revoke-endorsement", vetterGrant.endorsementId);
    console.log(`[e2e] community: vetter grant revoked (status-list bit ${revoked?.statusListIndex})`);
    await scrollToTestId(applicant, "VettingApplyButton", 4, LOW);
    await tapTestIdByCoordinates(applicant, "VettingApplyButton");
    await sleep(1500);
    await handleBiometricConfirmIfPresent(applicant);
    await scrollToTestId(applicant, "VettingSubmissionState", 6, LOW).catch(() => undefined);
    const deferred = await waitText(applicant, "VettingSubmissionState", /asked for more/i, 120000);
    console.log(`[e2e] ${applicant.e2ePlatform}: ${deferred}`);
    if (!/vetting:statements/.test(deferred)) throw new Error(`${applicant.e2ePlatform}: deferred without naming the missing statement: ${deferred}`);
    await screenshot(applicant, "vetting-refusal-01-deferred");
    if (REFUSAL === "supplement") {
      // E2E_REFUSAL=supplement: the community's reason goes away — the vetter
      // is granted again, so the statement counts — and the applicant answers
      // the deferral in place ("Add what they asked for" → supplement/0.1)
      // instead of withdrawing and starting over.
      admin("vetter-grant", revokedVetterDid);
      for (let attempt = 1; ; attempt++) {
        await sleep(3000);
        try { admin("vetter-resend", revokedVetterDid); break; } catch (e) { if (attempt >= 3) throw e; }
      }
      revokedVetterDid = undefined; // re-granted here; the cleanup need not
      console.log("[e2e] community: vetter granted again — the statement counts again");
      await scrollToTestId(applicant, "VettingApplyButton", 4, LOW);
      const label = await textOf(applicant, "VettingApplyButton").catch(() => "");
      console.log(`[e2e] ${applicant.e2ePlatform}: the deferred apply button reads "${label}"`);
      if (!/asked for/i.test(label)) throw new Error(`${applicant.e2ePlatform}: a deferred application's button reads "${label}", not "Add what they asked for"`);
      const tappedAt = new Date().toISOString();
      await tapTestIdByCoordinates(applicant, "VettingApplyButton");
      await sleep(1500);
      await handleBiometricConfirmIfPresent(applicant);
      // The community must take it as a supplement to the open request — not a
      // second application (which it would refuse as requestAlreadyOpen).
      let supplemented = process.env.KEYRING_COMMUNITY_REST ? "(a remote community: its log is not ours to read)" : "";
      for (let i = 0; i < 30 && !supplemented; i++) {
        await sleep(2000);
        supplemented = vtcLogSince(tappedAt).find((l) => /join request supplemented/.test(l)) ?? "";
      }
      if (!supplemented) throw new Error("the community logged no supplement for the open request");
      console.log(`[e2e] community: ${supplemented.replace(/^\S+\s+INFO\s+/, "").slice(0, 160)}`);
      // The statement was signed under the grant that was revoked; a new grant
      // starts now and does not cover it, so the request rightly stays deferred
      // (and the screen says those statements will not count). A supplement that
      // ends in admission needs a fresh statement: a second ceremony.
      const still = await waitText(applicant, "VettingSubmissionState", /asked for more/i, 60000);
      console.log(`[e2e] ${applicant.e2ePlatform}: after the supplement — ${still.slice(0, 120)}`);
      await screenshot(applicant, "vetting-refusal-03-supplemented");
      printSuccess("vti-vetting (revoked grant → deferred → re-granted → supplemented in place → still deferred, rightly)");
      process.exitCode = 0;
      throw Object.assign(new Error("done"), { done: true });
    }
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
    await sleep(1500);
    await handleBiometricConfirmIfPresent(applicant);
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
  if (err?.done) {
    // a refusal mode that ended where it meant to
  } else {
  printFailure("vti-vetting", err);
  for (const [d, name] of [[applicant, "applicant"], [vetter, "vetter"]]) {
    if (d) { try { await screenshot(d, `vetting-failure-${name}`); await dumpSource(d, `vetting-failure-${name}`); } catch { /* ignore */ } }
  }
  process.exitCode = 1;
  }
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
