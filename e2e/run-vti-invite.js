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
import { androidCaps, iosCaps } from "./lib/config.js";
import { completeOnboarding, enableDidCommV2, openDeveloperScreen, unlockIfLocked } from "./lib/flows.js";
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

function openLink(url) {
  if (platform === "ios") execFileSync("xcrun", ["simctl", "openurl", "booted", url], { stdio: "inherit" });
  else execFileSync("adb", ["-s", ANDROID_SERIAL, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `'${url}'`, ANDROID_PKG], { stdio: "inherit" });
}

let driver;
try {
  execFileSync("bash", [INVITE, "--invitation-only"], { stdio: "inherit" });
  await ensureAppium();
  const caps = platform === "android" ? androidCaps() : iosCaps();
  driver = await createSession(
    platform,
    keepState ? { ...caps, "appium:fullReset": false, "appium:noReset": true, "appium:enforceAppInstall": false } : undefined
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
    await openDeveloperScreen(driver);
    for (let i = 0; i < 45; i++) {
      const community = await textOf(driver, "VtaProbeLog").catch(() => "");
      if (/verdict|no verdict|\[VTI-PROBE\] failed|no manifest/.test(community)) break;
      await sleep(2000);
    }
    for (let i = 0; i < 3; i++) if (!(await driver.acceptAlert().then(() => true, () => false))) break;
    const forget = await scrollToTestId(driver, "ForgetCommunityButton", 8).catch(() => undefined);
    if (forget) {
      await forget.click();
      await sleep(1500);
      await driver.acceptAlert().catch(() => undefined);
      console.log(`[e2e] ${driver.e2ePlatform}: forgot the community (persona, membership, invitations)`);
    }
    await driver.back().catch(() => undefined);
    await sleep(800);
    await driver.back().catch(() => undefined);
  }

  // 1 — the identity to be invited.
  await (await waitForTestId(driver, "MyAgent", 30000)).click();
  await waitForTestId(driver, "MyAgentIdentityCard", 30000);
  const create = await byTestId(driver, "CreateIdentityButton").isExisting();
  if (create) {
    await byTestId(driver, "CreateIdentityButton").click();
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
  openLink(link);
  await waitForTestId(driver, "MyAgentInvitationCard", 60000);
  await screenshot(driver, "vti-invite-received");

  // 3 — join as the persona.
  await (await waitForTestId(driver, "JoinCommunityButton", 10000)).click();
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
  const role = await textOf(driver, "MyAgentMembershipRole");
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
