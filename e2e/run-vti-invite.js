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
 */
import { createSession, ensureAppium, stopAppium, screenshot, dumpSource, sleep, scrollToTestId, waitForTestId, byTestId } from "./lib/driver.js";
import { androidCaps, iosCaps, iosDeviceCaps } from "./lib/config.js";
import os from "node:os";
import { completeOnboarding, enableDidCommV2, leaveCommunityInApp, pasteLinkFromHome, unlockIfLocked } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";
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

async function openLink(url) {
  if (platform === "ios" && IOS_UDID) return pasteLinkFromHome(driver, url);
  if (platform === "ios") execFileSync("xcrun", ["simctl", "openurl", "booted", url], { stdio: "inherit" });
  else execFileSync("adb", ["-s", ANDROID_SERIAL, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `'${url}'`, ANDROID_PKG], { stdio: "inherit" });
}


/**
 * My Agent gates everything behind the VTA session now: the not-connected
 * screen offers only "Connect my agent". Tap it if it is there, then wait for
 * the connected screen (the identity card or, if a persona already exists,
 * the agent card).
 */
async function openMyAgentConnected(d, timeout = 180000) {
  await (await waitForTestId(d, "MyAgent", 30000)).click();
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

let driver;
try {
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
    await unlockIfLocked(driver);
    await waitForTestId(driver, "Contacts", 300000);
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
  const out = execFileSync("bash", [INVITE, personaDid, "member"], { encoding: "utf8" });
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
