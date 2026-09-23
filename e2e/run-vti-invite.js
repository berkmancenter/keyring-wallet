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
 *   invitation shows → Join → "You're a member".
 */
import "./lib/cli-guard.js";
import { createSession, ensureAppium, stopAppium, screenshot, dumpSource, sleep, scrollToTestId, waitForTestId, byTestId, existsTestId, tapTestId } from "./lib/driver.js";
import { androidCaps, iosCaps, iosDeviceCaps } from "./lib/config.js";
import os from "node:os";
import { completeOnboarding, dismissTourIfPresent, enableDidCommV2, handleBiometricConfirmIfPresent, leaveCommunityInApp, openMyAgentPanel, pasteLinkFromHome, unlockIfLocked } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";
import { holdCriteriaLock } from "./lib/criteriaLock.js";
import { execFileSync } from "node:child_process";
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

async function openLink(url) {
  // `simctl openurl` cuts a URL at 2048 characters (measured 2026-09-22: 1930
  // arrives whole, 2063 does not), so a simulator gets a long link pasted too.
  if (platform === "ios" && (IOS_UDID || url.length > 2000)) return pasteLinkFromHome(driver, url);
  // "booted" is the first booted simulator, which is not this session's when
  // another is up (the debug suite's beside a Release build's): address ours.
  if (platform === "ios") execFileSync("xcrun", ["simctl", "openurl", driver?.capabilities?.udid || "booted", url], { stdio: "inherit" });
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
  if (await existsTestId(d, "InvitedContinue", 10000)) {
    await tapTestId(d, "InvitedContinue", 15000);
    await handleBiometricConfirmIfPresent(d);
    console.log(`[e2e] ${d.e2ePlatform}: I was invited → Continue (making the identity)`);
  }
  await waitForTestId(d, "InvitedShare", 180000);
  await screenshot(d, "vti-invite-door-share");
  await tapTestId(d, "InvitedDetailsToggle", 15000);
  const personaDid = (await textOf(d, "InvitedPersonaDid")).trim();
  if (!personaDid.startsWith("did:")) throw new Error(`no identity under Details: ${personaDid}`);
  console.log(`[e2e] ${d.e2ePlatform}: identity to send the admin ${personaDid}`);

  const out = execFileSync("bash", [INVITE, personaDid, "member"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const link = /INVITATION_LINK=(\S+)/.exec(out)?.[1];
  if (!link) throw new Error(`no invitation link:\n${out}`);
  console.log(`[e2e] invitation issued (${link.length} chars)`);
  await openLink(link);

  // The flow picks the invitation up wherever the person left it.
  let card = false;
  for (let i = 0; i < 20 && !card; i++) {
    await sleep(3000);
    if (!(await existsTestId(d, "InvitedInvitationCard", 1500))) await openInvitedFlow(d).catch(() => undefined);
    card = await existsTestId(d, "InvitedInvitationCard", 5000);
  }
  if (!card) throw new Error('"Your invitation arrived" never showed in the flow');
  await screenshot(d, "vti-invite-door-arrived");
  await tapTestId(d, "InvitedJoin", 15000);
  console.log(`[e2e] ${d.e2ePlatform}: joining from the flow`);
  if (!(await existsTestId(d, "InvitedJoined", 240000))) {
    const err = await textOf(d, "InvitedError").catch(() => "");
    throw new Error(`join did not finish${err ? `: ${err}` : ""}`);
  }
  await screenshot(d, "vti-invite-door-joined");
  console.log(`[e2e] ${d.e2ePlatform}: "You're a member" — joined through the door`);
}

let driver;
try {
  // The community's criteria are shared by every session's runs: hold the
  // lab's criteria lock for the whole run (released on exit or a signal).
  await holdCriteriaLock(`invite ${INVITE_VIA}`);
  execFileSync("bash", [INVITE, "--invitation-only"], { stdio: "inherit" });
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

  if (INVITE_VIA === "door") {
    await inviteByDoor(driver);
    printSuccess("vti-invite (door)");
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
  try { execFileSync("bash", [INVITE, "--restore-criteria"], { stdio: "inherit" }); } catch { /* best effort */ }
  if (driver) { try { await driver.deleteSession(); } catch { /* ignore */ } }
  stopAppium();
}
