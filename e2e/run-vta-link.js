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
 * Real iPhone/iPad: PLATFORM=ios IOS_UDID=<hardware udid> with IOS_DEVICE_APP
 *   pointing at a FORCE_BUNDLING device build, and ENROL_PUBLIC_URL an https
 *   URL the device can reach (ATS allows plain http to localhost only).
 */
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

import { createSession, ensureAppium, stopAppium, screenshot, dumpSource, sleep, waitForTestId, byTestId, tapTestId, existsTestId } from "./lib/driver.js";
import { androidCaps, iosCaps, iosDeviceCaps } from "./lib/config.js";
import { completeOnboarding, dismissTourIfPresent, pasteLinkOnScanScreen, unlockIfLocked } from "./lib/flows.js";
import { printSuccess, printFailure } from "./lib/banner.js";

const platform = process.env.PLATFORM || "android";
const keepState = process.env.E2E_KEEP_STATE === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE_DIR = path.resolve(here, "../scripts/openvtc/local-vti-stack/enrol-page");
const ENROL_PORT = process.env.ENROL_PORT || "8190";
const ENROL_URL = process.env.ENROL_URL || `http://localhost:${ENROL_PORT}`;
const PNM = process.env.PNM_BIN || path.join(os.homedir(), "Documents/vti-main/target/debug/pnm");
const PNM_HOME = process.env.PNM_HOME || path.join(os.homedir(), "vti-stack/pnm-alice");
const VTA_SLUG = process.env.VTA_SLUG || "alice";
// What the offer tells the phone to call: localhost for a simulator (or an
// emulator behind adb reverse); an https tunnel for a real device.
const ENROL_PUBLIC_URL = process.env.ENROL_PUBLIC_URL || ENROL_URL;
const IOS_UDID = process.env.IOS_UDID || "";
const LINK_MODE = process.env.LINK_MODE || "qr";
const ENROL_MANAGER = path.resolve(here, "../scripts/openvtc/local-vti-stack/enrol-manager.sh");

function aliceVtaDid() {
  const env = execFileSync("bash", ["-c", `. "${os.homedir()}/vti-stack/stack.env"; printf %s "$ALICE_VTA_DID"`], {
    encoding: "utf8",
  });
  if (!env.startsWith("did:")) throw new Error("ALICE_VTA_DID not found in ~/vti-stack/stack.env");
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
    env: { ...process.env, ENROL_PORT, ENROL_PUBLIC_URL, PNM_BIN: PNM, PNM_HOME, VTA_SLUG },
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
    await address.setValue(aliceVtaDid());
    await tapTestId(driver, "VtaLinkShowMyCode", 15000);
    await waitForTestId(driver, "VtaLinkManualDid", 60000);
    const temporaryDid = (await textOf(driver, "VtaLinkManualDid")).trim();
    console.log(`[e2e] phone shows its key ${temporaryDid.slice(0, 32)}…`);
    await screenshot(driver, "link-m1-key");
    await tapTestId(driver, "VtaLinkCheckGrant", 15000);
    await waitForTestId(driver, "VtaLinkNotYet", 60000);
    console.log("[e2e] before the grant: not yet");
    execFileSync("bash", [ENROL_MANAGER, temporaryDid, VTA_SLUG, "admin"], { stdio: "inherit" });
    await tapTestId(driver, "VtaLinkCheckGrant", 15000);
    await waitForTestId(driver, "VtaLinkDone", 180000);
    await screenshot(driver, "link-m2-linked");
    if (aclDids().includes(temporaryDid)) throw new Error(`the temporary key ${temporaryDid} is still in the ACL`);
    console.log("[e2e] the temporary key is no longer in the ACL");
    await tapTestId(driver, "VtaLinkContinue", 15000);
    await checkAgentScreen(driver);
    printSuccess("VTA LINK WITHOUT QR — not yet, then granted by hand and rotated");
    process.exitCode = 0;
  } else {
  // 1 — the admin sees codes that differ and refuses: the phone must say so.
  const refused = await api("POST", "/api/offers");
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

  printSuccess("VTA LINK BY QR — refused, then granted and rotated");
  process.exitCode = 0;
  }
} catch (err) {
  console.error(err);
  if (driver) {
    await screenshot(driver, "link-failure").catch(() => undefined);
    await dumpSource(driver, "link-failure").catch(() => undefined);
  }
  printFailure(`VTA LINK BY QR failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (driver) await driver.deleteSession().catch(() => undefined);
  stopAppium();
  // Only the page this run started, by its PID.
  if (page?.pid) process.kill(page.pid);
}
