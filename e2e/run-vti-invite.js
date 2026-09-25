/**
 * Single-device: "I was invited" — the wireframe's second door, as a persona
 * the phone's VTA holds (§2.4 B).
 *
 *   My Agent → "Create my identity" (the VTA mints a persona; its DID is shown
 *   to share with an admin) → this runner plays the admin: issues an
 *   InvitationCredential to that DID and opens the invitation link on the
 *   phone → the invitation appears on My Agent → "Join" → the phone presents
 *   it as the persona → `allow` → the membership card is kept and shown.
 *
 * Usage: E2E_KEEP_STATE=1 PLATFORM=android node run-vti-invite.js  (or ios)
 *
 * INVITE_VIA=door: the person's own "I was invited" flow instead, on a phone
 *   already LINKED to its agent (run run-vta-link.js first, then this with
 *   E2E_KEEP_STATE=1): the agent screen → I was invited → Continue (makes the
 *   identity) → the identity is read from Details, as an admin would receive
 *   it → the runner invites it → the link is pasted → back in the flow the
 *   invitation shows → Join → the outcome.
 *
 * INVITE_VIA=console-push | console-qr: the door, but the invitation comes the
 *   way a community's admin console hands it out (keyring-bifold#139). The
 *   runner issues it and delivers it through the community's own admin API, as
 *   the console's buttons do:
 *   - console-push: "Send" (channel message). Nothing is opened on the phone;
 *     the invitation must arrive in the flow by itself.
 *   - console-qr: "QR offer" (channel offer), an openid-credential-offer:// link
 *     with the community's DID as issuer. It is opened while an ordinary OpenID
 *     offer's full-screen error is up (the state a person was stuck in on
 *     2026-09-25), and "I was invited" must come to the top. After the join
 *     the same link is opened again: the used code must be explained in words,
 *     never a modal.
 *
 * EXPECT_JOIN=member|deferred|pending|rejected (default member): what the join
 *   must end as, on the screen AND at the community. After Join the runner reads
 *   the community's own answer through its admin API (member list, join
 *   requests) and fails when the two disagree — the screen alone passed runs
 *   that admitted no one (2026-09-24). A community that requires vetting
 *   defers an invitation join by design: keyring-test-vtc with its fixed
 *   criteria is EXPECT_JOIN=deferred.
 */
import "./lib/cli-guard.js";
import { createSession, ensureAppium, stopAppium, screenshot, dumpSource, sleep, scrollToTestId, waitForTestId, byTestId, existsTestId, tapTestId, simTarget } from "./lib/driver.js";
import { MAY_FLIP_CRITERIA, criteriaNote } from "./lib/criteria.js";
import { androidCaps, iosCaps, iosDeviceCaps } from "./lib/config.js";
import os from "node:os";
import { completeOnboarding, dismissTourIfPresent, enableDidCommV2, handleBiometricConfirmIfPresent, leaveCommunityInApp, openMyAgentPanel, pasteLinkFromHome, pasteLinkOnScanScreen, unlockIfLocked } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";
import { holdCriteriaLock } from "./lib/criteriaLock.js";
import { assertDirectoryConsentOff, assertNoDidShown } from "./lib/gateChecks.js";
import { vtaInventory } from "./lib/aclCleanup.js";
import { OUTCOME_SCREENS, communityOutcome, disagreement } from "./lib/joinOutcome.js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const platform = process.env.PLATFORM || "android";
const keepState = process.env.E2E_KEEP_STATE === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const INVITE = path.resolve(here, "../scripts/openvtc/local-vti-stack/invite-persona.sh");
const ANDROID_PKG = process.env.ANDROID_PACKAGE || "asml.bkc.harvard.wallet";
const ANDROID_SERIAL = process.env.ANDROID_SERIAL || "emulator-5554";

const textOf = async (driver, key) =>
  (await byTestId(driver, key).getAttribute(driver.e2ePlatform === "ios" ? "label" : "text")) || "";

// A real iPhone/iPad (IOS_UDID): no simctl, and a deep link truncates the
// ~6 KB invitation (VTI-32) — it is pasted into the scanner instead.
const IOS_UDID = process.env.IOS_UDID || "";
const INVITE_VIA = process.env.INVITE_VIA || "my-agent";
const EXPECT_INVITED_ERROR = process.env.EXPECT_INVITED_ERROR || "";
const EXPECT_JOIN = process.env.EXPECT_JOIN || "member";
const ADMIN = path.resolve(here, "../tsp-reference/ref-20-local-vetting/vtc-admin.mjs");

/**
 * One read of the community's admin API, as its administrator — the same
 * community and credential invite-persona.sh issues from (KEYRING_COMMUNITY_*,
 * else STACK_DIR's stack.env). Read-only calls only.
 */
function communityRead(...args) {
  const stackDir = process.env.STACK_DIR || path.join(os.homedir(), "vti-stack");
  const env = Object.fromEntries(
    readFileSync(path.join(stackDir, "stack.env"), "utf8")
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
  );
  const base = process.env.KEYRING_COMMUNITY_REST || `${env.VTC_URL}/v1`;
  const did = process.env.KEYRING_COMMUNITY_DID || env.VTC_DID;
  const cred = process.env.KEYRING_COMMUNITY_ADMIN_CRED || path.join(stackDir, "vtc-admin-credential.json");
  const out = execFileSync("node", [ADMIN, base, did, cred, ...args], { encoding: "utf8" });
  return JSON.parse(out.slice(out.indexOf("\n{") + 1));
}

/** The community's answer for this applicant: member list, then its join requests of every status. */
function readCommunityOutcome(applicantDid) {
  const members = communityRead("members").items ?? [];
  const requests = ["deferred", "pending", "approved", "rejected", "withdrawn"].flatMap(
    (status) => communityRead("join-list", status).items ?? []
  );
  return communityOutcome(applicantDid, members, requests);
}

/** A write through the community's admin API — what its console's buttons call. */
function communityWrite(...args) {
  return communityRead(...args)
}

const CONSOLE = INVITE_VIA.startsWith("console-")
// The raw keys of the OpenID flow's full-screen error, as a build without its
// words shows them — and the words, as one with them does (keyring-bifold#138).
const OPENID_ERROR = /Error\.GenericError|FullScreenErrorModal\.PrimaryCTA|Something went wrong/

/** Issue an invitation to `personaDid` and deliver it on `channel`, as the console does; returns the offer link for `offer`. */
function consoleInvite(personaDid, channel) {
  const issued = communityWrite("invite", personaDid, "member")
  const listed = communityRead("invitations-list").invitations ?? []
  const id =
    issued?.id ??
    listed
      .filter((i) => i.subjectDid === personaDid)
      .sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)))[0]?.id
  if (!id) throw new Error(`the community lists no invitation for ${personaDid}`)
  const delivered = communityWrite("invitation-deliver", id, channel)
  console.log(`[e2e] console: invitation ${id} issued and delivered (${channel})`)
  if (channel !== "offer") return undefined
  if (!delivered?.offer?.credential_issuer?.startsWith("did:")) throw new Error(`the offer names no DID issuer: ${JSON.stringify(delivered)}`)
  // admin-ui/src/lib/invitation-offer.ts, offerDeepLink
  return `openid-credential-offer://?credential_offer=${encodeURIComponent(JSON.stringify(delivered.offer))}`
}

async function pageHas(d, pattern) {
  return pattern.test(await d.getPageSource())
}

async function openLink(url) {
  // `simctl openurl` cuts a URL at 2048 characters (measured 2026-09-22: 1930
  // arrives whole, 2063 does not), so a simulator gets a long link pasted too.
  if (platform === "ios" && (IOS_UDID || url.length > 2000)) return pasteLinkFromHome(driver, url);
  // "booted" is the first booted simulator, which is not this session's when
  // another is up (the debug suite's beside a Release build's): address ours.
  if (platform === "ios") execFileSync("xcrun", ["simctl", "openurl", simTarget(driver), url], { stdio: "inherit" });
  else execFileSync("adb", ["-s", ANDROID_SERIAL, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `'${url}'`, ANDROID_PKG], { stdio: "inherit" });
}


/**
 * My Agent gates everything behind the VTA session now: the not-connected
 * screen offers only "Connect my agent". Tap it if it is there, then wait for
 * the connected screen (the identity card or, if a persona already exists,
 * the agent card).
 */
async function openMyAgentConnected(d, timeout = 180000) {
  // The cards below live on the operator panel, which a linked phone no longer
  // lands on (keyring-bifold#11) — walk there before waiting for them.
  await openMyAgentPanel(d);
  await sleep(1500);
  const connect = await byTestId(d, "ConnectMyAgentButton");
  if (await connect.isExisting().catch(() => false)) {
    await connect.click();
    console.log(`[e2e] ${d.e2ePlatform}: connecting my agent`);
  }
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    for (const key of ["MyAgentIdentityCard", "MyAgentCard"]) {
      if (await byTestId(d, key).isExisting().catch(() => false)) return;
    }
    await sleep(3000);
  }
  throw new Error(`${d.e2ePlatform}: My Agent never reached its connected state`);
}

/** My Agent → the agent screen → I was invited. */
async function openInvitedFlow(d) {
  await dismissTourIfPresent(d);
  await (await waitForTestId(d, "MyAgent", 30000)).click();
  await sleep(1500);
  if (!(await existsTestId(d, "AgentHome", 2000))) {
    const open = await scrollToTestId(d, "OpenYourAgentButton", 4).catch(() => undefined);
    if (!open) throw new Error('My Agent offers no way to "Open your agent" — is the phone linked?');
    await open.click();
    await waitForTestId(d, "AgentHome", 30000);
  }
  const door = await scrollToTestId(d, "AgentInvited", 4).catch(() => undefined);
  if (!door) throw new Error('the agent screen has no "I was invited"');
  await door.click();
}

/** The person's own door (INVITE_VIA=door): send the identity, be invited, join. */
async function inviteByDoor(d) {
  await openInvitedFlow(d);
  // A build that names no community (the store build: testers bring their
  // own) first asks which community invited them. Bring it the way a person
  // does — its code through the scanner's paste — as the community's bare DID.
  if (await existsTestId(d, "InvitedWhichCommunity", 8000)) {
    const bare = process.env.KEYRING_COMMUNITY_DID;
    if (!bare) throw new Error("this build names no community: set KEYRING_COMMUNITY_DID to the one that invites");
    await tapTestId(d, "InvitedScanCommunity", 15000);
    for (let i = 0; i < 3 && !(await existsTestId(d, "PasteUrlButton", 5000)); i++) {
      if (await existsTestId(d, "Continue", 3000)) await tapTestId(d, "Continue");
    }
    await pasteLinkOnScanScreen(d, bare);
    console.log(`[e2e] ${d.e2ePlatform}: I was invited → which community: brought its code by paste`);
    if (!(await existsTestId(d, "InvitedContinue", 30000)) && !(await existsTestId(d, "InvitedShare", 3000))) {
      await openInvitedFlow(d).catch(() => undefined);
    }
  }
  // What the agent holds before it is asked for an identity, when the run
  // expects it to refuse: afterwards it must hold exactly the same.
  const runner = { slug: process.env.RUNNER_VTA, pnmHome: process.env.PNM_HOME };
  if (EXPECT_INVITED_ERROR && (!runner.slug || !runner.pnmHome)) {
    throw new Error("EXPECT_INVITED_ERROR needs RUNNER_VTA and PNM_HOME, to check the agent minted nothing");
  }
  const heldBefore = EXPECT_INVITED_ERROR ? vtaInventory(runner) : undefined;
  if (await existsTestId(d, "InvitedContinue", 10000)) {
    await tapTestId(d, "InvitedContinue", 15000);
    await handleBiometricConfirmIfPresent(d);
    console.log(`[e2e] ${d.e2ePlatform}: I was invited → Continue (making the identity)`);
  }
  // EXPECT_INVITED_ERROR=NoDidHost: an agent with nowhere to publish an
  // identity (farm-runner-nohost). The flow must say so in a plain line, keep
  // the raw text under Details, and make no identity (keyring-bifold#97).
  if (EXPECT_INVITED_ERROR) {
    const expected = { NoDidHost: /nowhere to publish a new identity/ }[EXPECT_INVITED_ERROR];
    if (!expected) throw new Error(`unknown EXPECT_INVITED_ERROR=${EXPECT_INVITED_ERROR}`);
    const until = Date.now() + 180000;
    // The error card ends the scroll view, below the profile choice: on Android
    // UiAutomator does not see it until it is scrolled into view (220 RC gate).
    // Say whether the person had to scroll to see it.
    let scrolled = false;
    const seen = async () => {
      if (await existsTestId(d, "InvitedError", 2000)) return true;
      if (d.e2ePlatform !== "android") return false;
      const el = await scrollToTestId(d, "InvitedError", 2, { both: false }).catch(() => undefined);
      if (el) scrolled = true;
      return Boolean(el);
    };
    while (Date.now() < until && !(await seen())) {
      if (await existsTestId(d, "InvitedShare", 500)) throw new Error("an identity was made on an agent with nowhere to publish it");
    }
    if (!(await existsTestId(d, "InvitedError", 1000))) throw new Error('"I was invited" never said why it could not make the identity');
    if (scrolled) console.log(`[e2e] ${d.e2ePlatform}: the refusal is below the fold — seen only after scrolling`);
    const said = (await textOf(d, "InvitedError")).trim();
    if (!expected.test(said) || /\[TrustTasks|VtaClient/.test(said)) throw new Error(`"I was invited" says "${said}"`);
    if (!(await existsTestId(d, "InvitedErrorDetailsToggle", 3000))) throw new Error("the raw error is not kept under Details");
    await assertNoDidShown(d, "the no-host refusal");
    await screenshot(d, "vti-invite-door-nohost");
    const heldAfter = vtaInventory(runner);
    const newKeys = [...heldAfter.keyIds].filter((id) => !heldBefore.keyIds.has(id));
    if (newKeys.length || heldAfter.keyTotal > heldBefore.keyTotal || heldAfter.didCount > heldBefore.didCount) {
      throw new Error(
        `the agent minted something it could not publish: keys ${heldBefore.keyTotal} → ${heldAfter.keyTotal}, DIDs ${heldBefore.didCount} → ${heldAfter.didCount}`
      );
    }
    console.log(`[e2e] ${runner.slug}: nothing minted — keys ${heldAfter.keyTotal}, DIDs ${heldAfter.didCount}, as before`);
    console.log(`[e2e] ${d.e2ePlatform}: no DID host — said plainly: "${said}"`);
    return "refused";
  }
  await waitForTestId(d, "InvitedShare", 180000);
  await screenshot(d, "vti-invite-door-share");
  await tapTestId(d, "InvitedDetailsToggle", 15000);
  const personaDid = (await textOf(d, "InvitedPersonaDid")).trim();
  if (!personaDid.startsWith("did:")) throw new Error(`no identity under Details: ${personaDid}`);
  console.log(`[e2e] ${d.e2ePlatform}: identity to send the admin ${personaDid}`);

  let offerLink;
  if (INVITE_VIA === "console-push") {
    // The person stays on "Waiting for your invitation"; nothing is opened.
    await tapTestId(d, "InvitedSent", 15000).catch(() => undefined);
    consoleInvite(personaDid, "message");
  } else if (INVITE_VIA === "console-qr") {
    offerLink = consoleInvite(personaDid, "offer");
    // First the state a person was stuck in: an ordinary OpenID offer whose
    // issuer cannot be reached ends on the OpenID flow's full-screen error.
    const decoy = `openid-credential-offer://?credential_offer=${encodeURIComponent(
      JSON.stringify({
        credential_issuer: "https://issuer.invalid",
        credential_configuration_ids: ["x"],
        grants: { "urn:ietf:params:oauth:grant-type:pre-authorized_code": { "pre-authorized_code": "decoy" } },
      })
    )}`
    await openLink(decoy);
    let stuck = false;
    for (let i = 0; i < 20 && !stuck; i++) {
      await sleep(3000);
      stuck = await pageHas(d, OPENID_ERROR);
    }
    await screenshot(d, "vti-invite-console-qr-modal");
    if (!stuck) throw new Error("the OpenID offer's error never came up; nothing to prove the pop against");
    console.log(`[e2e] ${d.e2ePlatform}: the OpenID flow's full-screen error is up`);
    console.log(`[e2e] console QR offer link: ${offerLink.length} chars`);
    await openLink(offerLink);
  } else {
    const out = execFileSync("bash", [INVITE, personaDid, "member"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    const link = /INVITATION_LINK=(\S+)/.exec(out)?.[1];
    if (!link) throw new Error(`no invitation link:\n${out}`);
    console.log(`[e2e] invitation issued (${link.length} chars)`);
    await openLink(link);
  }

  if (INVITE_VIA === "console-qr") {
    // The link must bring its screen to the top, over the modal: the card is
    // there without anyone touching the phone, and the error is gone.
    const until = Date.now() + 60000;
    let top = false;
    while (Date.now() < until && !top) {
      top = (await existsTestId(d, "InvitedInvitationCard", 3000)) && !(await pageHas(d, OPENID_ERROR));
    }
    await screenshot(d, "vti-invite-console-qr-top");
    if (!top) throw new Error('"Your invitation arrived" did not come to the top over the OpenID error');
    console.log(`[e2e] ${d.e2ePlatform}: the console QR opened "Your invitation arrived" on top; the error is gone`);
  }

  // The flow picks the invitation up wherever the person left it.
  let card = false;
  for (let i = 0; i < 20 && !card; i++) {
    await sleep(3000);
    if (!(await existsTestId(d, "InvitedInvitationCard", 1500))) await openInvitedFlow(d).catch(() => undefined);
    card = await existsTestId(d, "InvitedInvitationCard", 5000);
  }
  if (!card) throw new Error('"Your invitation arrived" never showed in the flow');
  await screenshot(d, "vti-invite-door-arrived");
  // 217's gate: the invitation names its community in words, and asks about
  // the public directory with the switch off (keyring-bifold#87, #89). Left
  // off: the join then sends registryConsent false.
  await assertNoDidShown(d, "the arrived invitation");
  await assertDirectoryConsentOff(d, "the arrived invitation");
  await tapTestId(d, "InvitedJoin", 15000);
  console.log(`[e2e] ${d.e2ePlatform}: joining from the flow`);
  // Whichever outcome the flow shows — then what the community says.
  let screen;
  for (const until = Date.now() + 240000; Date.now() < until && !screen; ) {
    for (const [id, outcome] of Object.entries(OUTCOME_SCREENS)) {
      if (await existsTestId(d, id, 1500)) {
        screen = outcome;
        break;
      }
    }
  }
  if (!screen) throw new Error("the join showed no outcome within 240 s");
  await screenshot(d, `vti-invite-door-${screen}`);
  // The community may take a moment to list a member after `allow`.
  let community = readCommunityOutcome(personaDid);
  for (let i = 0; i < 10 && community.outcome !== screen && ["approved", "none"].includes(community.outcome); i++) {
    await sleep(3000);
    community = readCommunityOutcome(personaDid);
  }
  const said = screen === "error" ? await textOf(d, "InvitedError").catch(() => "") : "";
  console.log(
    `[e2e] ${d.e2ePlatform}: after Join the screen says ${screen}${said ? ` ("${said}")` : ""}; the community says ${community.outcome}${
      community.needs?.length ? ` (needs ${community.needs.join(", ")})` : ""
    }`
  );
  const wrong = disagreement({ expected: EXPECT_JOIN, screen, community });
  if (wrong) throw new Error(`join outcome: ${wrong}`);
  if (screen === "deferred") {
    // A deferral says what is missing, and offers the way into vetting.
    if (!(await existsTestId(d, "InvitedDeferredNeed", 3000))) throw new Error("the deferral does not say what the community needs");
    if (!(await existsTestId(d, "InvitedContinueVetting", 3000))) throw new Error("the deferral offers no way into vetting");
    await assertNoDidShown(d, "the deferred join");
  }
  console.log(`[e2e] ${d.e2ePlatform}: joined through the door — ${screen}, as the community says`);
  if (offerLink) {
    // The same QR again: its code is spent. Said in words, never a modal.
    await openLink(offerLink);
    let said = false;
    for (let i = 0; i < 30 && !said; i++) {
      await sleep(1000);
      said = await pageHas(d, /already been used/);
    }
    await screenshot(d, "vti-invite-console-qr-used");
    if (!said) throw new Error("opening the used QR again did not say it was used");
    if (await pageHas(d, OPENID_ERROR)) throw new Error("opening the used QR again brought up the OpenID error");
    console.log(`[e2e] ${d.e2ePlatform}: the used QR is explained in words ("already been used"), no modal`);
  }
  return screen;
}

let driver;
try {
  // The community's criteria are shared by every session's runs: hold the
  // lab's criteria lock for the whole run (released on exit or a signal).
  await holdCriteriaLock(`invite ${INVITE_VIA}`);
  if (MAY_FLIP_CRITERIA) execFileSync("bash", [INVITE, "--invitation-only"], { stdio: "inherit" });
  else criteriaNote("making it invitation-only");
  await ensureAppium();
  const caps =
    platform === "android"
      ? androidCaps()
      : IOS_UDID
        ? iosDeviceCaps(IOS_UDID, {
            wdaLocalPort: Number(process.env.WDA_LOCAL_PORT || 8130),
            mjpegServerPort: Number(process.env.MJPEG_PORT || 9130),
            derivedDataPath: path.join(os.homedir(), `Library/Developer/Xcode/DerivedData/WDA-e2e-${IOS_UDID.slice(-8)}`),
          })
        : iosCaps();
  driver = await createSession(
    platform,
    keepState ? { ...caps, "appium:fullReset": false, "appium:noReset": true, "appium:enforceAppInstall": false } : caps
  );
  if (keepState) {
    await waitForTestId(driver, "EnterPIN", 120000).catch(() => undefined);
    // A kept app that sat idle opens on its lock screen, and on a slow phone
    // that screen can appear late or swallow the first PIN: keep unlocking
    // until the home screen shows, for the whole wait.
    const until = Date.now() + 300000;
    while (Date.now() < until && !(await existsTestId(driver, "Contacts", 3000))) {
      await unlockIfLocked(driver);
      await sleep(2000);
    }
    await waitForTestId(driver, "Contacts", 10000);
    await sleep(5000);
  } else {
    await completeOnboarding(driver, { firstName: "Invited", lastName: "Persona" });
  }
  if (process.env.E2E_ENABLE_V2 === "1") await enableDidCommV2(driver);

  // 0 — a person starting over: a community refuses to invite a current member
  // (VTI-6), so if this phone already holds a membership, forget it first.
  if (process.env.E2E_FRESH_COMMUNITY === "1" || keepState) {
    // The person's own Leave community (UI/UX plan U1), not the Developer screen.
    await leaveCommunityInApp(driver);
  }

  if (INVITE_VIA === "door" || CONSOLE) {
    const outcome = await inviteByDoor(driver);
    printSuccess(outcome === "refused" ? `vti-invite (${INVITE_VIA}) — refused as expected: ${EXPECT_INVITED_ERROR}` : `vti-invite (${INVITE_VIA}) — ${outcome}, confirmed by the community`);
    process.exitCode = 0;
  } else {
  // 1 — the identity to be invited.
  await openMyAgentConnected(driver);
  // The identity card sits below the agent card on the reworked screen.
  await scrollToTestId(driver, "MyAgentIdentityCard", 6).catch(() => undefined);
  const create = await scrollToTestId(driver, "CreateIdentityButton", 4).catch(() => undefined);
  if (create) {
    await create.click();
    console.log(`[e2e] ${driver.e2ePlatform}: creating an identity on the VTA`);
  }
  await waitForTestId(driver, "MyAgentPersonaDid", 180000);
  const personaDid = (await textOf(driver, "MyAgentPersonaDid")).trim();
  if (!personaDid.startsWith("did:")) throw new Error(`no persona on screen: ${personaDid}`);
  console.log(`[e2e] ${driver.e2ePlatform}: persona ${personaDid}`);
  await screenshot(driver, "vti-invite-identity");

  // 2 — the admin invites it and the link reaches the phone.
  const out = execFileSync("bash", [INVITE, personaDid, "member"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const link = /INVITATION_LINK=(\S+)/.exec(out)?.[1];
  if (!link) throw new Error(`no invitation link:\n${out}`);
  console.log(`[e2e] invitation issued (${link.length} chars)`);
  await openLink(link);
  // The card sits below Approvals and the Vetting row; UiAutomator only
  // reports what is on screen, so poll with a scroll rather than a wait.
  let invitationCard;
  for (let i = 0; i < 20 && !invitationCard; i++) {
    await sleep(3000);
    invitationCard = await scrollToTestId(driver, "MyAgentInvitationCard", 4).catch(() => undefined);
  }
  if (!invitationCard) throw new Error("the invitation never appeared on My Agent");
  await screenshot(driver, "vti-invite-received");

  // 3 — join as the persona.
  await (await scrollToTestId(driver, "JoinCommunityButton", 4)).click();
  console.log(`[e2e] ${driver.e2ePlatform}: joining`);
  // The Communities card sits below Approvals and Invitations; UiAutomator
  // only sees what is rendered, so scroll to it rather than ask if it exists.
  let activity = "";
  let card;
  for (let i = 0; i < 40 && !card; i++) {
    await sleep(3000);
    const err = await byTestId(driver, "MyAgentHoldingError").isExisting();
    if (err) break;
    card = await scrollToTestId(driver, "MyAgentMembershipCard", 4).catch(() => undefined);
  }
  await screenshot(driver, "vti-invite-result");
  const errText = await textOf(driver, "MyAgentHoldingError").catch(() => "");
  if (errText) throw new Error(`join failed: ${errText}\n${activity}`);
  if (!card) throw new Error("no membership card appeared");
  // The card can re-render between finding it and reading it (the membership
  // list refreshes on a timer), which makes an already-found element stale.
  let role = "";
  for (let i = 0; i < 10 && !role; i++) {
    await scrollToTestId(driver, "MyAgentMembershipRole", 4).catch(() => undefined);
    role = await textOf(driver, "MyAgentMembershipRole").catch(() => "");
    if (!role) await sleep(2000);
  }
  console.log(`[e2e] ${driver.e2ePlatform}: membership card on screen — ${role}`);
  if (!/member/i.test(role)) throw new Error(`unexpected role text: ${role}`);
  printSuccess("vti-invite");
  process.exitCode = 0;
  }
} catch (err) {
  printFailure("vti-invite", err);
  if (driver) {
    try { await screenshot(driver, "vti-invite-failure"); await dumpSource(driver, "vti-invite-failure"); } catch { /* ignore */ }
  }
  process.exitCode = 1;
} finally {
  if (MAY_FLIP_CRITERIA) try { execFileSync("bash", [INVITE, "--restore-criteria"], { stdio: "inherit" }); } catch { /* best effort */ }
  if (driver) { try { await driver.deleteSession(); } catch { /* ignore */ } }
  stopAppium();
}
