/**
 * Single-device: link the phone to its agent by QR, through the lab
 * enrolment page — the flow a person sees (UI/UX plan §5.1, U6/U8).
 *
 *   page: Add a phone → offer link (the QR's text twin)
 *   phone: My Agent → Link your agent → Scan → paste link → "Link this phone?"
 *          → Link → the enrolment code
 *   page: the same code → first time "Codes differ" (refused, phone says so),
 *         second time "Codes match — grant access"
 *   phone: signs in as the temporary key, rotates onto a long-lived one → Linked
 *   VTA: the temporary key is gone from the ACL; the long-lived one holds its grant
 *
 * The page runs beside the lab stack (scripts/openvtc/local-vti-stack/enrol-page);
 * this runner starts one unless ENROL_URL points at one already running.
 * Nothing is restarted: the grant is `pnm acl create` on the running VTA.
 *
 * Usage: PLATFORM=android node run-vta-link.js   (or PLATFORM=ios)
 *   ENROL_PORT=8190  ENROL_URL=http://localhost:8190  METRO_PORT=8082
 * LINK_MODE=manual: the no-QR fallback instead — the phone shows its key, the
 *   runner grants it with enrol-manager.sh (the online grant), then
 *   "I've been added"; the first check before the grant must say "not yet".
 * Both modes end on the agent screen: introduction, then status Online.
 * JOURNEY=1: after linking, walk what a tester does next with the LINKED agent
 *   (run it on a store-config build — Release, no VTI_VTA_DID, no probe): back
 *   from the agent screen, a tab switch and a relaunch must never bring the
 *   "Linked" screen back; Get vetted must reach its first step, not "No agent
 *   is configured"; I want to join goes community → what it asks → identity
 *   → vetting (not "No agent is configured"), and "a different community"
 *   opens the scanner; nothing offers a locked "Vet someone"; I was invited
 *   opens its flow; a pasted community link opens Join on that community.
 * Real iPhone/iPad: PLATFORM=ios IOS_UDID=<hardware udid> with IOS_DEVICE_APP
 *   pointing at a FORCE_BUNDLING device build, and ENROL_PUBLIC_URL an https
 *   URL the device can reach (ATS allows plain http to localhost only).
 */
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

import { createSession, ensureAppium, stopAppium, screenshot, dumpSource, sleep, waitForTestId, byTestId, tapTestId, existsTestId, scrollToTestId } from "./lib/driver.js";
import { androidCaps, iosCaps, iosDeviceCaps } from "./lib/config.js";
import { completeOnboarding, dismissTourIfPresent, handleBiometricConfirmIfPresent, pasteLinkFromHome, pasteLinkOnScanScreen, restartApp, unlockIfLocked } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";

const platform = process.env.PLATFORM || "android";
const keepState = process.env.E2E_KEEP_STATE === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE_DIR = path.resolve(here, "../scripts/openvtc/local-vti-stack/enrol-page");
// 8191: the runners' page (bob). 8190 is the page for a person's own agent.
const ENROL_PORT = process.env.ENROL_PORT || "8191";
const ENROL_URL = process.env.ENROL_URL || `http://localhost:${ENROL_PORT}`;
const PNM = process.env.PNM_BIN || path.join(os.homedir(), "Documents/vti-main/target/debug/pnm");
// The runners' own lab agent. Never "alice": that is the agent a person's
// TestFlight install is linked to, and runs against it show up on their phone.
const VTA_SLUG = process.env.RUNNER_VTA || process.env.VTA_SLUG || "bob";
if (VTA_SLUG === "alice" && process.env.ALLOW_ALICE !== "1") {
  throw new Error('refusing to run against "alice" (a person\'s TestFlight agent); use the runner VTA, bob');
}
const PNM_HOME = process.env.PNM_HOME || path.join(os.homedir(), `vti-stack/pnm-${VTA_SLUG}`);
// What the offer tells the phone to call: localhost for a simulator (or an
// emulator behind adb reverse); an https tunnel for a real device.
const ENROL_PUBLIC_URL = process.env.ENROL_PUBLIC_URL || ENROL_URL;
const IOS_UDID = process.env.IOS_UDID || "";
const LINK_MODE = process.env.LINK_MODE || "qr";
const JOURNEY = process.env.JOURNEY === "1";
const ENROL_MANAGER = path.resolve(here, "../scripts/openvtc/local-vti-stack/enrol-manager.sh");

function runnerVtaDid() {
  // A VTA outside the lab (the Farm's) is named outright: its slug need not be
  // a shell variable name, and it is not in stack.env.
  if (process.env.RUNNER_VTA_DID) return process.env.RUNNER_VTA_DID;
  const key = `${VTA_SLUG.toUpperCase()}_VTA_DID`;
  const env = execFileSync("bash", ["-c", `. "${os.homedir()}/vti-stack/stack.env"; printf %s "$${key}"`], {
    encoding: "utf8",
  });
  if (!env.startsWith("did:")) throw new Error(`${key} not found in ~/vti-stack/stack.env`);
  return env;
}

/** The agent screen after linking: the introduction once, then the status. */
async function checkAgentScreen(driver) {
  await waitForTestId(driver, "AgentIntro", 30000);
  await screenshot(driver, "link-06-intro");
  for (let i = 0; i < 3; i++) await tapTestId(driver, "AgentIntroNext", 15000);
  await waitForTestId(driver, "AgentHome", 30000);
  const status = (await textOf(driver, "VtaStatusText")).trim();
  console.log(`[e2e] agent screen status: ${status}`);
  if (!/online/i.test(status)) throw new Error(`agent screen status is "${status}", not Online`);
  await screenshot(driver, "link-07-agent-home");
}

const textOf = async (driver, key) =>
  (await byTestId(driver, key).getAttribute(driver.e2ePlatform === "ios" ? "label" : "text")) || "";

/** The dead end TestFlight 206 hit: a screen that found no agent to work with. */
async function notConfiguredShown(driver) {
  const sel =
    driver.e2ePlatform === "ios"
      ? '-ios predicate string:label CONTAINS "No agent is configured"'
      : 'android=new UiSelector().textContains("No agent is configured")';
  return driver.$(sel).isExisting().catch(() => false);
}

/** Leave a screen the way a person does: its header's Back, else the platform back. */
async function goBack(driver) {
  if (await existsTestId(driver, "Back", 2000)) await tapTestId(driver, "Back", 5000);
  else await driver.back();
}

/** "Linked ✓" is shown once, right after linking — never again. */
async function assertNoLinkedScreen(driver, when) {
  if (await existsTestId(driver, "VtaLinkDone", 3000)) {
    await screenshot(driver, `journey-linked-again-${when.replace(/\W+/g, "-")}`);
    throw new Error(`the "Linked" screen came back ${when}`);
  }
  console.log(`[e2e] journey: no "Linked" screen ${when}`);
}

/** From wherever My Agent is, to the agent screen. */
async function openAgentHome(driver) {
  await (await waitForTestId(driver, "MyAgent", 30000)).click();
  await sleep(1500);
  if (await existsTestId(driver, "AgentHome", 2000)) return;
  const open = await scrollToTestId(driver, "OpenYourAgentButton", 4).catch(() => undefined);
  if (!open) throw new Error('My Agent offers no way to "Open your agent"');
  await open.click();
  await waitForTestId(driver, "AgentHome", 30000);
}

/**
 * What a tester does after linking, as the linked agent (JOURNEY=1). Each
 * entry on the agent screen is opened and left the way a person leaves it.
 */
async function testerJourney(driver) {
  // Leaving the agent screen the way it was reached.
  await goBack(driver);
  await sleep(2000);
  await assertNoLinkedScreen(driver, "after going back from the agent screen");

  // Another tab and back.
  await tapTestId(driver, "Contacts", 30000);
  await sleep(1500);
  await (await waitForTestId(driver, "MyAgent", 30000)).click();
  await sleep(2000);
  await assertNoLinkedScreen(driver, "after a tab switch");

  // I want to join a community (Door 2): the suggested community, what it
  // asks, the identity for it, then vetting — as the linked agent.
  await openAgentHome(driver);
  await tapTestId(driver, "AgentJoinCommunity", 15000);
  // What the build's suggestion is called. A community that has published no
  // name must not be offered by its hostname dressed up as one — the default
  // a maintainer meets on day one, since a fresh community publishes none.
  if (await existsTestId(driver, "JoinSuggestedName", 10000)) {
    await screenshot(driver, "journey-join-which");
    const offered = (await textOf(driver, "JoinSuggestedName")).trim();
    if (/\.(app|com|net|org|io|dev|local)\b/i.test(offered) || offered.startsWith("did:")) {
      throw new Error(`the suggested community is offered as "${offered}" — a hostname or DID, not a name`);
    }
    console.log(`[e2e] journey: the suggested community is called "${offered}"`);
  }
  if (await existsTestId(driver, "JoinThisCommunity", 10000)) await tapTestId(driver, "JoinThisCommunity", 5000);
  await waitForTestId(driver, "JoinAsks", 15000);
  console.log("[e2e] journey: Join a community shows what it asks for");
  await tapTestId(driver, "JoinStart", 15000);
  await waitForTestId(driver, "JoinMakeIdentity", 15000);
  // Join as: create a profile right there in the real profile editor, come
  // back to Join as with it chosen, and see its name carried into vetting.
  const PROFILE = { first: "Runner", last: "Community" };
  if (await existsTestId(driver, "JoinAsCreateProfile", 5000)) {
    await tapTestId(driver, "JoinAsCreateProfile", 15000);
    const first = await waitForTestId(driver, "RCardFirstNameInput", 30000);
    await first.setValue(PROFILE.first);
    await byTestId(driver, "RCardLastNameInput").setValue(PROFILE.last);
    const submit = await scrollToTestId(driver, "RCardSubmit", 4).catch(() => undefined);
    if (!submit) throw new Error("the profile editor has no Save");
    await submit.click();
    await waitForTestId(driver, "JoinMakeIdentity", 30000);
    const fullName = `${PROFILE.first} ${PROFILE.last}`;
    const option = await driver.$(
      driver.e2ePlatform === "ios"
        ? `-ios predicate string:label CONTAINS "${fullName}"`
        : `android=new UiSelector().textContains("${fullName}")`
    );
    if (!(await option.isExisting())) throw new Error("the new profile is not offered back on Join as");
    console.log("[e2e] journey: Join as created a profile in the editor and came back with it");
  }
  await screenshot(driver, "journey-join-identity");
  await tapTestId(driver, "JoinAsContinue", 15000);
  await handleBiometricConfirmIfPresent(driver);
  if (await existsTestId(driver, "JoinError", 3000)) throw new Error(`making the identity failed: ${await textOf(driver, "JoinError")}`);
  const firstStep = ["VettingLegalNameInput", "VettingStartButton", "VettingStepIndicator", "VettingCreateIdentityButton"];
  let reached;
  for (let i = 0; i < 40 && !reached; i++) {
    // Making the identity can fail (the agent's DID host did not answer):
    // the screen says so — stop there rather than wait out the timeout.
    if (await existsTestId(driver, "JoinError", 500)) {
      throw new Error(`making the identity failed: ${await textOf(driver, "JoinError")}`);
    }
    if (await notConfiguredShown(driver)) {
      await screenshot(driver, "journey-vetting-not-configured");
      throw new Error('vetting says "No agent is configured" with a linked agent');
    }
    for (const key of firstStep) if (!reached && (await existsTestId(driver, key, 1500))) reached = key;
  }
  if (!reached) {
    await screenshot(driver, "journey-join-vetting");
    throw new Error("making the identity did not hand over to vetting");
  }
  console.log(`[e2e] journey: identity → vetting reached ${reached}`);
  // The name input and the Start button are siblings in the same step, so
  // which one the poll happens to see first says nothing about the screen —
  // and it must not decide whether the prefill is checked at all. (An Android
  // run saw the button first and silently skipped this, 2026-09-22.)
  const onNameStep = ["VettingLegalNameInput", "VettingStartButton"].includes(reached);
  if (onNameStep) {
    if (await existsTestId(driver, "VettingNameFromProfile", 3000)) {
      console.log("[e2e] journey: the vetting name came from the profile");
    } else {
      throw new Error("the vetting name did not come from the profile");
    }
  }
  await screenshot(driver, "journey-join-vetting");
  for (let i = 0; i < 3 && !(await existsTestId(driver, "MyAgent", 2000)); i++) await goBack(driver);

  // "A different community": the scanner, with its paste-link button.
  await openAgentHome(driver);
  await tapTestId(driver, "AgentJoinCommunity", 15000);
  await tapTestId(driver, "JoinScanCommunity", 15000).catch(async () => {
    // A community already chosen by a link opens on what it asks; go back one.
    await goBack(driver);
    await tapTestId(driver, "JoinScanCommunity", 15000);
  });
  let scanner = false;
  for (let i = 0; i < 3 && !scanner; i++) {
    if (await existsTestId(driver, "PasteUrlButton", 5000)) scanner = true;
    else if (await existsTestId(driver, "Continue", 3000)) await tapTestId(driver, "Continue");
  }
  if (!scanner) throw new Error('"A different community" did not open the scanner');
  console.log('[e2e] journey: "A different community" opened the scanner');
  await goBack(driver);
  await sleep(1500);

  // Nothing locked up front: the vetter role appears only when granted.
  await openAgentHome(driver);
  if (await existsTestId(driver, "AgentVetOthers", 2000)) throw new Error('an unlinked vetter sees "Vet someone"');
  if (await existsTestId(driver, "AgentVetOthersLocked", 1000)) throw new Error('a locked "Vet someone" is still shown');
  console.log("[e2e] journey: no locked \"Vet someone\" up front");

  // I was invited.
  if (await scrollToTestId(driver, "AgentInvited", 4).catch(() => undefined)) {
    await tapTestId(driver, "AgentInvited", 15000);
    const opened = (await existsTestId(driver, "InvitedContinue", 15000)) || (await existsTestId(driver, "InvitedShare", 3000));
    if (!opened) throw new Error("I was invited did not open its first step");
    console.log("[e2e] journey: I was invited opened its first step");
    await goBack(driver);
    await sleep(1500);
  }

  // A community link, pasted, opens Join on that community.
  // The run's own community when it names one (a Farm community): the link a
  // phone opens becomes its community, so the lab's would move it off it.
  const vtcDid =
    process.env.KEYRING_COMMUNITY_DID ||
    execFileSync("bash", ["-c", `. "${os.homedir()}/vti-stack/stack.env"; printf %s "$VTC_DID"`], { encoding: "utf8" });
  if (vtcDid.startsWith("did:")) {
    const communityName = process.env.KEYRING_COMMUNITY_NAME || (process.env.KEYRING_COMMUNITY_DID ? "keyring-test" : "Runner lab");
    const link = `keyring://vti/community?d=${encodeURIComponent(vtcDid)}&n=${encodeURIComponent(communityName)}`;
    await pasteLinkFromHome(driver, link);
    await waitForTestId(driver, "JoinAsks", 30000);
    const asks = await driver.$(driver.e2ePlatform === "ios" ? `-ios predicate string:label CONTAINS "${communityName}"` : `android=new UiSelector().textContains("${communityName}")`);
    if (!(await asks.isExisting())) throw new Error("the pasted community link did not open Join on that community");
    console.log("[e2e] journey: a pasted community link opened Join on it");
    for (let i = 0; i < 3 && !(await existsTestId(driver, "MyAgent", 2000)); i++) await goBack(driver);
  }

  // A relaunch.
  await restartApp(driver);
  await waitForTestId(driver, "Contacts", 120000);
  await (await waitForTestId(driver, "MyAgent", 30000)).click();
  await sleep(2500);
  await assertNoLinkedScreen(driver, "after a relaunch");
  await openAgentHome(driver);
  console.log("[e2e] journey: the agent screen after a relaunch");
  await screenshot(driver, "journey-after-relaunch");
}

async function api(method, route, body) {
  const res = await fetch(`${ENROL_URL}${route}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function ensurePage() {
  try {
    await fetch(ENROL_URL);
    console.log(`[e2e] enrolment page already up at ${ENROL_URL}`);
    return undefined;
  } catch {
    /* start one below */
  }
  const proc = spawn(process.execPath, [path.join(PAGE_DIR, "server.mjs")], {
    env: {
      ...process.env,
      ENROL_PORT,
      ENROL_PUBLIC_URL,
      PNM_BIN: PNM,
      PNM_HOME,
      VTA_SLUG,
      ENROL_VTA_DID: runnerVtaDid(),
      ENROL_LABEL: `Keyring lab runner (${VTA_SLUG})`,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      await fetch(ENROL_URL);
      console.log(`[e2e] enrolment page started at ${ENROL_URL} (pid ${proc.pid})`);
      return proc;
    } catch {
      /* not yet */
    }
  }
  throw new Error("the enrolment page did not come up");
}

/** An offer from a page serving another agent would link the phone there — refuse it. */
function assertOfferForRunner(link) {
  const o = new URL(link.replace(/^keyring:\/\//, "https://x/")).searchParams.get("o") || "";
  const offer = JSON.parse(Buffer.from(o, "base64url").toString("utf8"));
  if (offer.vta !== runnerVtaDid()) {
    throw new Error(`the enrolment page at ${ENROL_URL} offers ${offer.vta}, not the runner VTA ${VTA_SLUG}`);
  }
}

async function waitForState(n, wanted, ms = 60000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const view = await api("GET", `/api/offers/${n}`);
    if (view.state === wanted) return view;
    await sleep(1000);
  }
  throw new Error(`offer ${n} never reached ${wanted}`);
}

function aclDids() {
  const out = execFileSync(PNM, ["--vta", VTA_SLUG, "acl", "list"], {
    env: { ...process.env, PNM_HOME },
    encoding: "utf8",
  });
  return out.replace(/\x1b\[[0-9;]*m/g, "");
}

/** My Agent → Link your agent → Scan → paste → the confirm screen. */
async function openLinkFlow(driver, link) {
  // A first-run tour overlays the tabs and swallows the first tap.
  await dismissTourIfPresent(driver);
  await (await waitForTestId(driver, "MyAgent", 30000)).click();
  await sleep(1500);
  if (await existsTestId(driver, "VtaLinkScanAgain", 2000)) {
    await tapTestId(driver, "VtaLinkScanAgain");
  } else {
    await tapTestId(driver, "LinkYourAgentButton", 30000);
  }
  await pasteLinkOnScanScreen(driver, link);
  await waitForTestId(driver, "VtaLinkConfirm", 30000);
}

let driver;
let page;
try {
  page = await ensurePage();
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
  if (platform === "android" && driver.e2eUdid) {
    execFileSync("adb", ["-s", driver.e2eUdid, "reverse", `tcp:${ENROL_PORT}`, `tcp:${ENROL_PORT}`]);
  }

  if (keepState) {
    await waitForTestId(driver, "EnterPIN", 120000).catch(() => undefined);
    await unlockIfLocked(driver);
    await waitForTestId(driver, "Contacts", 300000);
    await sleep(3000);
  } else {
    await completeOnboarding(driver, { firstName: "Link", lastName: "Phone" });
  }

  if (LINK_MODE === "manual") {
    // The no-QR fallback: name the agent, show the key, grant it by hand.
    await dismissTourIfPresent(driver);
    await (await waitForTestId(driver, "MyAgent", 30000)).click();
    await tapTestId(driver, "LinkWithoutQrButton", 30000);
    await tapTestId(driver, "VtaLinkWithoutQr", 15000);
    const address = await waitForTestId(driver, "VtaLinkAgentAddress", 15000);
    // Return on the keyboard submits the address, as a person would.
    await address.setValue(`${runnerVtaDid()}\n`);
    // The key is revealed by "Show my code", which the screen enables once the
    // address looks like a DID — it does not appear on submit. Measured on
    // Android, 2026-09-22: the run waited out 60s on a screen that was only
    // waiting for the tap.
    if (await existsTestId(driver, "VtaLinkShowMyCode", 5000)) {
      await tapTestId(driver, "VtaLinkShowMyCode", 15000);
    }
    await waitForTestId(driver, "VtaLinkManualDid", 60000);
    const temporaryDid = (await textOf(driver, "VtaLinkManualDid")).trim();
    console.log(`[e2e] phone shows its key ${temporaryDid.slice(0, 32)}…`);
    await screenshot(driver, "link-m1-key");
    // GRANT_FIRST=1 skips the pre-grant check. It exists to isolate one
    // variable: in the ordinary manual flow the phone signs in BEFORE its key
    // is in the ACL, on purpose, so the screen can say "not yet" — and a VTA
    // that answers an unknown peer with silence rather than a refusal leaves
    // that sign-in hanging. Granting first makes the same flow sign in with a
    // key the VTA already knows, which is what the QR journey does.
    if (process.env.GRANT_FIRST !== "1") {
      await tapTestId(driver, "VtaLinkCheckGrant", 15000);
      // "Not yet" renders at the BOTTOM of the key card, below a ~350-character
      // did:peer, so on a phone screen it is off the bottom of the scroll view
      // — and Android's UiAutomator does not report off-screen children, so a
      // plain wait never sees it however long it waits. Scroll for it.
      // Existence first, scrolling only if that fails: the two platforms hide
      // it differently. Android's UiAutomator omits off-screen children, so
      // only a scroll finds it; iOS reports the element but not as displayed,
      // so a scroll-for-displayed misses what a plain existence check sees.
      // Checking for existence alone failed on Android; scrolling alone then
      // failed on iOS — both were measured, one after the other.
      const notYetBy = Date.now() + 60000;
      let notYet = false;
      while (!notYet && Date.now() < notYetBy) {
        notYet =
          (await existsTestId(driver, "VtaLinkNotYet", 2000)) ||
          Boolean(await scrollToTestId(driver, "VtaLinkNotYet", 4).catch(() => undefined));
        if (!notYet) await sleep(2000);
      }
      if (!notYet) throw new Error(`${driver.e2ePlatform}: the phone never said the key was not added yet`);
      console.log("[e2e] before the grant: not yet");
    } else {
      console.log("[e2e] GRANT_FIRST=1: granting before the first sign-in");
    }
    execFileSync("bash", [ENROL_MANAGER, temporaryDid, VTA_SLUG, "admin"], { stdio: "inherit" });
    await tapTestId(driver, "VtaLinkCheckGrant", 15000);
    await waitForTestId(driver, "VtaLinkDone", 180000);
    await screenshot(driver, "link-m2-linked");
    if (aclDids().includes(temporaryDid)) throw new Error(`the temporary key ${temporaryDid} is still in the ACL`);
    console.log("[e2e] the temporary key is no longer in the ACL");
    await tapTestId(driver, "VtaLinkContinue", 15000);
    await checkAgentScreen(driver);
    if (JOURNEY) await testerJourney(driver);
    printSuccess("VTA LINK WITHOUT QR — not yet, then granted by hand and rotated");
    process.exitCode = 0;
  } else {
  // 1 — the admin sees codes that differ and refuses: the phone must say so.
  const refused = await api("POST", "/api/offers");
  assertOfferForRunner(refused.link);
  await openLinkFlow(driver, refused.link);
  await screenshot(driver, "link-01-confirm");
  await tapTestId(driver, "VtaLinkButton", 15000);
  await waitForTestId(driver, "VtaLinkCode", 60000);
  await waitForState(refused.offer.n, "submitted");
  await api("POST", `/api/offers/${refused.offer.n}/refuse`);
  await waitForTestId(driver, "VtaLinkError", 30000);
  console.log(`[e2e] refused: ${await textOf(driver, "VtaLinkError")}`);
  await screenshot(driver, "link-02-refused");

  // 2 — the codes match and the admin grants.
  const offered = await api("POST", "/api/offers");
  assertOfferForRunner(offered.link);
  await openLinkFlow(driver, offered.link);
  await tapTestId(driver, "VtaLinkButton", 15000);
  await waitForTestId(driver, "VtaLinkCode", 60000);
  // iOS reads the accessibility label, which spells the code out for VoiceOver.
  const phoneCode = (await textOf(driver, "VtaLinkCode")).replace(/\s+/g, "");
  const view = await waitForState(offered.offer.n, "submitted");
  console.log(`[e2e] phone code ${phoneCode} · page code ${view.code}`);
  await screenshot(driver, "link-03-code");
  if (phoneCode !== view.code) throw new Error(`codes differ: phone ${phoneCode}, page ${view.code}`);
  await api("POST", `/api/offers/${offered.offer.n}/grant`);

  await waitForTestId(driver, "VtaLinkDone", 180000);
  await screenshot(driver, "link-04-linked");
  const temporaryDid = view.did;

  // 3 — the rotation moved the grant: the temporary key is gone, a new one holds it.
  const acl = aclDids();
  if (acl.includes(temporaryDid)) throw new Error(`the temporary key ${temporaryDid} is still in the ACL`);
  console.log("[e2e] the temporary key is no longer in the ACL");

  await tapTestId(driver, "VtaLinkContinue", 15000);
  await checkAgentScreen(driver);
  if (JOURNEY) await testerJourney(driver);

  printSuccess(JOURNEY ? "VTA LINK BY QR + TESTER JOURNEY" : "VTA LINK BY QR — refused, then granted and rotated");
  process.exitCode = 0;
  }
} catch (err) {
  console.error(err);
  if (driver) {
    await screenshot(driver, "link-failure").catch(() => undefined);
    await dumpSource(driver, "link-failure").catch(() => undefined);
  }
  printFailure(LINK_MODE === "manual" ? "VTA LINK (manual)" : "VTA LINK BY QR", err);
  process.exitCode = 1;
} finally {
  if (driver) await driver.deleteSession().catch(() => undefined);
  stopAppium();
  // Only the page this run started, by its PID.
  if (page?.pid) process.kill(page.pid);
}
