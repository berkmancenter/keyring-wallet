#!/usr/bin/env node
/**
 * The phone's camera opens Keyring for a did: code (219, p217-did-scheme).
 *
 * A QR that carries a bare DID is a URL in the `did` scheme; the camera hands
 * it to the app that registered the scheme. This runner hands it over the same
 * way — the OS URL handler (`simctl openurl`, `am start -a VIEW -d`) — and
 * checks what the person then sees, on a fresh phone with NO agent linked:
 *
 *   1. a community's code → Join, which says an agent is needed and offers to link one
 *   2. a code nobody has → "Keyring can't use this code" + "No agent or community has this code."
 *   3. another DID method (did:key) → the same toast, with its own reason (keyring-bifold#92)
 *   4. an agent's code → linking starts (the key is shown); cancelled, nothing granted
 *   5. a cold start behind the PIN → after unlocking, the code is acted on (Join)
 *
 * The camera recognising the code is the phone's own step: only a person with
 * a real phone can check that. Everything after it is here.
 *
 *   KEYRING_COMMUNITY_DID  the community's code (default: keyring-test-vtc on the Farm)
 *   RUNNER_VTA_DID         an agent's code (the runner VTA; linking is started, never granted)
 *   UNKNOWN_DID            a did:webvh no host serves (default below)
 *   OTHER_DID              a non-webvh DID (default: a did:key)
 *
 *   PLATFORM=ios IOS_DEVICE_NAME="…" IOS_APP=…/KeyRing.app node run-did-scheme.mjs
 *   PLATFORM=android ANDROID_AVD=… ANDROID_UDID=emulator-5560 ANDROID_APK=… node run-did-scheme.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";

import { createSession, ensureAppium, stopAppium, screenshot, dumpSource, sleep, existsTestId, byTestId, tapTestId, simTarget } from "./lib/driver.js";
import { completeOnboarding, dismissTourIfPresent, unlockIfLocked } from "./lib/flows.js";
import { APP_ID, androidCaps, iosCaps } from "./lib/config.js";
import { printFailure, printSuccess } from "./lib/banner.js";

const platform = process.env.PLATFORM || "ios";
const COMMUNITY =
  process.env.KEYRING_COMMUNITY_DID ||
  "did:webvh:QmdervYcngPtJnKGuZSzH2tvDe8q274cty8324G4finFnV:dids-keyring-stack.ic3.dev:keyring-test-vtc";
const AGENT = process.env.RUNNER_VTA_DID || "";
const UNKNOWN = process.env.UNKNOWN_DID || "did:webvh:QmNoSuchCode00000000000000000000000000000000:dids.ic3.dev:keyring-no-such-code";
const OTHER = process.env.OTHER_DID || "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";

const textOf = async (d, key) => (await byTestId(d, key).getAttribute(d.e2ePlatform === "ios" ? "label" : "text")) || "";

/** Open a URL the way the camera does: through the OS, not through the app. */
function openUrl(d, url) {
  if (d.e2ePlatform === "ios") execFileSync("xcrun", ["simctl", "openurl", simTarget(d), url], { stdio: "inherit" });
  else {
    const serial = process.env.ANDROID_UDID || process.env.ANDROID_SERIAL || "emulator-5554";
    // No package named: the scheme alone must find Keyring.
    execFileSync("adb", ["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `'${url}'`], { stdio: "inherit" });
  }
  console.log(`[e2e] opened ${url.slice(0, 40)}… through the OS`);
}

async function expectToast(d, what, bodyPattern) {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (await existsTestId(d, "ToastTitle", 1000)) {
      const title = (await textOf(d, "ToastTitle")).trim();
      const body = (await textOf(d, "ToastBody").catch(() => "")).trim();
      if (/^Reading this code/.test(title)) continue;
      if (title !== "Keyring can't use this code") throw new Error(`${what}: the toast says "${title}"`);
      if (bodyPattern && !bodyPattern.test(body)) throw new Error(`${what}: the reason reads "${body}"`);
      console.log(`[e2e] ${what}: "${title}" — "${body}"`);
      if (await existsTestId(d, "ToastClose", 1000)) await tapTestId(d, "ToastClose", 3000).catch(() => undefined);
      await sleep(1500);
      return;
    }
  }
  await screenshot(d, `did-scheme-no-toast-${what.replace(/\W+/g, "-")}`);
  throw new Error(`${what}: nothing told the person the code could not be used`);
}

async function backToHome(d) {
  for (let i = 0; i < 4 && !(await existsTestId(d, "Contacts", 1500)); i++) {
    if (await existsTestId(d, "Back", 1000)) await tapTestId(d, "Back", 3000);
    else await d.back();
    await sleep(800);
  }
  await (await byTestId(d, "Contacts")).click().catch(() => undefined);
}

let driver;
try {
  await ensureAppium();
  driver = await createSession(platform, platform === "android" ? androidCaps() : iosCaps());
  await completeOnboarding(driver, { firstName: "Camera", lastName: "Code" });
  await dismissTourIfPresent(driver);

  // 1 — a community's code, no agent linked: Join, saying what is missing, with the way to it.
  openUrl(driver, COMMUNITY);
  if (!(await existsTestId(driver, "JoinNeedsAgent", 30000))) {
    await screenshot(driver, "did-scheme-community");
    await dumpSource(driver, "did-scheme-community");
    throw new Error("a community's code did not open Join");
  }
  if (!(await existsTestId(driver, "JoinLinkAgent", 3000))) throw new Error('Join with no agent offers no "Link your agent"');
  console.log("[e2e] a community's code opened Join: an agent is needed, and linking one is offered");
  await backToHome(driver);

  // 2 — a code nobody has: said, in words, and nowhere to go.
  openUrl(driver, UNKNOWN);
  await expectToast(driver, "a code nobody has", /No agent or community has this code|couldn't be read/);

  // 3 — another DID method: answered at once, with its own reason.
  openUrl(driver, OTHER);
  await expectToast(driver, "a did:key", /./);

  // 4 — an agent's code, no agent linked: linking starts. Cancelled: nothing is granted.
  if (AGENT) {
    openUrl(driver, AGENT);
    const shown = ["VtaLinkShowingKey", "VtaLinkCode", "VtaLinkCopyKey", "VtaLinkManualDid", "VtaLinkNotYet"];
    let at;
    for (let i = 0; i < 30 && !at; i++) for (const key of shown) if (!at && (await existsTestId(driver, key, 1000))) at = key;
    if (!at) {
      await screenshot(driver, "did-scheme-agent");
      throw new Error("an agent's code did not start linking");
    }
    console.log(`[e2e] an agent's code started linking (${at})`);
    if (await existsTestId(driver, "VtaLinkCancel", 3000)) await tapTestId(driver, "VtaLinkCancel", 5000);
    await backToHome(driver);
  } else {
    console.log("[e2e] SKIPPED the agent's code — set RUNNER_VTA_DID");
  }

  // 5 — a cold start behind the PIN: the code waits for the unlock, then is acted on.
  await driver.terminateApp(APP_ID).catch(() => undefined);
  await sleep(2000);
  openUrl(driver, COMMUNITY);
  if (!(await existsTestId(driver, "EnterPIN", 60000))) console.log("[e2e] no PIN screen seen on the cold start");
  await unlockIfLocked(driver);
  if (!(await existsTestId(driver, "JoinNeedsAgent", 60000))) {
    await screenshot(driver, "did-scheme-cold-start");
    throw new Error("after a cold start and the PIN, the community's code was not acted on");
  }
  console.log("[e2e] a cold start behind the PIN: after unlocking, the code opened Join");

  printSuccess("DID SCHEME — the camera's did: code, routed like a scan");
} catch (err) {
  printFailure("DID SCHEME", err);
  process.exitCode = 1;
} finally {
  await driver?.deleteSession().catch(() => undefined);
  stopAppium();
}
