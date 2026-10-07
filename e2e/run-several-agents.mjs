#!/usr/bin/env node
/**
 * Several agents on one phone (bifold #277–#281) and a refusal on Your agent (#282), on an Android
 * built app. Rows, run in this order whatever ROWS lists:
 *   R1 add a second agent and keep the first; switch to it
 *   R2 an identity belongs to its agent: A joins C; on B, Join offers no chooser and goes ahead with B (#334)
 *   R5 a refusal reaches Your agent: the card's own status, and "Check now" if the session holds another identity
 *   R3 requests from the other agent ("Ask me before…" on A, a held task, Requests on B)
 *   R6 both agents join one community; both memberships survive a relaunch; the Wallet names each card's agent
 *   R7 a membership of another agent (#320): A a member of C (R2), on B open C from its Wallet card → "on A"
 *   R4 unlink one of several, then the last
 * Stops at the first unexpected screen, with a screenshot and the page source.
 *
 * The caller links the phone to agent A first (run-vta-link.js, LINK_MODE=manual), and cleans up after:
 * the phone's keys on both agents, any approval rules and approver sets, and the test members of C.
 * A must enforce approvals for R3. DEVICE_PIN is set after the first link, never before.
 *
 *   E2E_APP_ID=… UDID=emulator-5572 A_SLUG=… A_DID=… A_NAME=… B_SLUG=… B_DID=… B_NAME=…
 *   C_DID=… C_ADMIN="<rest did cred>" PNM_BIN=… DEVICE_PIN=1234 ROWS="R1 R2 R5 R3 R4" LOGCAT=<file> node run-several-agents.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { byTestId, dumpSource, ensureAppium, existsTestId, screenshot as rawScreenshot, scrollToTestId, sleep, stopAppium, tapTestId, waitForTestId } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { pasteLinkOnScanScreen, handleBiometricConfirmIfPresent, passNewPhoneOfferIfShown, unlockIfLocked } from "./lib/flows.js";
import { APP_ID } from "./lib/config.js";
import { communityCardKey } from "./lib/testIdKeys.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = path.resolve(here, "../tsp-reference/ref-20-local-vetting/vtc-admin.mjs");
const ENROL = path.resolve(here, "../scripts/openvtc/local-vti-stack/enrol-manager.sh");
const E = process.env;
const UDID = E.UDID;
const PIN = E.DEVICE_PIN || "";
const ROWS = (E.ROWS || "R1 R2 R5 R3 R4").split(/\s+/);
const C_KEY = communityCardKey(E.C_DID || "");
const C_ADMIN = (E.C_ADMIN || "").split(" ").filter(Boolean);
const utc = () => new Date().toISOString().slice(11, 23) + "Z";
const log = (s) => console.log(`[e2e] ${utc()} ${s}`);
const results = [];
const row = (name, ok, what) => {
  results.push([name, ok, what]);
  console.log(`ROW ${name} ${ok ? "PASS" : "FAIL"} — ${what}`);
};
const t0 = {};
const since = (k) => `${((Date.now() - t0[k]) / 1000).toFixed(1)} s`;
const adb = (...a) => execFileSync("adb", ["-s", UDID, ...a], { encoding: "utf8" });
const pnm = (slug, ...a) => {
  try {
    return execFileSync(E.PNM_BIN, ["--vta", slug, ...a], { encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
};
const admin = (...a) => {
  const out = execFileSync("node", [ADMIN, ...C_ADMIN, ...a], { encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] });
  return out;
};
const json = (s) => JSON.parse(s.slice(s.indexOf("{")));
const txt = async (d, id) => ((await existsTestId(d, id, 800)) ? (await textOf(d, id).catch(() => "")).replace(/\s+/g, " ").trim() : null);
const shot = (d, n) => rawScreenshot(d, n).catch((e) => log(`screenshot ${n} not taken: ${String(e.message).slice(0, 60)}`));
const idsWithPrefix = async (d, prefix) => {
  const els = await d.$$(`//*[starts-with(@resource-id,"com.ariesbifold:id/${prefix}")]`);
  const ids = [];
  for (const el of els) ids.push(String(await el.getAttribute("resource-id")).replace("com.ariesbifold:id/", ""));
  return ids;
};
const logcatSince = (mark) => {
  try {
    const lines = readFileSync(E.LOGCAT, "utf8").split("\n");
    const i = mark ? lines.findIndex((l) => l.includes(mark)) : 0;
    return lines.slice(Math.max(0, i));
  } catch {
    return [];
  }
};

/** Answer Android's device-credential prompt, only if one is on screen. */
async function owner(d, tag) {
  let win = "";
  for (let i = 0; i < 16 && !win; i++) {
    await sleep(500);
    win = (adb("shell", "dumpsys", "window", "windows").match(/Window\{[^}]*(AuthContainer|BiometricPrompt|ConfirmDeviceCredential)[^}]*\}/i) || [""])[0];
  }
  if (!win) return false;
  log(`owner check (${tag}): ${win.slice(0, 60)}; typing the PIN`);
  adb("shell", "input", "text", PIN);
  adb("shell", "input", "keyevent", "66");
  await sleep(2500);
  return true;
}

async function stop(d, why) {
  await shot(d, "agents-stop");
  await dumpSource(d, "agents-stop").catch(() => undefined);
  throw new Error(why);
}

async function myAgent(d) {
  await tapTestId(d, "MyAgent", 15000);
  await sleep(1500);
  for (let i = 0; i < 10 && !(await existsTestId(d, "AgentHome", 1000)); i++) {
    // An added agent's introduction comes when Your agent first shows it, which can be well after its link's Done
    // (238 gate: up at R1's switcher read, after a 15 s wait had passed): skip it wherever it shows.
    if (await existsTestId(d, "AgentIntroSkip", 500)) {
      log("an agent's introduction is up: Skip");
      await tapTestId(d, "AgentIntroSkip", 5000).catch(() => undefined);
      await sleep(1000);
      continue;
    }
    await unlockIfLocked(d);
  }
}

async function homeName(d) {
  const now = await txt(d, "AgentHomeName");
  if (now) return now;
  // The home can be scrolled past its header after a switch (22:05:55Z read "" while the switch had taken).
  if (!(await existsTestId(d, "AgentHome", 500))) return "";
  await scrollToTestId(d, "AgentHomeName", 4, { direction: "up" }).catch(() => undefined);
  return (await txt(d, "AgentHomeName")) ?? "";
}

/** A switch takes ~20 s; builds with #281 4a77a9a2 show AgentSwitching meanwhile. Wait for it to end and the name to change (60 s). */
async function waitSwitched(d, wantName) {
  const t = Date.now();
  let sawSwitching = false;
  while (Date.now() - t < 60000) {
    const switching = await existsTestId(d, "AgentSwitching", 500);
    if (switching) sawSwitching = true;
    if (!switching && (await homeName(d)).includes(wantName)) break;
    await sleep(1000);
  }
  log(`switch wait: ${((Date.now() - t) / 1000).toFixed(1)} s · AgentSwitching seen ${sawSwitching}`);
}

/** VtaLink's scan branch: the key as text (VtaLinkShowAsText → VtaLinkManualDid), grant, it polls by itself. */
async function linkScanTo(d, did, slug) {
  await waitForTestId(d, "VtaLinkForOtherPhone", 45000);
  let temp = "";
  if (await scrollToTestId(d, "VtaLinkShowAsText", 3).then((e) => e.click().then(() => true), () => false)) {
    await scrollToTestId(d, "VtaLinkManualDid", 3).catch(() => undefined);
    temp = (await textOf(d, "VtaLinkManualDid")).replace(/\s+/g, "").trim();
  } else {
    // 237's card offers only Copy: read the key from the clipboard.
    await tapTestId(d, "VtaLinkCopyKey", 15000);
    await sleep(1000);
    const text = Buffer.from(String(await d.getClipboard("plaintext").catch(() => "")), "base64").toString("utf8");
    temp = (text.match(/did:[a-z0-9]+:[A-Za-z0-9._:%-]+/) || [""])[0];
  }
  log(`link to ${slug} (scan branch): the phone shows ${temp.slice(0, 30)}…; granting`);
  execFileSync("bash", [ENROL, temp, slug, "admin"], { stdio: "ignore", env: { ...process.env, EXPIRES: "1h" } });
  const by = Date.now() + 240000;
  while (Date.now() < by && !(await existsTestId(d, "VtaLinkDone", 2000))) {
    if (await existsTestId(d, "VtaLinkError", 500)) throw new Error(`the link failed: "${(await textOf(d, "VtaLinkError")).slice(0, 160)}"`);
    if (await existsTestId(d, "VtaLinkCheckAgain", 500)) await tapTestId(d, "VtaLinkCheckAgain", 5000).catch(() => undefined);
  }
  await tapTestId(d, "VtaLinkContinue", 15000);
  await passNewPhoneOfferIfShown(d).catch(() => undefined);
  // The new agent's introduction can come several seconds after Done (238 gate: missed at 2 s, and the switcher
  // read behind it was empty): wait for it, then skip it.
  if (await existsTestId(d, "AgentIntro", 15000)) {
    if (await existsTestId(d, "AgentIntroSkip", 2000)) await tapTestId(d, "AgentIntroSkip", 5000);
    else for (let i = 0; i < 3; i++) if (await existsTestId(d, "AgentIntroNext", 2000)) await tapTestId(d, "AgentIntroNext", 5000);
  }
  return temp;
}

/** The address path (VtaCreateAgent, bifold #338/#339), from its address step: code, grant, Connect, Done. */
let doneLanding;

async function linkByAddressTo(d, did, slug) {
  (await waitForTestId(d, "AgentCreateAddressInput", 15000)).setValue(did);
  await (await scrollToTestId(d, "AgentCreateAddressContinue", 4).catch(() => byTestId(d, "AgentCreateAddressContinue"))).click();
  await waitForTestId(d, "AgentCreateOwnerCode", 60000);
  if (!(await existsTestId(d, "AgentCreateOwnerDid", 2000))) await (await scrollToTestId(d, "AgentCreateShowCode", 6)).click();
  await scrollToTestId(d, "AgentCreateOwnerDid", 4).catch(() => undefined);
  const temp = (await textOf(d, "AgentCreateOwnerDid")).replace(/\s+/g, "").trim();
  log(`link to ${slug} (address path): the phone shows ${temp.slice(0, 30)}…; granting`);
  execFileSync("bash", [ENROL, temp, slug, "admin"], { stdio: "ignore", env: { ...process.env, EXPIRES: "1h" } });
  await (await scrollToTestId(d, "AgentCreateConnect", 6).catch(() => byTestId(d, "AgentCreateConnect"))).click();
  await owner(d, "connect").catch(() => undefined);
  const by = Date.now() + 240000;
  while (Date.now() < by && !(await existsTestId(d, "AgentCreateReady", 2000))) {
    if (await existsTestId(d, "AgentCreateError", 500)) throw new Error(`the address link failed: "${(await textOf(d, "AgentCreateError")).slice(0, 160)}"`);
    if (await existsTestId(d, "AgentCreateCheckAgain", 500)) await tapTestId(d, "AgentCreateCheckAgain", 5000).catch(() => undefined);
  }
  await tapTestId(d, "AgentCreateDone", 15000);
  await sleep(2000);
  await shot(d, "add-done-2s");
  await passNewPhoneOfferIfShown(d).catch(() => undefined);
  // The new agent's introduction can come several seconds after Done (238 gate: missed at 2 s, and the switcher
  // read behind it was empty): wait for it, then skip it. 239 (#349): Done lands on Your agent, so it comes at once;
  // on 238 Done went back to the link panel and it came only once My Agent was opened. Recorded for R1's row.
  doneLanding = { intro: await existsTestId(d, "AgentIntro", 15000), linkPanel: await existsTestId(d, "VtaLinkByAddress", 500) };
  log(`Done landed: introduction ${doneLanding.intro} · link panel ${doneLanding.linkPanel}`);
  if (doneLanding.intro) {
    if (await existsTestId(d, "AgentIntroSkip", 2000)) await tapTestId(d, "AgentIntroSkip", 5000);
    else for (let i = 0; i < 3; i++) if (await existsTestId(d, "AgentIntroNext", 2000)) await tapTestId(d, "AgentIntroNext", 5000);
  }
  return temp;
}

/** The no-QR link to `did` (slug for the grant), from a link screen already open. */
async function linkTo(d, did, slug) {
  // 237: Add can open the scanner: paste the agent's bare address, then VtaLink's scan branch.
  if (await existsTestId(d, "PasteUrlButton", 3000)) {
    await pasteLinkOnScanScreen(d, did);
    return linkScanTo(d, did, slug);
  }
  // #338/#339: no "Link without a QR code" here, the address path instead (VtaCreateAgent).
  if (!(await existsTestId(d, "VtaLinkAgentAddress", 3000)) && !(await existsTestId(d, "VtaLinkWithoutQr", 1500))) {
    for (const entry of ["VtaLinkByAddress", "LinkByAddressButton"]) if (await existsTestId(d, entry, 1500)) { await tapTestId(d, entry, 10000); break; }
    if (await existsTestId(d, "AgentCreateAddressInput", 15000)) return linkByAddressTo(d, did, slug);
  }
  if (!(await existsTestId(d, "VtaLinkAgentAddress", 3000))) await tapTestId(d, "VtaLinkWithoutQr", 15000).catch(() => undefined);
  const address = await waitForTestId(d, "VtaLinkAgentAddress", 20000);
  await address.setValue(`${did}\n`);
  const by = Date.now() + 60000;
  const tapped = new Set();
  // The key renders below the fold, and Android leaves off-screen views out of the tree: scroll to it.
  const keyInView = async () => (await existsTestId(d, "VtaLinkManualDid", 1000)) || Boolean(await scrollToTestId(d, "VtaLinkManualDid", 3, { from: 0.5 }).catch(() => undefined));
  while (!(await keyInView()) && Date.now() < by) {
    for (const key of ["VtaLinkShowTheCode", "VtaLinkShowMyCode"]) {
      if (tapped.has(key)) continue;
      const t = await scrollToTestId(d, key, 3, { from: 0.5 }).catch(() => undefined);
      if (t) {
        await t.click().catch(() => undefined);
        tapped.add(key);
        break;
      }
    }
  }
  await scrollToTestId(d, "VtaLinkManualDid", 4, { from: 0.5 }).catch(() => undefined);
  const temp = (await textOf(d, "VtaLinkManualDid")).trim();
  log(`link to ${slug}: the phone shows ${temp.slice(0, 30)}…; granting`);
  execFileSync("bash", [ENROL, temp, slug, "admin"], { stdio: "ignore", env: { ...process.env, EXPIRES: "1h" } });
  await tapTestId(d, "VtaLinkCheckGrant", 15000);
  await waitForTestId(d, "VtaLinkDone", 180000);
  await tapTestId(d, "VtaLinkContinue", 15000);
  await passNewPhoneOfferIfShown(d).catch(() => undefined);
  // The new agent's introduction can come several seconds after Done (238 gate: missed at 2 s, and the switcher
  // read behind it was empty): wait for it, then skip it.
  if (await existsTestId(d, "AgentIntro", 15000)) {
    if (await existsTestId(d, "AgentIntroSkip", 2000)) await tapTestId(d, "AgentIntroSkip", 5000);
    else for (let i = 0; i < 3; i++) if (await existsTestId(d, "AgentIntroNext", 2000)) await tapTestId(d, "AgentIntroNext", 5000);
  }
  return temp;
}

async function openSwitcher(d) {
  await myAgent(d);
  // 236 (#316): the agents are chips, always shown; there is no AgentSwitcherOpen to tap.
  if (!(await existsTestId(d, "AgentSwitcherOpen", 1500))) {
    await scrollToTestId(d, "AgentSwitcherRow_0", 4, { from: 0.35 }).catch(() => undefined);
    return;
  }
  await scrollToTestId(d, "AgentSwitcherOpen", 4).catch(() => undefined);
  // AgentSwitcherOpen toggles: tapping it while the list is open closes it (21:58:47Z miss).
  if ((await switcherRows(d)).length) return;
  await tapTestId(d, "AgentSwitcherOpen", 15000);
  await sleep(1500);
}

async function switchToOther(d, wantName) {
  await myAgent(d);
  if ((await homeName(d)).includes(wantName)) {
    log(`already on ${wantName}`);
    return;
  }
  await openSwitcher(d);
  const rows = await switcherRows(d);
  let target = rows.find((r) => r.desc.includes(wantName) && !/Current/.test(r.desc));
  if (!target) {
    // After a relaunch the other agent's row read "your agent" (23:40:54Z): record it, and take the one other row.
    const others = rows.filter((r) => !/Current/.test(r.desc));
    console.log(`FINDING switcher has no row naming ${wantName}: ${JSON.stringify(rows)}`);
    if (others.length === 1) target = others[0];
    else await stop(d, `no switcher row naming ${wantName} that is not current (rows ${JSON.stringify(rows)})`);
  }
  await tapTestId(d, target.id, 10000);
  await owner(d, `switch to ${wantName}`);
  await waitSwitched(d, wantName);
  await myAgent(d);
  let now = await homeName(d);
  if (!now.includes(wantName)) {
    // One retry: a tap on the switcher row can be dropped while the list animates (21:36:17Z).
    log(`switch to ${wantName} did not take (home "${now}"); retrying once`);
    await shot(d, "agents-switch-retry");
    await dumpSource(d, "agents-switch-retry").catch(() => undefined);
    console.log(`SWITCH-MISS ${new Date().toISOString()}`);
    // At a missed row tap (seen on 2026-10-05 after R5's decline): the raw view tree (non-a11y overlays), the responder,
    // one manual tap at the row's centre, then a tab round trip and a tap again — does either reach onPress?
    const adb = (...a) => { try { return execFileSync("adb", ["-s", UDID, ...a], { encoding: "utf8", timeout: 30000 }); } catch (e) { return `adb ${a.join(" ")} failed: ${e.message}`; } };
    const stamp = Date.now();
    // Uncompressed is uiautomator's default: the tree with non-accessibility views as well.
    console.log(`MISS-UIDUMP ${adb("shell", "uiautomator", "dump", "/sdcard/miss.xml").trim().slice(0, 160)}`);
    console.log(`MISS-UIDUMP-PULL ${adb("pull", "/sdcard/miss.xml", path.join("artifacts", `agents-miss-uidump-${stamp}.xml`)).trim().slice(0, 160)}`);
    const top = adb("shell", "dumpsys", "activity", "top").split("\n").filter((l) => /mResponder|ReactRootView|mFocused|ACTIVITY|mCurrentFocus/i.test(l)).slice(0, 16).join("\n");
    console.log(`MISS-TOP\n${top}`);
    const rowEl = await d.$(`android=new UiSelector().resourceId("com.ariesbifold:id/${target.id}")`);
    if (await rowEl.isExisting().catch(() => false)) {
      const loc = await rowEl.getLocation();
      const size = await rowEl.getSize();
      const [x, y] = [Math.round(loc.x + size.width / 2), Math.round(loc.y + size.height / 2)];
      adb("shell", "input", "tap", String(x), String(y));
      console.log(`MISS-MANUAL-TAP ${new Date().toISOString()} at ${x},${y}`);
      await sleep(5000);
      now = await homeName(d);
      log(`after one manual adb tap: home "${now}"`);
    } else log("the row is no longer on screen for a manual tap");
    if (!now.includes(wantName)) {
      await tapTestId(d, "Contacts", 10000).catch(() => undefined);
      await sleep(1500);
      await myAgent(d);
      await openSwitcher(d);
      const again2 = (await switcherRows(d)).find((r) => r.desc.includes(wantName) && !/Current/.test(r.desc));
      if (again2) {
        await tapTestId(d, again2.id, 10000);
        console.log(`MISS-TAB-ROUNDTRIP-TAP ${new Date().toISOString()}`);
        await waitSwitched(d, wantName);
        await myAgent(d);
        now = await homeName(d);
        log(`after a tab round trip and a tap: home "${now}"`);
      }
    }
    if (now.includes(wantName)) { log(`switched: home now "${now}" (wanted ${wantName}), after the miss captures`); return; }
    await openSwitcher(d);
    const again = (await switcherRows(d)).find((r) => r.desc.includes(wantName) && !/Current/.test(r.desc));
    if (again) {
      await tapTestId(d, again.id, 10000);
      await owner(d, `switch to ${wantName} (retry)`);
      await waitSwitched(d, wantName);
      await myAgent(d);
      now = await homeName(d);
    }
  }
  log(`switched: home now "${now}" (wanted ${wantName})`);
  if (!now.includes(wantName)) await stop(d, `the switch to ${wantName} did not take: home "${now}"`);
}

/** Open the community's link (the Join screen for C). */
async function openC(d) {
  adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `'keyring://vti/community?d=${encodeURIComponent(E.C_DID)}'`, APP_ID);
  await sleep(4000);
}

/** Ask to join C on the current agent (the review way); answers the owner check; returns the request id. */
async function askToJoinC(d, tag) {
  const before = new Set((json(admin("join-list")).items ?? []).map((r) => r.id));
  await openC(d);
  await scrollToTestId(d, "JoinAsk", 6, { from: 0.45 }).catch(() => undefined);
  const askId = (await existsTestId(d, "JoinAsk", 3000)) ? "JoinAsk" : "JoinStart";
  await tapTestId(d, askId, 15000);
  await waitForTestId(d, "JoinMakeIdentity", 30000).catch(() => undefined);
  if (await existsTestId(d, "JoinAsContinue", 3000)) await tapTestId(d, "JoinAsContinue", 10000);
  await handleBiometricConfirmIfPresent(d).catch(() => undefined);
  await owner(d, `${tag} identity`);
  await waitForTestId(d, "JoinStanding", 240000);
  let req;
  for (const until = Date.now() + 60000; Date.now() < until && !req; await sleep(3000)) req = (json(admin("join-list")).items ?? []).find((r) => !before.has(r.id));
  if (!req) await stop(d, `${tag}: the community lists no new join request`);
  log(`${tag}: request ${req.id} ${req.status} from …${String(req.applicantDid).slice(-24)}`);
  return req;
}

/** A row's text as shown: its own text, else its descendants' (Android containers carry none). */
async function rowText(d, id) {
  const el = await d.$(`android=new UiSelector().resourceId("com.ariesbifold:id/${id}")`);
  if (!(await el.isExisting().catch(() => false))) return null;
  const own = await el.getAttribute("text").catch(() => "");
  if (own) return own;
  let out = "";
  for (const c of await el.$$(".//*")) {
    const t = await c.getAttribute("text").catch(() => "");
    if (t) out += `${t} `;
  }
  // JoinAgentSuggested is an empty view with its words in the next sibling (page source 23:27:43Z): read that.
  if (!out.trim()) {
    for (const c of await d.$$(`//*[@resource-id="com.ariesbifold:id/${id}"]/following-sibling::*[1][@text!=""]`)) out += `${await c.getAttribute("text").catch(() => "")} `;
  }
  return out.trim();
}

/** The switcher's rows: AgentSwitcherRow_N, each content-desc "<agent name>, <status>". */
async function switcherRows(d) {
  const rows = [];
  for (const el of await d.$$(`//*[starts-with(@resource-id,"com.ariesbifold:id/AgentSwitcherRow_")]`)) {
    rows.push({ id: String(await el.getAttribute("resource-id")).replace("com.ariesbifold:id/", ""), desc: String(await el.getAttribute("content-desc").catch(() => "")) });
  }
  return rows;
}

let d;
try {
  await ensureAppium();
  d = await makeDriver({ platform: "android", udid: UDID, keepState: true });
  await d.activateApp(APP_ID);
  await unlockToHome(d);
  if (PIN) {
    adb("shell", "locksettings", "set-pin", PIN);
    log("device PIN set (after the first link); waiting past the 5 s key window");
    await sleep(8000);
  }

  if (ROWS.includes("R1")) {
    t0.R1 = Date.now();
    await openSwitcher(d);
    await shot(d, "agents-r1-switcher-one");
    await tapTestId(d, "AgentSwitcherAdd", 15000);
    await owner(d, "add agent");
    const tempB = await linkTo(d, E.B_DID, E.B_SLUG);
    // 237: the new agent's introduction can play first (1 of 3), then the "added" card: skip the one, wait for the other.
    for (const until = Date.now() + 60000; Date.now() < until; ) {
      if (await existsTestId(d, "AgentAddedCard", 1500)) break;
      if (await existsTestId(d, "AgentIntroSkip", 800)) await tapTestId(d, "AgentIntroSkip", 5000).catch(() => undefined);
      else if (await existsTestId(d, "AgentIntroNext", 500)) await tapTestId(d, "AgentIntroNext", 5000).catch(() => undefined);
      else if (await existsTestId(d, "AgentHome", 500)) break;
    }
    // The card sits on the new agent's home and can come a moment after it, or below the fold (238: the loop broke
    // on AgentHome before it showed, Keep was never tapped, and the new agent stayed current): look for it.
    // 238: after Add's Done the app is not on Your agent; the new agent's introduction, and the "added" card behind
    // it, render when Your agent is opened (1007-1509: nothing for 3.5 min until the My Agent tab was tapped). Open it
    // (myAgent skips the introduction), then look for Keep.
    // #349 (239): Done lands on Your agent, so after the introduction the Keep card is there without the tab.
    let keepAtOnce = false;
    if (doneLanding?.intro) for (const until = Date.now() + 15000; Date.now() < until && !keepAtOnce; ) {
      keepAtOnce = Boolean(await scrollToTestId(d, "AgentAddedKeep", 2, { from: 0.6 }).catch(() => undefined));
      if (!keepAtOnce) await sleep(1000);
    }
    row("add-done-lands", Boolean(doneLanding?.intro) && keepAtOnce, `after Done: introduction ${doneLanding?.intro ?? "?"}, link panel ${doneLanding?.linkPanel ?? "?"}; Keep card without opening My Agent ${keepAtOnce} (#349)`);
    await myAgent(d);
    for (const until = Date.now() + 30000; Date.now() < until; ) {
      if (await existsTestId(d, "AgentIntroSkip", 500)) {
        log("R1: the new agent's introduction is up: Skip");
        await tapTestId(d, "AgentIntroSkip", 5000).catch(() => undefined);
        await sleep(1500);
        continue;
      }
      if (await scrollToTestId(d, "AgentAddedKeep", 2, { from: 0.6 }).catch(() => undefined)) break;
      await sleep(1000);
    }
    const cardEl = await d.$(`android=new UiSelector().resourceId("com.ariesbifold:id/AgentAddedCard")`);
    let card = "";
    if (await cardEl.isExisting().catch(() => false)) for (const c of await cardEl.$$(".//*")) { const t = await c.getAttribute("text").catch(() => ""); if (t) card += `${t} `; }
    log(`R1: added card "${card?.slice(0, 160)}"`);
    const keep = (await existsTestId(d, "AgentAddedKeep", 3000)) ? byTestId(d, "AgentAddedKeep") : await scrollToTestId(d, "AgentAddedKeep", 3, { from: 0.6 }).catch(() => undefined);
    if (keep) {
      await keep.click();
      await owner(d, "keep");
    } else log("R1: no AgentAddedKeep card after the link (the app went on to the agent)");
    await openSwitcher(d);
    const rows = await switcherRows(d);
    const others = rows.filter((r) => !/Current/.test(r.desc));
    const current = rows.find((r) => /Current/.test(r.desc))?.desc ?? "";
    const otherName = others[0]?.desc ?? "";
    await shot(d, "agents-r1-switcher-two");
    await d.back().catch(() => undefined);
    await myAgent(d);
    const name = await homeName(d);
    log(`R1: switcher current "${current}" · others ${others.length} · home "${name}" (${since("R1")})`);
    row("R1 add + keep", rows.length === 2 && current.includes(E.A_NAME) && otherName.includes(E.B_NAME) && name.includes(E.A_NAME), `rows ${JSON.stringify(rows.map((r) => r.desc))}, home "${name}"`);
    t0.R1b = Date.now();
    await switchToOther(d, E.B_NAME);
    await myAgent(d);
    const nameB = await homeName(d);
    const online = await txt(d, "AgentHomeStatus");
    log(`R1: after switching, home "${nameB}" · status "${online}" (${since("R1b")})`);
    row("R1 switch to B", nameB.includes(E.B_NAME), `home "${nameB}", status "${online}" in ${since("R1b")}`);
    console.log(`TEMP_B ${tempB}`);
  }

  // R8 (IN-132, bifold #350): Add an agent this phone already has (B). By address: refused with "This phone already
  // has that agent." and "Switch to it", no code, no key added to B; Switch to it lands on B. By scan: refused.
  if (ROWS.includes("R8")) {
    t0.R8 = Date.now();
    const aclCount = () => { const t = pnm(E.B_SLUG, "acl", "list", "--json"); try { return JSON.parse(t.slice(t.indexOf("["))).length; } catch { return -1; } };
    const before = aclCount();
    await myAgent(d);
    await tapTestId(d, "AgentSwitcherAdd", 15000);
    await owner(d, "add agent (existing)");
    if (await existsTestId(d, "VtaLinkByAddress", 8000)) await tapTestId(d, "VtaLinkByAddress", 10000);
    (await waitForTestId(d, "AgentCreateAddressInput", 15000)).setValue(E.B_DID);
    await (await scrollToTestId(d, "AgentCreateAddressContinue", 4).catch(() => byTestId(d, "AgentCreateAddressContinue"))).click();
    let said = "";
    let code = false;
    for (const until = Date.now() + 30000; Date.now() < until && !said && !code; ) {
      if (await existsTestId(d, "AgentCreateError", 1000)) said = (await textOf(d, "AgentCreateError").catch(() => "")).replace(/\s+/g, " ").trim();
      else code = await existsTestId(d, "AgentCreateOwnerCode", 1000);
    }
    const switchBtn = await scrollToTestId(d, "AgentCreateSwitchToExisting", 3).catch(() => undefined);
    await shot(d, "agents-r8-add-existing");
    const after = aclCount();
    row("add-existing-refused", /already has that agent/i.test(said) && Boolean(switchBtn) && !code && before >= 0 && after === before, `said "${said}" · Switch to it ${Boolean(switchBtn)} · code step ${code} · B's ACL ${before} → ${after}`);
    if (switchBtn) {
      await switchBtn.click();
      await owner(d, "switch to existing").catch(() => undefined);
      await waitSwitched(d, E.B_NAME).catch(() => undefined);
      await myAgent(d);
      const now = await homeName(d);
      row("add-existing-switch", now.includes(E.B_NAME), `Switch to it → home "${now}"`);
    } else row("add-existing-switch", false, "no AgentCreateSwitchToExisting");
    // By scan: Add, the scanner, B's bare address pasted.
    await myAgent(d);
    await tapTestId(d, "AgentSwitcherAdd", 15000);
    await owner(d, "add agent (existing, scan)");
    if (await existsTestId(d, "VtaLinkScanAgain", 8000)) await tapTestId(d, "VtaLinkScanAgain", 10000);
    let scanSaid = "";
    if (await existsTestId(d, "PasteUrlButton", 10000)) {
      await pasteLinkOnScanScreen(d, E.B_DID);
      for (const until = Date.now() + 30000; Date.now() < until && !scanSaid; await sleep(1000)) {
        const src = await d.getPageSource();
        scanSaid = (src.match(/(?:text|content-desc)="([^"]*already has that agent[^"]*)"/i) || [])[1] || "";
      }
    }
    await shot(d, "agents-r8-scan-existing");
    row("add-existing-scan-refused", /already has that agent/i.test(scanSaid), scanSaid ? `"${scanSaid}"` : "no \"already has that agent\" words after pasting B's address");
    await myAgent(d);
    if (!(await homeName(d)).includes(E.A_NAME)) await switchToOther(d, E.A_NAME);
    log(`R8 done in ${since("R8")}`);
  }

  if (ROWS.includes("R2")) {
    t0.R2 = Date.now();
    if (!(await homeName(d)).includes(E.A_NAME)) await switchToOther(d, E.A_NAME);
    const req = await askToJoinC(d, "R2 on A");
    log(`R2: admin approves: ${admin("join-decide", req.id, "approved").trim().split("\n").filter((l) => /->/.test(l)).pop()}`);
    console.log(`R2_MEMBER ${req.applicantDid}`);
    await sleep(5000);
    await switchToOther(d, E.B_NAME);
    await openC(d);
    // bifold #334 took Join's agent chooser away: on B, Join offers no other agent and goes ahead with B.
    const chooser = (await existsTestId(d, "JoinWithAgent", 6000)) || (await existsTestId(d, "JoinUseSuggestedAgent", 1500)) || (await existsTestId(d, "JoinAgentSuggested", 1500));
    await scrollToTestId(d, "JoinAsk", 6, { from: 0.45 }).catch(() => undefined);
    const ask = (await existsTestId(d, "JoinAsk", 4000)) || (await existsTestId(d, "JoinStart", 1500)) || (await existsTestId(d, "JoinWays", 1500));
    const standingOnB = await txt(d, "JoinStandingText");
    await shot(d, "agents-r2-join-on-b");
    await dumpSource(d, "agents-r2-join-on-b").catch(() => undefined);
    log(`R2: on B, Join shows a chooser ${chooser} · its own way in ${ask} · standing on B "${standingOnB}" (${since("R2")})`);
    row("R2 Join on B goes ahead with B", !chooser && ask && !standingOnB, `chooser ${chooser}; way in ${ask}; standing on B "${standingOnB}"`);
    await d.back().catch(() => undefined);
    await switchToOther(d, E.A_NAME);
  }

  if (ROWS.includes("R7")) {
    // #320: what the phone knows of C is A's. On B, C's screen says so and offers A, not Leave.
    t0.R7 = Date.now();
    await switchToOther(d, E.B_NAME);
    await tapTestId(d, "Wallet", 10000).catch(() => undefined);
    await sleep(3000);
    // Which tap opens the "Add credentials" sheet (236 gate, both runs): the screen between the two.
    await shot(d, "agents-r7-wallet-before-card");
    await dumpSource(d, "agents-r7-wallet-before-card").catch(() => undefined);
    // The Wallet remounts on each tab tap and can show EmptyList (its AddFirstCredential sits where a card
    // row is) until its records load (f7, 10-06). Tap only once the card has held, with no empty state, for 1 s;
    // say whether the empty state showed meanwhile: that is the app-side evidence.
    let emptySeen = false;
    let steadySince = 0;
    for (const until = Date.now() + 20000; Date.now() < until; await sleep(200)) {
      const empty = (await existsTestId(d, "NoCredentials", 100).catch(() => false)) || (await existsTestId(d, "AddFirstCredential", 100).catch(() => false));
      const card = await d.$('android=new UiSelector().resourceId("com.ariesbifold:id/CredentialName").textContains("Keyring Lab Community")').isExisting().catch(() => false);
      if (empty) emptySeen = true;
      if (card && !empty) {
        steadySince ||= Date.now();
        if (Date.now() - steadySince >= 1000) break;
      } else steadySince = 0;
    }
    log(`R7: Wallet empty state seen before the card held: ${emptySeen}`);
    console.log(`R7-CARD-TAP ${new Date().toISOString()} empty-seen ${emptySeen}`); // to line up with logcat's Wallet render
    // The Wallet's first-visit tour ("Add credentials", step 1) sits over the list and takes the tap (f7, 10-06:
    // CredentialsTourSteps; the same since 235). Close it first: its ✕ is `Close`, its "Done" is `Next`.
    const tour = await existsTestId(d, "Close", 1500).catch(() => false);
    if (tour) {
      await tapTestId(d, "Close", 5000).catch(() => tapTestId(d, "Next", 5000));
      await sleep(1000);
    }
    log(`R7: Wallet open; first-visit tour was up: ${tour}`);
    // The card by its name line (CredentialName), not by any text naming C: the first text match can be
    // something else on the page (236 gate, 05:27Z: the run ended on Wallet behind "Add credentials").
    const cardEl = await d.$('android=new UiSelector().resourceId("com.ariesbifold:id/CredentialName").textContains("Keyring Lab Community")');
    if (!(await cardEl.isExisting().catch(() => false))) {
      await dumpSource(d, "agents-r7-wallet").catch(() => undefined);
      await stop(d, "R7: no Wallet card for C (R2 makes A a member first)");
    }
    await cardEl.click();
    if (!(await existsTestId(d, "CommunityCardDetails", 15000)) && !(await scrollToTestId(d, "CommunityCardDetails", 4).catch(() => undefined))) {
      await shot(d, "agents-r7-after-card-tap");
      await dumpSource(d, "agents-r7-after-card-tap").catch(() => undefined);
      await stop(d, "R7: the Wallet card opened no community details (CommunityCardDetails)");
    }
    const open = await scrollToTestId(d, "CommunityCardOpenCommunity", 8).catch(() => undefined);
    if (!open) {
      await dumpSource(d, "agents-r7-details").catch(() => undefined);
      await stop(d, "R7: the card's details offer no way to open C");
    }
    await open.click();
    const held = await existsTestId(d, "CommunityHeldElsewhere", 20000);
    const heldText = held ? await rowText(d, "CommunityHeldElsewhereText") : null;
    const useA = await existsTestId(d, "CommunityUseHolderAgent", 3000);
    const leave = await existsTestId(d, "LeaveCommunityButton", 1500);
    await shot(d, "agents-r7-held-elsewhere");
    log(`R7: on B, C shows held elsewhere ${held} "${heldText}" · use A ${useA} · Leave ${leave} (${since("R7")})`);
    row("R7 C says it is A's", held && (heldText ?? "").includes(E.A_NAME) && useA && !leave, `held ${held} "${heldText}"; use A ${useA}; Leave offered ${leave}`);
    if (useA) {
      await tapTestId(d, "CommunityUseHolderAgent", 10000);
      await owner(d, "R7 use A");
      await waitSwitched(d, E.A_NAME).catch(() => undefined);
      await sleep(3000);
      const after = !(await existsTestId(d, "CommunityHeldElsewhere", 3000));
      await shot(d, "agents-r7-after-use-a");
      await myAgent(d);
      const nameAfter = await homeName(d);
      row("R7 use A", after && nameAfter.includes(E.A_NAME), `held card gone ${after}; home "${nameAfter}"`);
    }
  }

  if (ROWS.includes("R5")) {
    t0.R5 = Date.now();
    // A second identity for C, made on B; its request is declined while the shared session holds A's identity.
    await switchToOther(d, E.B_NAME);
    const req = await askToJoinC(d, "R5 on B");
    await switchToOther(d, E.A_NAME);
    await myAgent(d);
    log(`R5: admin declines: ${admin("join-decide", req.id, "rejected").trim().split("\n").filter((l) => /->/.test(l)).pop()}`);
    console.log(`R5_APPLICANT ${req.applicantDid}`);
    console.log(`R5-SWITCH-B ${new Date().toISOString()}`);
    await switchToOther(d, E.B_NAME);
    await myAgent(d);
    let heldStatus = "";
    const holds = async (tag) => {
      await scrollToTestId(d, `AgentCommunityCard_${C_KEY}`, 6).catch(() => undefined);
      const card = await existsTestId(d, `AgentCommunityCard_${C_KEY}`, 1500);
      const status = await rowText(d, `AgentCommunityStatus_${C_KEY}`);
      const check = await existsTestId(d, `AgentCommunityCheck_${C_KEY}`, 800);
      await shot(d, `agents-r5-holds-${tag}`);
      await dumpSource(d, `agents-r5-holds-${tag}`).catch(() => undefined);
      heldStatus = status || heldStatus;
      log(`R5 holds (${tag}): AgentCommunityCard ${card} · status "${status}" · AgentCommunityCheck ${check}`);
    };
    await holds("0s");
    await sleep(30000);
    await holds("30s");
    await scrollToTestId(d, `AgentCommunityCheck_${C_KEY}`, 4).catch(() => undefined);
    const hasCheck = await existsTestId(d, `AgentCommunityCheck_${C_KEY}`, 5000);
    const tc = Date.now();
    if (hasCheck) await tapTestId(d, `AgentCommunityCheck_${C_KEY}`, 5000);
    // Looking for "Check now" swipes; with none, the card can be off screen now (237: status read null). Back to it.
    else await scrollToTestId(d, `AgentCommunityStatus_${C_KEY}`, 6).catch(() => undefined);
    // Without "Check now", a refusal the card already showed while it held (0 s / 30 s) is the card learning it by itself.
    let refused = !hasCheck && /turned down/i.test(heldStatus) ? heldStatus : null;
    let toast = null;
    for (const until = Date.now() + 30000; Date.now() < until && !refused; await sleep(1000)) {
      toast = toast ?? (await txt(d, "ToastTitle"));
      // The status as the hold check reads it (rowText: the line, or its children on Android): txt() read null on 237.
      const st = (await rowText(d, `AgentCommunityStatus_${C_KEY}`)) || (await txt(d, `AgentCommunityStatus_${C_KEY}`));
      if (/turned down/i.test(st ?? "") || /turned down/i.test(toast ?? "")) refused = st ?? toast;
    }
    await shot(d, "agents-r5-refusal");
    log(`R5: "Check now" ${hasCheck ? "tapped" : "ABSENT"} · refusal "${refused}" after ${((Date.now() - tc) / 1000).toFixed(1)} s · toast "${toast}"`);
    // Two ways a refusal reaches the card. With the session on this identity, the card learns it by itself and
    // offers no "Check now"; with the session on another identity, "Check now" is the way. Either is a pass; the
    // other is reported as not reached, not as a failure.
    if (hasCheck) {
      row("R5 refusal via Check now", Boolean(refused), `Check now shown; "${refused}"`);
    } else {
      row("R5 refusal on the card by itself", Boolean(refused), `no Check now needed; "${refused}"`);
      console.log('NOT-REACHED R5 "Check now": the session held this identity, so the card learned the refusal by itself');
    }
  }

  if (ROWS.includes("R3")) {
    t0.R3 = Date.now();
    await switchToOther(d, E.A_NAME);
    await myAgent(d);
    await tapTestId(d, "AgentSegment_manage", 8000).catch(() => undefined);
    await scrollToTestId(d, "AgentAskMeRow", 6).catch(() => undefined);
    await tapTestId(d, "AgentAskMeRow", 15000);
    await waitForTestId(d, "AskMeSwitch_contextsCreate", 30000);
    await tapTestId(d, "AskMeSwitch_contextsCreate", 10000);
    await owner(d, "rule on");
    await sleep(3000);
    const rulesOn = pnm(E.A_SLUG, "approvals", "list");
    log(`R3: A's rules after "on": ${rulesOn.replace(/\s+/g, "").slice(0, 160)}`);
    await d.back().catch(() => undefined);
    await switchToOther(d, E.B_NAME);
    await myAgent(d);
    const held = pnm(E.A_SLUG, "contexts", "create", "--id", `agents-r3-${Math.floor(Date.now() / 1000)}`, "--name", "several agents check");
    log(`R3: pnm on A: ${held.replace(/\s+/g, " ").slice(-120)}`);
    let waiting = [];
    for (const until = Date.now() + 90000; Date.now() < until && !waiting.length; await sleep(3000)) {
      await myAgent(d);
      waiting = await idsWithPrefix(d, "AgentOtherWaiting_");
      // 236 (#316): the count sits on the other agent's chip instead.
      if (!waiting.length) waiting = await idsWithPrefix(d, "AgentSwitcherBadge_");
    }
    const wText = waiting.length ? await txt(d, waiting[0]) : null;
    await shot(d, "agents-r3-other-waiting");
    log(`R3: AgentOtherWaiting ${waiting.join(",") || "none"} "${wText}" (${since("R3")})`);
    await scrollToTestId(d, "AgentRequestsRow", 6).catch(() => undefined);
    await tapTestId(d, "AgentRequestsRow", 10000).catch(() => undefined);
    const others = await existsTestId(d, "RequestsOtherAgents", 10000);
    const sw = await idsWithPrefix(d, "RequestsSwitch_");
    await shot(d, "agents-r3-requests");
    row("R3 other agent waiting", waiting.length > 0 && others && sw.length > 0, `AgentOtherWaiting ${waiting.length}; RequestsOtherAgents ${others}; switch ${sw.length}`);
    if (sw.length) {
      await tapTestId(d, sw[0], 10000);
      await owner(d, "requests switch");
      let card = false;
      for (let i = 0; i < 20 && !card; i++) card = await existsTestId(d, "DenyConsentButton", 1000);
      if (card) {
        await tapTestId(d, "DenyConsentButton", 5000);
        let left = true;
        for (let i = 0; i < 20 && left; i++) {
          await sleep(1000);
          left = await existsTestId(d, "DenyConsentButton", 500);
        }
        row("R3 decided on A", !left, left ? "the card stays" : "declined");
      } else row("R3 decided on A", false, "no card after switching");
    }
    await switchToOther(d, E.A_NAME); // the rule lives on A: turn it off there, never on B
    await myAgent(d);
    await tapTestId(d, "AgentSegment_manage", 8000).catch(() => undefined);
    await scrollToTestId(d, "AgentAskMeRow", 6).catch(() => undefined);
    await tapTestId(d, "AgentAskMeRow", 15000);
    await waitForTestId(d, "AskMeSwitch_contextsCreate", 30000);
    if ((await rowText(d, "AskMeSwitch_contextsCreate")) !== null && String(await (await d.$(`android=new UiSelector().resourceId("com.ariesbifold:id/AskMeSwitch_contextsCreate")`)).getAttribute("checked")) !== "true") log("R3: A's switch already reads off; not tapping");
    else {
      await tapTestId(d, "AskMeSwitch_contextsCreate", 10000);
      await owner(d, "rule off");
    }
    await sleep(3000);
    const rulesOff = pnm(E.A_SLUG, "approvals", "list").replace(/\s+/g, "");
    log(`R3: A's rules after "off": ${rulesOff.slice(0, 160)}`);
    row("R3 rule off", /"rules":\[\]/.test(rulesOff), rulesOff.slice(0, 100));
    await d.back().catch(() => undefined);
  }

  if (ROWS.includes("R6")) {
    t0.R6 = Date.now();
    // Both agents' identities join C; both memberships must survive (#289).
    const memberHere = async (who) => {
      await myAgent(d);
      const header = Boolean(await d.$('android=new UiSelector().textContains("Member of")').isExisting().catch(() => false));
      await scrollToTestId(d, `AgentCommunityStatus_${C_KEY}`, 4).catch(() => undefined);
      const card = await rowText(d, `AgentCommunityStatus_${C_KEY}`);
      const name = await homeName(d);
      await shot(d, `agents-r6-${who}`);
      log(`R6 ${who}: home "${name}" · header member ${header} · C card "${card}"`);
      return { ok: name.includes(who === "A" ? E.A_NAME : E.B_NAME) && /member/i.test(card ?? "") && !/turned down|removed/i.test(card ?? ""), card, header };
    };
    await switchToOther(d, E.A_NAME);
    // After R2, A is already a member of C (Join then has no JoinStart, 23:28:47Z): keep that membership.
    const a0 = await memberHere("A");
    if (a0.ok) {
      log(`R6: A is already a member of C (from R2): "${a0.card}"`);
    } else {
      const ra = await askToJoinC(d, "R6 on A");
      log(`R6: admin approves A: ${admin("join-decide", ra.id, "approved").trim().split("\n").filter((l) => /->/.test(l)).pop()}`);
      console.log(`R6_MEMBER ${ra.applicantDid}`);
      await sleep(5000);
    }
    await switchToOther(d, E.B_NAME);
    const rb = await askToJoinC(d, "R6 on B (B kept as the joining agent)");
    log(`R6: admin approves B: ${admin("join-decide", rb.id, "approved").trim().split("\n").filter((l) => /->/.test(l)).pop()}`);
    console.log(`R6_MEMBER ${rb.applicantDid}`);
    await sleep(8000);
    const b1 = await memberHere("B");
    await openSwitcher(d);
    const nRows = (await switcherRows(d)).length;
    await d.back().catch(() => undefined);
    row("R6 B member, both agents listed", b1.ok && nRows === 2, `B C card "${b1.card}"; switcher rows ${nRows}`);
    await switchToOther(d, E.A_NAME);
    const a1 = await memberHere("A");
    row("R6 A still member", a1.ok, `A C card "${a1.card}"`);
    // Kill and relaunch.
    await d.terminateApp(APP_ID).catch(() => undefined);
    await sleep(2000);
    await d.activateApp(APP_ID);
    await unlockToHome(d);
    const a2 = await memberHere("A");
    await switchToOther(d, E.B_NAME);
    const b2 = await memberHere("B");
    await tapTestId(d, "Wallet", 10000).catch(() => undefined);
    await sleep(3000);
    const texts = [];
    for (const el of await d.$$('//*[contains(@text,"Keyring Lab Community") or contains(@content-desc,"Keyring Lab Community")]')) {
      texts.push(String((await el.getAttribute("text").catch(() => "")) || (await el.getAttribute("content-desc").catch(() => ""))));
    }
    const cards = texts.length;
    await shot(d, "agents-r6-wallet");
    await dumpSource(d, "agents-r6-wallet").catch(() => undefined);
    // 7c4219d9: with several agents each Wallet community card names its agent ("… · <agent name>").
    const namesA = texts.some((t) => t.includes(`· ${E.A_NAME}`));
    const namesB = texts.some((t) => t.includes(`· ${E.B_NAME}`));
    log(`R6: after relaunch A ${a2.ok} ("${a2.card}") · B ${b2.ok} ("${b2.card}") · Wallet texts naming the community ${JSON.stringify(texts)}`);
    row("R6 after relaunch", a2.ok && b2.ok, `A "${a2.card}", B "${b2.card}"; Wallet mentions ${cards}`);
    row("R6 Wallet names each agent", namesA && namesB, `card for A ${namesA}, card for B ${namesB}; ${JSON.stringify(texts)}`);
  }

  if (ROWS.includes("R4")) {
    t0.R4 = Date.now();
    if (!(await homeName(d)).includes(E.A_NAME)) await switchToOther(d, E.A_NAME);
    await openSwitcher(d);
    let unl = await idsWithPrefix(d, "AgentSwitcherUnlink_");
    // 236 (#316): unlinking another agent moved to the gear's Agent settings screen.
    const onSettings = !unl.length && (await existsTestId(d, "AgentSettings", 3000));
    if (onSettings) {
      await tapTestId(d, "AgentSettings", 10000);
      await waitForTestId(d, "AgentSettingsScreen", 15000);
      await scrollToTestId(d, "AgentOthers", 6).catch(() => undefined);
      unl = await idsWithPrefix(d, "AgentSwitcherUnlink_");
    }
    if (!unl.length) await stop(d, "no unlink control for the other agent");
    await tapTestId(d, unl[0], 10000);
    await waitForTestId(d, "AgentUnlinkOtherCard", 15000);
    // On 236's Agent settings screen the confirm sits under the card, below the fold (rerun 13:58Z).
    await scrollToTestId(d, "AgentUnlinkOtherConfirm", 4).catch(() => undefined);
    await tapTestId(d, "AgentUnlinkOtherConfirm", 10000);
    await owner(d, "unlink B");
    await sleep(5000);
    const left = onSettings ? await idsWithPrefix(d, "AgentOtherRow_") : (await switcherRows(d)).filter((r) => !/Current/.test(r.desc));
    await d.back().catch(() => undefined);
    await myAgent(d);
    const name = await homeName(d);
    const bAcl = pnm(E.B_SLUG, "acl", "list");
    const phoneOnB = (process.env.B_PHONE && bAcl.includes(process.env.B_PHONE)) || false;
    log(`R4: others left ${left.length} · home "${name}" · B's ACL still has the phone: ${phoneOnB}`);
    row("R4 unlink B", left.length === 0 && name.includes(E.A_NAME) && !phoneOnB, `others ${left.length}; home "${name}"; on B's ACL ${phoneOnB}`);
    // Unlink lives under Manage: a segment in the old layout (01:18:17Z), the AgentSettings toggle in K6
    // (VtaAgentHome.tsx f0dd6e12, settingsOpen; 09:52:01Z). Open whichever this build has, once.
    if (await existsTestId(d, "AgentSegment_manage", 1500)) {
      await tapTestId(d, "AgentSegment_manage", 10000).catch(() => undefined);
    } else if (!(await existsTestId(d, "AgentUnlink", 1500))) {
      await scrollToTestId(d, "AgentSettings", 8).catch(() => undefined);
      await tapTestId(d, "AgentSettings", 10000).catch(() => undefined);
    }
    await sleep(1000);
    await scrollToTestId(d, "AgentUnlink", 8).catch(() => undefined);
    await tapTestId(d, "AgentUnlink", 10000);
    for (const id of ["AgentUnlinkConfirm", "UnlinkConfirm", "VtaUnlinkConfirm"]) if (await existsTestId(d, id, 3000)) await tapTestId(d, id, 5000);
    await owner(d, "unlink A");
    let linkOffered = false;
    for (const until = Date.now() + 30000; Date.now() < until && !linkOffered; await sleep(1000)) {
      // 238 (#339): the unlinked phone shows VtaLink's "Scan a link code" / "No code? Use your agent's address"
      // (VtaLinkByAddress), or Your agent's own "Link your agent" (AgentHomeLink).
      linkOffered = (await existsTestId(d, "VtaLinkByAddress", 500)) || (await existsTestId(d, "AgentHomeLink", 500)) || (await existsTestId(d, "LinkWithoutQrButton", 500)) || (await existsTestId(d, "LinkYourAgentButton", 500)) || (await existsTestId(d, "LinkByAddressButton", 500)) || (await existsTestId(d, "VtaLinkWithoutQr", 500)) || (await existsTestId(d, "VtaLinkAgentAddress", 500)) || Boolean(await d.$('android=new UiSelector().textContains("Link without a QR code")').isExisting().catch(() => false));
    }
    await shot(d, "agents-r4-unlinked");
    row("R4 unlink the last", linkOffered, linkOffered ? "the phone offers to link an agent" : "no link offer");
  }
} catch (err) {
  log(`error: ${err.message}`);
  if (d) await shot(d, "agents-failure");
  process.exitCode = 1;
} finally {
  // IN-114 (bifold #302): with several agents, the persona inbox signs in only with an identity under the
  // agent the phone acts with now. Before the fix it tried another agent's persona and logged "key not found".
  if (E.LOGCAT && ROWS.some((r) => ["R1", "R2", "R5", "R6"].includes(r))) {
    try {
      const lines = readFileSync(E.LOGCAT, "utf8").split("\n");
      const notFound = lines.filter((l) => /ReactNativeJS/.test(l) && /key not found/i.test(l));
      const signIns = lines.filter((l) => /\[VTI\] persona inbox .*signing in as the persona/.test(l));
      log(`IN-114: ${signIns.length} persona-inbox sign-ins; ${notFound.length} "key not found" line(s)`);
      for (const l of notFound.slice(0, 3)) log(`  ${l.slice(0, 200)}`);
      row("IN-114 no \"key not found\" with several agents", notFound.length === 0, `${notFound.length} "key not found" line(s) in ${signIns.length} persona-inbox sign-ins`);
    } catch (e) {
      log(`IN-114 log check skipped: ${String(e.message).slice(0, 100)}`);
    }
  }
  if (PIN) {
    try {
      adb("shell", "locksettings", "clear", "--old", PIN);
      log("device PIN cleared");
    } catch (e) {
      log(`device PIN NOT cleared: ${String(e.message).slice(0, 100)}`);
    }
  }
  for (const [n, ok, w] of results) console.log(`SUMMARY ${n} ${ok ? "PASS" : "FAIL"} — ${w}`);
  if (results.some(([, ok]) => !ok)) process.exitCode = process.exitCode || 3;
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
