/**
 * My Agents, one step per function: Your agent (VtaAgentHome.ids.ts), its
 * chips and switcher (AgentChips.tsx), an added agent's link (VtaLink.ids.ts
 * and the address path, VtaCreateAgent.ids.ts), the Keep card, Agent settings'
 * unlink (VtaAgentSettings.ids.ts) and the community cards on the home
 * (CommunityCard.tsx, handles from lib/testIdKeys.js). The model of
 * lib/keyringRoles.js: each step asserts the screen it ends on, returns a
 * record, throws a StepError with a screenshot and the page source, and never
 * waits without a deadline (see pages/step.js).
 *
 * The caller owns the session and the order. What the drivers did, moved
 * here as it was (run-several-agents.mjs, 239 gate): the flows and the
 * `[e2e] …` lines they print are unchanged.
 *
 * Every step takes (d, args, opts): `opts.clock` { now, wait } for the waits,
 * `opts.log` the shared step log, `opts.say` the driver's logger. `args.owner`
 * is the caller's answer to Android's device-credential prompt, `async (tag)
 * => boolean` (see `answerOwnerCheck`); with none the prompt is not answered.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { byTestId, dumpSource, existsTestId, scrollToTestId, tapTestId, waitForTestId } from "../driver.js";
import { pasteLinkOnScanScreen, passNewPhoneOfferIfShown, unlockIfLocked } from "../flows.js";
import { TEST_ID_PREFIX } from "../config.js";
import { awaitScreen, clockOf, elog, failWith, idsWithPrefix, rowText, runStep, said, shot, textOf } from "./step.js";

const PAGE = "agents";

/** The screens a step can end on, in the order they are told apart (a page can show two at once). */
export const AGENT_MARKERS = [
  "EnterPIN",
  "AgentSwitching",
  "AgentIntro",
  "AgentAddedCard",
  "AgentUnlinkOtherCard",
  "AgentSettingsScreen",
  "NewPhoneOffer",
  "AgentCreateReady",
  "AgentCreateError",
  "AgentCreateOwnerCode",
  "AgentCreateAddressInput",
  "VtaLinkDone",
  "VtaLinkError",
  "VtaLinkForOtherPhone",
  "VtaLinkAgentAddress",
  "PasteUrlButton",
  "VtaLinkByAddress",
  "AgentHome",
  "MyAgentLinkCard",
];

/** The doors an Add can open: the scanner, the address path, or the older link screen's entries. */
export const ADD_DOORS = ["PasteUrlButton", "AgentCreateAddressInput", "VtaLinkByAddress", "LinkByAddressButton", "VtaLinkAgentAddress", "VtaLinkWithoutQr"];

const step = (d, name, opts, fn) => runStep(d, PAGE, name, opts, AGENT_MARKERS, fn);
const sayOf = (opts) => opts?.say ?? elog;
const noOwner = async () => false;

/** The `adb` for this phone: the session's udid, else UDID. */
const adbOf = (d) => {
  const udid = d.e2eUdid || process.env.UDID;
  return (...a) => execFileSync("adb", udid ? ["-s", udid, ...a] : a, { encoding: "utf8", timeout: 30000 });
};

/**
 * Answer Android's device-credential prompt (AuthContainer, BiometricPrompt,
 * ConfirmDeviceCredential), only if one is on screen within 8 s: type the
 * PIN and Enter. Returns whether one was. `adb`, `wait` are for tests.
 */
export async function answerOwnerCheck(d, tag, { pin = "", adb = adbOf(d), say = elog, wait = clockOf().wait } = {}) {
  let win = "";
  for (let i = 0; i < 16 && !win; i++) {
    await wait(500);
    win = (adb("shell", "dumpsys", "window", "windows").match(/Window\{[^}]*(AuthContainer|BiometricPrompt|ConfirmDeviceCredential)[^}]*\}/i) || [""])[0];
  }
  if (!win) return false;
  say(`owner check (${tag}): ${win.slice(0, 60)}; typing the PIN`);
  adb("shell", "input", "text", pin);
  adb("shell", "input", "keyevent", "66");
  await wait(2500);
  return true;
}

// ---------------------------------------------------------------- readers (no step: they act on nothing)

/** Your agent's name in its header; "" when the home is not showing. The home can sit scrolled past its header. */
export async function readHomeName(d) {
  const now = await said(d, "AgentHomeName");
  if (now) return now;
  if (!(await existsTestId(d, "AgentHome", 500))) return "";
  await scrollToTestId(d, "AgentHomeName", 4, { direction: "up" }).catch(() => undefined);
  return (await said(d, "AgentHomeName")) ?? "";
}

/** The switcher's rows: AgentSwitcherRow_N, each content-desc "<agent name>, <status>". */
export async function readSwitcherRows(d) {
  const rows = [];
  const idAttr = d.e2ePlatform === "ios" ? "@name" : "@resource-id";
  for (const el of await d.$$(`//*[starts-with(${idAttr},"${TEST_ID_PREFIX}AgentSwitcherRow_")]`)) {
    const id = String(await el.getAttribute(d.e2ePlatform === "ios" ? "name" : "resource-id")).replace(TEST_ID_PREFIX, "");
    rows.push({ id, desc: String(await el.getAttribute(d.e2ePlatform === "ios" ? "label" : "content-desc").catch(() => "")) });
  }
  return rows;
}

/** The current row's words, and the rows that are not current. */
export const splitRows = (rows) => ({
  current: rows.find((r) => /Current/.test(r.desc))?.desc ?? "",
  others: rows.filter((r) => !/Current/.test(r.desc)),
});

/** A community card on Your agent, by handle: whether it shows, its status line, and whether it offers "Check now". */
export async function readCommunityCard(d, key) {
  await scrollToTestId(d, `AgentCommunityCard_${key}`, 6).catch(() => undefined);
  const card = await existsTestId(d, `AgentCommunityCard_${key}`, 1500);
  const status = await rowText(d, `AgentCommunityStatus_${key}`);
  const check = await existsTestId(d, `AgentCommunityCheck_${key}`, 800);
  return { card, status, check };
}

/** The "added" card's words, every text under it. */
async function readAddedCard(d) {
  const cardEl = await d.$(`android=new UiSelector().resourceId("${TEST_ID_PREFIX}AgentAddedCard")`);
  let card = "";
  if (await cardEl.isExisting().catch(() => false)) {
    for (const c of await cardEl.$$(".//*")) {
      const t = await c.getAttribute("text").catch(() => "");
      if (t) card += `${t} `;
    }
  }
  return card;
}

// ---------------------------------------------------------------- inner moves, shared by the steps

/** Into Your agent: the tab, the introduction skipped wherever it shows, the lock answered. */
async function toHome(d, say, clock = clockOf()) {
  await tapTestId(d, "MyAgent", 15000);
  await clock.wait(1500);
  for (let i = 0; i < 10 && !(await existsTestId(d, "AgentHome", 1000)); i++) {
    // An added agent's introduction comes when Your agent first shows it, which can be well after its link's Done
    // (238 gate: up at R1's switcher read, after a 15 s wait had passed): skip it wherever it shows.
    if (await existsTestId(d, "AgentIntroSkip", 500)) {
      say("an agent's introduction is up: Skip");
      await tapTestId(d, "AgentIntroSkip", 5000).catch(() => undefined);
      await clock.wait(1000);
      continue;
    }
    await unlockIfLocked(d);
  }
}

/** Skip or page through a new agent's introduction, if it is up within `appearMs`. Returns whether it was. */
async function skipIntro(d, appearMs) {
  if (!(await existsTestId(d, "AgentIntro", appearMs))) return false;
  if (await existsTestId(d, "AgentIntroSkip", 2000)) await tapTestId(d, "AgentIntroSkip", 5000);
  else for (let i = 0; i < 3; i++) if (await existsTestId(d, "AgentIntroNext", 2000)) await tapTestId(d, "AgentIntroNext", 5000);
  return true;
}

/** A switch takes ~20 s; builds with #281 4a77a9a2 show AgentSwitching meanwhile. Wait for it to end and the name to change (60 s). */
export async function awaitSwitched(d, wantName, say = elog, clock = clockOf()) {
  const t = clock.now();
  let sawSwitching = false;
  while (clock.now() - t < 60000) {
    const switching = await existsTestId(d, "AgentSwitching", 500);
    if (switching) sawSwitching = true;
    if (!switching && (await readHomeName(d)).includes(wantName)) break;
    await clock.wait(1000);
  }
  say(`switch wait: ${((clock.now() - t) / 1000).toFixed(1)} s · AgentSwitching seen ${sawSwitching}`);
}

/** The chips' Add, brought back into view first: after a switch the home can sit scrolled past the chip strip, and
 * Android leaves off-screen views out of the tree (239: R9 found no AgentSwitcherAdd). */
async function tapAdd(d, clock) {
  // Up only: scrollToTestId's default also tries the other way, which carried the strip off the top (239 final pin, R9).
  let el = (await existsTestId(d, "AgentSwitcherAdd", 2000)) ? byTestId(d, "AgentSwitcherAdd") : await scrollToTestId(d, "AgentSwitcherAdd", 3, { direction: "up", both: false }).catch(() => undefined);
  if (!el) await scrollToTestId(d, "AgentChips", 3, { direction: "up", both: false }).catch(() => undefined);
  // Add is the last item of the chips' horizontal strip: with two agents it can sit off to the right, out of the tree
  // (239: R9 after R8's switches). Swipe the strip leftwards until it shows.
  for (let i = 0; i < 4 && !el; i++) {
    const strip = byTestId(d, "AgentChips");
    if (!(await strip.isExisting().catch(() => false))) break;
    const { x, y } = await strip.getLocation();
    const { width, height } = await strip.getSize();
    const cy = Math.floor(y + height / 2);
    await d.action("pointer").move({ x: Math.floor(x + width * 0.85), y: cy }).down().pause(100).move({ x: Math.floor(x + width * 0.15), y: cy, duration: 400 }).up().perform();
    await clock.wait(800);
    if (await existsTestId(d, "AgentSwitcherAdd", 1500)) el = byTestId(d, "AgentSwitcherAdd");
  }
  if (!el) {
    await shot(d, "agents-add-missing");
    await dumpSource(d, "agents-add-missing").catch(() => undefined);
  }
  if (el) await el.click();
  else await tapTestId(d, "AgentSwitcherAdd", 15000);
}

/** The switcher's rows in view: chips (236, #316) are always shown; the older opener toggles a list. */
async function showSwitcher(d, say, clock) {
  await toHome(d, say, clock);
  if (!(await existsTestId(d, "AgentSwitcherOpen", 1500))) {
    await scrollToTestId(d, "AgentSwitcherRow_0", 4, { from: 0.35 }).catch(() => undefined);
    return;
  }
  await scrollToTestId(d, "AgentSwitcherOpen", 4).catch(() => undefined);
  // AgentSwitcherOpen toggles: tapping it while the list is open closes it (21:58:47Z miss).
  if ((await readSwitcherRows(d)).length) return;
  await tapTestId(d, "AgentSwitcherOpen", 15000);
  await clock.wait(1500);
}

/** The phone's key on VtaLink's scan branch: as text behind Show as text, else by Copy and the clipboard (237). */
export async function readScanKey(d, clock = clockOf()) {
  await waitForTestId(d, "VtaLinkForOtherPhone", 45000);
  let temp = "";
  if (await scrollToTestId(d, "VtaLinkShowAsText", 3).then((e) => e.click().then(() => true), () => false)) {
    await scrollToTestId(d, "VtaLinkManualDid", 3).catch(() => undefined);
    temp = (await textOf(d, "VtaLinkManualDid")).replace(/\s+/g, "").trim();
  } else {
    // 237's card offers only Copy: read the key from the clipboard.
    await tapTestId(d, "VtaLinkCopyKey", 15000);
    await clock.wait(1000);
    const text = Buffer.from(String(await d.getClipboard("plaintext").catch(() => "")), "base64").toString("utf8");
    temp = (text.match(/did:[a-z0-9]+:[A-Za-z0-9._:%-]+/) || [""])[0];
  }
  return temp;
}

/** VtaLink's scan branch, from its "for the other phone" card: the key, the grant, Done, Continue, the introduction. */
async function linkScanTo(d, { slug, grant, say, clock }) {
  const temp = await readScanKey(d, clock);
  say(`link to ${slug} (scan branch): the phone shows ${temp.slice(0, 30)}…; granting`);
  await grant(temp, slug);
  const by = clock.now() + 240000;
  while (clock.now() < by && !(await existsTestId(d, "VtaLinkDone", 2000))) {
    if (await existsTestId(d, "VtaLinkError", 500)) throw new Error(`the link failed: "${(await textOf(d, "VtaLinkError")).slice(0, 160)}"`);
    if (await existsTestId(d, "VtaLinkCheckAgain", 500)) await tapTestId(d, "VtaLinkCheckAgain", 5000).catch(() => undefined);
    await clock.wait(500);
  }
  await tapTestId(d, "VtaLinkContinue", 15000);
  await passNewPhoneOfferIfShown(d).catch(() => undefined);
  // The new agent's introduction can come several seconds after Done (238 gate: missed at 2 s, and the switcher
  // read behind it was empty): wait for it, then skip it.
  await skipIntro(d, 15000);
  return { temp, path: "scan" };
}

/** The address path (VtaCreateAgent, bifold #338/#339), from its address step: code, grant, Connect, Done. */
async function linkByAddressTo(d, { did, slug, grant, owner, say, clock }) {
  (await waitForTestId(d, "AgentCreateAddressInput", 15000)).setValue(did);
  await (await scrollToTestId(d, "AgentCreateAddressContinue", 4).catch(() => byTestId(d, "AgentCreateAddressContinue"))).click();
  const temp = await readOwnerCode(d);
  say(`link to ${slug} (address path): the phone shows ${temp.slice(0, 30)}…; granting`);
  await grant(temp, slug);
  await (await scrollToTestId(d, "AgentCreateConnect", 6).catch(() => byTestId(d, "AgentCreateConnect"))).click();
  await owner("connect").catch(() => undefined);
  const by = clock.now() + 240000;
  while (clock.now() < by && !(await existsTestId(d, "AgentCreateReady", 2000))) {
    if (await existsTestId(d, "AgentCreateError", 500)) throw new Error(`the address link failed: "${(await textOf(d, "AgentCreateError")).slice(0, 160)}"`);
    if (await existsTestId(d, "AgentCreateCheckAgain", 500)) await tapTestId(d, "AgentCreateCheckAgain", 5000).catch(() => undefined);
    await clock.wait(500);
  }
  await tapTestId(d, "AgentCreateDone", 15000);
  await clock.wait(2000);
  await shot(d, "add-done-2s");
  await passNewPhoneOfferIfShown(d).catch(() => undefined);
  // The new agent's introduction can come several seconds after Done (238 gate: missed at 2 s, and the switcher
  // read behind it was empty): wait for it, then skip it. 239 (#349): Done lands on Your agent, so it comes at once;
  // on 238 Done went back to the link panel and it came only once My Agent was opened. Recorded for R1's row.
  const doneLanding = { intro: await existsTestId(d, "AgentIntro", 15000), linkPanel: await existsTestId(d, "VtaLinkByAddress", 500) };
  say(`Done landed: introduction ${doneLanding.intro} · link panel ${doneLanding.linkPanel}`);
  if (doneLanding.intro) {
    if (await existsTestId(d, "AgentIntroSkip", 2000)) await tapTestId(d, "AgentIntroSkip", 5000);
    else for (let i = 0; i < 3; i++) if (await existsTestId(d, "AgentIntroNext", 2000)) await tapTestId(d, "AgentIntroNext", 5000);
  }
  return { temp, path: "address", doneLanding };
}

/** The older link screen's manual branch: the address typed, the code shown, the grant, Check, Done. */
async function linkManualTo(d, { did, slug, grant, say, clock }) {
  if (!(await existsTestId(d, "VtaLinkAgentAddress", 3000))) await tapTestId(d, "VtaLinkWithoutQr", 15000).catch(() => undefined);
  const address = await waitForTestId(d, "VtaLinkAgentAddress", 20000);
  await address.setValue(`${did}\n`);
  const by = clock.now() + 60000;
  const tapped = new Set();
  // The key renders below the fold, and Android leaves off-screen views out of the tree: scroll to it.
  const keyInView = async () => (await existsTestId(d, "VtaLinkManualDid", 1000)) || Boolean(await scrollToTestId(d, "VtaLinkManualDid", 3, { from: 0.5 }).catch(() => undefined));
  while (!(await keyInView()) && clock.now() < by) {
    for (const key of ["VtaLinkShowTheCode", "VtaLinkShowMyCode"]) {
      if (tapped.has(key)) continue;
      const t = await scrollToTestId(d, key, 3, { from: 0.5 }).catch(() => undefined);
      if (t) {
        await t.click().catch(() => undefined);
        tapped.add(key);
        break;
      }
    }
    await clock.wait(500);
  }
  await scrollToTestId(d, "VtaLinkManualDid", 4, { from: 0.5 }).catch(() => undefined);
  const temp = (await textOf(d, "VtaLinkManualDid")).trim();
  say(`link to ${slug}: the phone shows ${temp.slice(0, 30)}…; granting`);
  await grant(temp, slug);
  await tapTestId(d, "VtaLinkCheckGrant", 15000);
  await waitForTestId(d, "VtaLinkDone", 180000);
  await tapTestId(d, "VtaLinkContinue", 15000);
  await passNewPhoneOfferIfShown(d).catch(() => undefined);
  await skipIntro(d, 15000);
  return { temp, path: "manual" };
}

/** The address path's owner code (the phone's temporary key), shown if it is behind "Show the code". */
export async function readOwnerCode(d) {
  await waitForTestId(d, "AgentCreateOwnerCode", 60000);
  if (!(await existsTestId(d, "AgentCreateOwnerDid", 2000))) await (await scrollToTestId(d, "AgentCreateShowCode", 6)).click();
  await scrollToTestId(d, "AgentCreateOwnerDid", 4).catch(() => undefined);
  return (await textOf(d, "AgentCreateOwnerDid")).replace(/\s+/g, "").trim();
}

/** Switch by the row naming `wantName`, once; the home's name afterwards. */
async function tapSwitchRow(d, wantName, { owner, say, clock }) {
  await showSwitcher(d, say, clock);
  const rows = await readSwitcherRows(d);
  let target = rows.find((r) => r.desc.includes(wantName) && !/Current/.test(r.desc));
  if (!target) {
    // After a relaunch the other agent's row read "your agent" (23:40:54Z): record it, and take the one other row.
    const others = rows.filter((r) => !/Current/.test(r.desc));
    console.log(`FINDING switcher has no row naming ${wantName}: ${JSON.stringify(rows)}`);
    if (others.length === 1) target = others[0];
    else throw failWith(`no switcher row naming ${wantName} that is not current (rows ${JSON.stringify(rows)})`, { rows });
  }
  await tapTestId(d, target.id, 10000);
  await owner(`switch to ${wantName}`);
  await awaitSwitched(d, wantName, say, clock);
  await toHome(d, say, clock);
  return { target, now: await readHomeName(d) };
}

// ---------------------------------------------------------------- the steps

export const agents = {
  /** Into Your agent (the My Agent tab), past an introduction or the lock. Ends on AgentHome. Value: its name. */
  open(d, _args = {}, opts = {}) {
    return step(d, "open", opts, async () => {
      await toHome(d, sayOf(opts), clockOf(opts));
      await awaitScreen(d, "AgentHome", { page: PAGE, markers: AGENT_MARKERS, timeoutMs: 15000, clock: clockOf(opts) });
      return { value: { name: await readHomeName(d) } };
    });
  },

  /** The switcher's rows in view (chips, or the older list opened). Value: the rows, as `readSwitcherRows`. */
  openSwitcher(d, _args = {}, opts = {}) {
    return step(d, "openSwitcher", opts, async () => {
      await showSwitcher(d, sayOf(opts), clockOf(opts));
      await awaitScreen(d, "AgentHome", { page: PAGE, markers: AGENT_MARKERS, timeoutMs: 10000, clock: clockOf(opts) });
      return { value: await readSwitcherRows(d) };
    });
  },

  /**
   * The chips' Add, the owner check answered. Ends on one of the doors an Add
   * opens (ADD_DOORS): the scanner (237), the address path (#338/#339) or the
   * older link screen. Value: { door }.
   */
  add(d, { owner = noOwner, tag = "add agent" } = {}, opts = {}) {
    return step(d, "add", opts, async () => {
      await tapAdd(d, clockOf(opts));
      await owner(tag);
      const door = await awaitScreen(d, ADD_DOORS, { page: PAGE, markers: AGENT_MARKERS, timeoutMs: 15000, clock: clockOf(opts) });
      return { value: { door } };
    });
  },

  /**
   * From a door an Add opened, link `did` (the agent's bare address) by whichever
   * path this build offers: the scanner with the address pasted, the address
   * path, or the older link screen's manual branch. `grant(tempDid, slug)` puts
   * the phone's key on the agent (the caller's enrolment script); the step then
   * waits for the link to complete, passes the new-phone offer and skips the
   * introduction. Ends on Your agent. Value: { temp, path, doneLanding? }.
   */
  linkTo(d, { did, slug, grant, owner = noOwner } = {}, opts = {}) {
    return step(d, "linkTo", opts, async () => {
      if (!did || !slug || typeof grant !== "function") throw new Error("linkTo needs did, slug and grant(tempDid, slug)");
      const say = sayOf(opts);
      const clock = clockOf(opts);
      let value;
      // 237: Add can open the scanner: paste the agent's bare address, then VtaLink's scan branch.
      if (await existsTestId(d, "PasteUrlButton", 3000)) {
        await pasteLinkOnScanScreen(d, did);
        value = await linkScanTo(d, { slug, grant, say, clock });
      } else {
        // #338/#339: no "Link without a QR code" here, the address path instead (VtaCreateAgent).
        let byAddress = false;
        if (!(await existsTestId(d, "VtaLinkAgentAddress", 3000)) && !(await existsTestId(d, "VtaLinkWithoutQr", 1500))) {
          for (const entry of ["VtaLinkByAddress", "LinkByAddressButton"]) {
            if (await existsTestId(d, entry, 1500)) {
              await tapTestId(d, entry, 10000);
              break;
            }
          }
          byAddress = await existsTestId(d, "AgentCreateAddressInput", 15000);
        }
        value = byAddress ? await linkByAddressTo(d, { did, slug, grant, owner, say, clock }) : await linkManualTo(d, { did, slug, grant, say, clock });
      }
      await awaitScreen(d, ["AgentHome", "AgentAddedCard", "VtaLinkByAddress", "MyAgentLinkCard"], { page: PAGE, markers: AGENT_MARKERS, timeoutMs: 30000, clock });
      return { value };
    });
  },

  /**
   * "Switch to it" on a refused Add of an agent this phone already has (IN-132,
   * bifold #350): the switch, the owner check, waited out. Ends on Your agent.
   * Value: { home }.
   */
  switchToExisting(d, { name, owner = noOwner } = {}, opts = {}) {
    return step(d, "switchToExisting", opts, async () => {
      if (!name) throw new Error("switchToExisting needs the agent's name");
      const say = sayOf(opts);
      const clock = clockOf(opts);
      const btn = await scrollToTestId(d, "AgentCreateSwitchToExisting", 3).catch(() => undefined);
      if (!btn) throw failWith("no AgentCreateSwitchToExisting", {});
      await btn.click();
      await owner("switch to existing").catch(() => undefined);
      await awaitSwitched(d, name, say, clock).catch(() => undefined);
      await toHome(d, say, clock);
      await awaitScreen(d, "AgentHome", { page: PAGE, markers: AGENT_MARKERS, timeoutMs: 15000, clock });
      return { value: { home: await readHomeName(d) } };
    });
  },

  /**
   * The address path alone, up to its code: Add's "use your agent's address"
   * (if offered), the address, Continue. Ends on the owner code, or on the
   * screen's refusal (AgentCreateError: an agent this phone already has, #350).
   * Value: { said, code, switchToExisting }: the refusal's words, whether the
   * code step showed, whether "Switch to it" is offered.
   */
  enterAddress(d, { did, timeoutMs = 30000 } = {}, opts = {}) {
    return step(d, "enterAddress", opts, async () => {
      if (!did) throw new Error("enterAddress needs did");
      const clock = clockOf(opts);
      if (await existsTestId(d, "VtaLinkByAddress", 8000)) await tapTestId(d, "VtaLinkByAddress", 10000);
      (await waitForTestId(d, "AgentCreateAddressInput", 15000)).setValue(did);
      await (await scrollToTestId(d, "AgentCreateAddressContinue", 4).catch(() => byTestId(d, "AgentCreateAddressContinue"))).click();
      let words = "";
      let code = false;
      for (const until = clock.now() + timeoutMs; clock.now() < until && !words && !code; ) {
        if (await existsTestId(d, "AgentCreateError", 1000)) words = (await textOf(d, "AgentCreateError").catch(() => "")).replace(/\s+/g, " ").trim();
        else code = await existsTestId(d, "AgentCreateOwnerCode", 1000);
        await clock.wait(500);
      }
      const switchToExisting = Boolean(await scrollToTestId(d, "AgentCreateSwitchToExisting", 3).catch(() => undefined));
      await awaitScreen(d, ["AgentCreateOwnerCode", "AgentCreateError"], { page: PAGE, markers: AGENT_MARKERS, timeoutMs: 5000, clock });
      return { value: { said: words, code, switchToExisting } };
    });
  },

  /**
   * The address path's Connect, after the caller granted the owner code, and
   * what it ends on within `timeoutMs`: ready, or the screen's words for a
   * refusal or a held link (an approval rule holding the swap, 239). Check
   * again is pressed when offered. Ends on AgentCreateReady or AgentCreateError.
   * Value: { ready, said }.
   */
  connect(d, { owner = noOwner, timeoutMs = 240000 } = {}, opts = {}) {
    return step(d, "connect", opts, async () => {
      const clock = clockOf(opts);
      await (await scrollToTestId(d, "AgentCreateConnect", 6).catch(() => byTestId(d, "AgentCreateConnect"))).click();
      await owner("connect").catch(() => undefined);
      let words = "";
      let ready = false;
      for (const until = clock.now() + timeoutMs; clock.now() < until && !words && !ready; ) {
        if (await existsTestId(d, "AgentCreateError", 2000)) words = (await textOf(d, "AgentCreateError").catch(() => "")).replace(/\s+/g, " ").trim();
        else if (await existsTestId(d, "VtaLinkError", 500)) words = (await textOf(d, "VtaLinkError").catch(() => "")).replace(/\s+/g, " ").trim();
        else if (await existsTestId(d, "AgentCreateReady", 500)) ready = true;
        else if (await existsTestId(d, "AgentCreateCheckAgain", 500)) await tapTestId(d, "AgentCreateCheckAgain", 5000).catch(() => undefined);
        await clock.wait(500);
      }
      await awaitScreen(d, ["AgentCreateReady", "AgentCreateError", "VtaLinkError"], { page: PAGE, markers: AGENT_MARKERS, timeoutMs: 5000, clock });
      return { value: { ready, said: words } };
    });
  },

  /**
   * After an added agent's link: the "added" card on the new agent's home,
   * Keep (the first agent stays current), the owner check. A build without the
   * card goes on to the agent; said, not failed. Ends on Your agent.
   * Value: { card, keepShown, keepAtOnce }: the card's words, whether Keep
   * was there, and whether it was there without opening My Agent (#349, when
   * `introSeen`: Done landed on the home).
   */
  keepFirst(d, { owner = noOwner, introSeen = false } = {}, opts = {}) {
    return step(d, "keepFirst", opts, async () => {
      const say = sayOf(opts);
      const clock = clockOf(opts);
      // 237: the new agent's introduction can play first (1 of 3), then the "added" card: skip the one, wait for the other.
      for (const until = clock.now() + 60000; clock.now() < until; ) {
        if (await existsTestId(d, "AgentAddedCard", 1500)) break;
        if (await existsTestId(d, "AgentIntroSkip", 800)) await tapTestId(d, "AgentIntroSkip", 5000).catch(() => undefined);
        else if (await existsTestId(d, "AgentIntroNext", 500)) await tapTestId(d, "AgentIntroNext", 5000).catch(() => undefined);
        else if (await existsTestId(d, "AgentHome", 500)) break;
        await clock.wait(500);
      }
      // #349 (239): Done lands on Your agent, so after the introduction the Keep card is there without the tab.
      let keepAtOnce = false;
      if (introSeen) {
        for (const until = clock.now() + 15000; clock.now() < until && !keepAtOnce; ) {
          keepAtOnce = Boolean(await scrollToTestId(d, "AgentAddedKeep", 2, { from: 0.6 }).catch(() => undefined));
          if (!keepAtOnce) await clock.wait(1000);
        }
      }
      // 238: after Add's Done the app is not on Your agent; the new agent's introduction, and the "added" card behind
      // it, render when Your agent is opened. Open it (toHome skips the introduction), then look for Keep.
      await toHome(d, say, clock);
      for (const until = clock.now() + 30000; clock.now() < until; ) {
        if (await existsTestId(d, "AgentIntroSkip", 500)) {
          say("R1: the new agent's introduction is up: Skip");
          await tapTestId(d, "AgentIntroSkip", 5000).catch(() => undefined);
          await clock.wait(1500);
          continue;
        }
        if (await scrollToTestId(d, "AgentAddedKeep", 2, { from: 0.6 }).catch(() => undefined)) break;
        await clock.wait(1000);
      }
      const card = await readAddedCard(d);
      say(`R1: added card "${card?.slice(0, 160)}"`);
      const keep = (await existsTestId(d, "AgentAddedKeep", 3000)) ? byTestId(d, "AgentAddedKeep") : await scrollToTestId(d, "AgentAddedKeep", 3, { from: 0.6 }).catch(() => undefined);
      if (keep) {
        await keep.click();
        await owner("keep");
      } else say("R1: no AgentAddedKeep card after the link (the app went on to the agent)");
      await awaitScreen(d, "AgentHome", { page: PAGE, markers: AGENT_MARKERS, timeoutMs: 15000, clock });
      return { value: { card: card.trim(), keepShown: Boolean(keep), keepAtOnce } };
    });
  },

  /**
   * Switch to the agent named `name` by its switcher row, with the retries a
   * dropped row tap needs (one manual tap and a tab round trip, with the
   * MISS-* captures, 2026-10-05). Already there: nothing is tapped. Ends on
   * Your agent naming it. Value: { home, retried }.
   */
  switchTo(d, { name, owner = noOwner, adb } = {}, opts = {}) {
    return step(d, "switchTo", opts, async () => {
      if (!name) throw new Error("switchTo needs name");
      const say = sayOf(opts);
      const clock = clockOf(opts);
      await toHome(d, say, clock);
      if ((await readHomeName(d)).includes(name)) {
        say(`already on ${name}`);
        return { value: { home: await readHomeName(d), retried: false } };
      }
      let { target, now } = await tapSwitchRow(d, name, { owner, say, clock });
      let retried = false;
      if (!now.includes(name)) {
        // One retry: a tap on the switcher row can be dropped while the list animates (21:36:17Z).
        retried = true;
        say(`switch to ${name} did not take (home "${now}"); retrying once`);
        await shot(d, "agents-switch-retry");
        await dumpSource(d, "agents-switch-retry").catch(() => undefined);
        console.log(`SWITCH-MISS ${new Date().toISOString()}`);
        // At a missed row tap (seen on 2026-10-05 after R5's decline): the raw view tree (non-a11y overlays), the responder,
        // one manual tap at the row's centre, then a tab round trip and a tap again — does either reach onPress?
        const sh = adb ?? ((...a) => { try { return adbOf(d)(...a); } catch (e) { return `adb ${a.join(" ")} failed: ${e.message}`; } });
        const stamp = Date.now();
        // Uncompressed is uiautomator's default: the tree with non-accessibility views as well.
        console.log(`MISS-UIDUMP ${sh("shell", "uiautomator", "dump", "/sdcard/miss.xml").trim().slice(0, 160)}`);
        console.log(`MISS-UIDUMP-PULL ${sh("pull", "/sdcard/miss.xml", path.join("artifacts", `agents-miss-uidump-${stamp}.xml`)).trim().slice(0, 160)}`);
        const top = sh("shell", "dumpsys", "activity", "top").split("\n").filter((l) => /mResponder|ReactRootView|mFocused|ACTIVITY|mCurrentFocus/i.test(l)).slice(0, 16).join("\n");
        console.log(`MISS-TOP\n${top}`);
        const rowEl = await d.$(`android=new UiSelector().resourceId("${TEST_ID_PREFIX}${target.id}")`);
        if (await rowEl.isExisting().catch(() => false)) {
          const loc = await rowEl.getLocation();
          const size = await rowEl.getSize();
          const [x, y] = [Math.round(loc.x + size.width / 2), Math.round(loc.y + size.height / 2)];
          sh("shell", "input", "tap", String(x), String(y));
          console.log(`MISS-MANUAL-TAP ${new Date().toISOString()} at ${x},${y}`);
          await clock.wait(5000);
          now = await readHomeName(d);
          say(`after one manual adb tap: home "${now}"`);
        } else say("the row is no longer on screen for a manual tap");
        if (!now.includes(name)) {
          await tapTestId(d, "Contacts", 10000).catch(() => undefined);
          await clock.wait(1500);
          await toHome(d, say, clock);
          await showSwitcher(d, say, clock);
          const again2 = (await readSwitcherRows(d)).find((r) => r.desc.includes(name) && !/Current/.test(r.desc));
          if (again2) {
            await tapTestId(d, again2.id, 10000);
            console.log(`MISS-TAB-ROUNDTRIP-TAP ${new Date().toISOString()}`);
            await awaitSwitched(d, name, say, clock);
            await toHome(d, say, clock);
            now = await readHomeName(d);
            say(`after a tab round trip and a tap: home "${now}"`);
          }
        }
        if (now.includes(name)) {
          say(`switched: home now "${now}" (wanted ${name}), after the miss captures`);
          return { value: { home: now, retried } };
        }
        await showSwitcher(d, say, clock);
        const again = (await readSwitcherRows(d)).find((r) => r.desc.includes(name) && !/Current/.test(r.desc));
        if (again) {
          await tapTestId(d, again.id, 10000);
          await owner(`switch to ${name} (retry)`);
          await awaitSwitched(d, name, say, clock);
          await toHome(d, say, clock);
          now = await readHomeName(d);
        }
      }
      say(`switched: home now "${now}" (wanted ${name})`);
      if (!now.includes(name)) throw failWith(`the switch to ${name} did not take: home "${now}"`, { home: now });
      return { value: { home: now, retried } };
    });
  },

  /**
   * Unlink the other agent (the first AgentSwitcherUnlink_ control): from the
   * switcher, or on 236's Agent settings screen (#316), then its confirm and
   * the owner check. Ends on Your agent. Value: { onSettings, left }: where the
   * control was, and the other agents still listed afterwards.
   */
  unlinkOther(d, { owner = noOwner } = {}, opts = {}) {
    return step(d, "unlinkOther", opts, async () => {
      const say = sayOf(opts);
      const clock = clockOf(opts);
      await showSwitcher(d, say, clock);
      let unl = await idsWithPrefix(d, "AgentSwitcherUnlink_");
      // 236 (#316): unlinking another agent moved to the gear's Agent settings screen.
      const onSettings = !unl.length && (await existsTestId(d, "AgentSettings", 3000));
      if (onSettings) {
        await tapTestId(d, "AgentSettings", 10000);
        await waitForTestId(d, "AgentSettingsScreen", 15000);
        await scrollToTestId(d, "AgentOthers", 6).catch(() => undefined);
        unl = await idsWithPrefix(d, "AgentSwitcherUnlink_");
      }
      if (!unl.length) throw failWith("no unlink control for the other agent", { onSettings });
      await tapTestId(d, unl[0], 10000);
      await waitForTestId(d, "AgentUnlinkOtherCard", 15000);
      // On 236's Agent settings screen the confirm sits under the card, below the fold (rerun 13:58Z).
      await scrollToTestId(d, "AgentUnlinkOtherConfirm", 4).catch(() => undefined);
      await tapTestId(d, "AgentUnlinkOtherConfirm", 10000);
      await owner("unlink B");
      await clock.wait(5000);
      const left = onSettings ? await idsWithPrefix(d, "AgentOtherRow_") : (await readSwitcherRows(d)).filter((r) => !/Current/.test(r.desc));
      await d.back().catch(() => undefined);
      await toHome(d, say, clock);
      await awaitScreen(d, "AgentHome", { page: PAGE, markers: AGENT_MARKERS, timeoutMs: 15000, clock });
      return { value: { onSettings, left: left.length } };
    });
  },

  /**
   * Unlink this phone's last agent: Unlink under Manage (a segment on the old
   * layout, the AgentSettings gear on K6), its confirm, the owner check. Ends
   * where an unlinked phone offers to link one (238, #339: VtaLink's entries or
   * Your agent's own "Link your agent"). Value: { linkOffered }.
   */
  unlinkLast(d, { owner = noOwner } = {}, opts = {}) {
    return step(d, "unlinkLast", opts, async () => {
      const clock = clockOf(opts);
      if (await existsTestId(d, "AgentSegment_manage", 1500)) {
        await tapTestId(d, "AgentSegment_manage", 10000).catch(() => undefined);
      } else if (!(await existsTestId(d, "AgentUnlink", 1500))) {
        await scrollToTestId(d, "AgentSettings", 8).catch(() => undefined);
        await tapTestId(d, "AgentSettings", 10000).catch(() => undefined);
      }
      await clock.wait(1000);
      await scrollToTestId(d, "AgentUnlink", 8).catch(() => undefined);
      await tapTestId(d, "AgentUnlink", 10000);
      for (const id of ["AgentUnlinkConfirm", "UnlinkConfirm", "VtaUnlinkConfirm"]) if (await existsTestId(d, id, 3000)) await tapTestId(d, id, 5000);
      await owner("unlink A");
      let linkOffered = false;
      for (const until = clock.now() + 30000; clock.now() < until && !linkOffered; await clock.wait(1000)) {
        linkOffered =
          (await existsTestId(d, "VtaLinkByAddress", 500)) ||
          (await existsTestId(d, "AgentHomeLink", 500)) ||
          (await existsTestId(d, "LinkWithoutQrButton", 500)) ||
          (await existsTestId(d, "LinkYourAgentButton", 500)) ||
          (await existsTestId(d, "LinkByAddressButton", 500)) ||
          (await existsTestId(d, "VtaLinkWithoutQr", 500)) ||
          (await existsTestId(d, "VtaLinkAgentAddress", 500)) ||
          Boolean(await d.$('android=new UiSelector().textContains("Link without a QR code")').isExisting().catch(() => false));
      }
      return { value: { linkOffered } };
    });
  },

  /**
   * Open a community from its card on Your agent (AgentCommunityOpen_<key>,
   * or the one-row AgentMembershipRow). Ends on the community's screen
   * (ApplyToCommunityButton, CommunityName or its refusal). Value: { open }.
   */
  openCommunityCard(d, { key } = {}, opts = {}) {
    const markers = ["ApplyToCommunityButton", "CommunityName", "CommunityHeldElsewhere", "CommunityError", ...AGENT_MARKERS];
    return runStep(d, PAGE, "openCommunityCard", opts, markers, async () => {
      if (!key) throw new Error("openCommunityCard needs the card's key (lib/testIdKeys.js communityCardKey)");
      await tapTestId(d, "MyAgent", 10000).catch(() => undefined);
      const open = (await existsTestId(d, `AgentCommunityOpen_${key}`, 5000)) ? `AgentCommunityOpen_${key}` : (await existsTestId(d, "AgentMembershipRow", 1500)) ? "AgentMembershipRow" : "";
      if (!open) throw failWith(`no card for C on Your agent (AgentCommunityOpen_${key})`, { key });
      await tapTestId(d, open, 10000);
      await awaitScreen(d, ["ApplyToCommunityButton", "CommunityName", "CommunityHeldElsewhere", "CommunityError"], { page: PAGE, markers, timeoutMs: 15000, clock: clockOf(opts) });
      return { value: { open } };
    });
  },
};
