#!/usr/bin/env node
/**
 * My devices, driven as a person would (#10; keyring-bifold #174): on a phone
 * already linked to an agent, open My devices and read every row, rename this
 * phone, or remove another device. For the #10 lab check: two linked phones,
 * list on both, rename one and read it from the other, remove one from the
 * other, read the removed row.
 *
 *   PLATFORM=ios|android UDID=<sim udid or emulator serial> ACTION=list \
 *     [APPIUM_PORT=…] node run-devices-check.js
 *   ACTION=rename NAME="Sam's phone"          renames this phone
 *   ACTION=remove TARGET_DID=<the other DID>  removes that device (never this phone);
 *                 or TARGET_NAME=<its row name> / TARGET_KEY=<its row key> when the DID isn't to hand
 *   ACTION=erase                              on a REMOVED phone: its "no longer linked"
 *                                             screen, then Erase this phone's copy
 *   ACTION=rotate                             changes the keys of the identities this phone made (the
 *                                             lost-phone card); ROTATE_ALLOW_UNPUBLISHED=1 passes keys
 *                                             changed but not yet served (a DID host's cache: always
 *                                             on the lab, for a few minutes after a change)
 *
 * Drives the installed app as it is (never installs or resets). Each action
 * lists the rows after it. A line per row, then one `DEVICES_JSON {…}` line:
 * each row's key (deviceKey of its DID), name, about line (This phone ·
 * platform · last seen), state line, and whether it offers Remove / Rename.
 *
 * Remove asks for the owner: this gives the phone a screen lock first (a PIN
 * on Android, an enrolled face on the simulator) and answers the prompt as a
 * person would. Exit: 0 done, 1 failed.
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";

import { dumpSource, ensureAppium, existsTestId, screenshot, scrollToTestId, sleep, stopAppium, tapTestId, waitForTestId } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { unlockIfLocked } from "./lib/flows.js";
import { deviceKey } from "./lib/testIdKeys.js";
import { printFailure, printSuccess } from "./lib/banner.js";

const PLATFORM = process.env.PLATFORM || "ios";
const UDID = process.env.UDID;
const ACTION = process.env.ACTION || "list";
const OWNER_PIN = process.env.OWNER_PIN || "1111";
const ID = PLATFORM === "android" ? "@resource-id" : "@name";

if (!UDID) throw new Error("UDID is required: the simulator's udid or the emulator's serial");
if (!["list", "rename", "remove", "rotate", "erase"].includes(ACTION)) throw new Error(`ACTION must be list, rename, remove, rotate or erase, not ${ACTION}`);

const adb = (...args) => execFileSync("adb", ["-s", UDID, ...args], { encoding: "utf8" });

/** A lock the owner check can use (as run-own-agent.js gives the owner phone); returns an undo. */
function ownerLockSetup() {
  if (PLATFORM === "android") {
    adb("shell", "locksettings", "set-pin", OWNER_PIN);
    return () => {
      try {
        adb("shell", "locksettings", "clear", "--old", OWNER_PIN);
      } catch (e) {
        console.log(`[lock] could not clear the emulator PIN: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
    };
  }
  execFileSync("xcrun", ["simctl", "spawn", UDID, "notifyutil", "-s", "com.apple.BiometricKit.enrollmentChanged", "1"]);
  execFileSync("xcrun", ["simctl", "spawn", UDID, "notifyutil", "-p", "com.apple.BiometricKit.enrollmentChanged"]);
  return () => undefined;
}

/** Answer the owner prompt as a person would: the PIN typed, a face matched. */
async function answerOwnerPrompt(ms = 20000) {
  for (const until = Date.now() + ms; Date.now() < until; await sleep(1000)) {
    if (PLATFORM === "android") {
      const focus = adb("shell", "dumpsys", "window").split("\n").find((l) => l.includes("mCurrentFocus")) || "";
      if (/systemui|ConfirmDeviceCredential|BiometricPrompt|settings\/.*Confirm/i.test(focus)) {
        await sleep(800);
        adb("shell", "input", "text", OWNER_PIN);
        adb("shell", "input", "keyevent", "66");
        console.log("[lock] answered the owner prompt with the PIN");
        return;
      }
    } else {
      execFileSync("xcrun", ["simctl", "spawn", UDID, "notifyutil", "-p", "com.apple.BiometricKit_Sim.pearl.match"]);
    }
  }
}

const inside = (r, p) => {
  const cx = p.x + p.width / 2;
  const cy = p.y + p.height / 2;
  return cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height;
};
const unescape = (v) => v.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, "\n").replace(/&amp;/g, "&");

/**
 * Every element of one page source, with its id, words and rectangle. One
 * source read, not a call per element: a runner agent lists dozens of
 * devices, and reading them one by one took minutes, long enough for the app
 * to lock itself mid-read (the #10 lab check, 04:35Z).
 */
function elementsOf(source) {
  const out = [];
  for (const m of source.matchAll(/<([A-Za-z.]+)\s([^>]*?)\/?>/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = unescape(a[2]);
    let r;
    if (attrs.bounds) {
      const b = attrs.bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
      if (b) r = { x: +b[1], y: +b[2], width: b[3] - b[1], height: b[4] - b[2] };
    } else if (attrs.x !== undefined) {
      r = { x: +attrs.x, y: +attrs.y, width: +attrs.width, height: +attrs.height };
    }
    if (!r) continue;
    const id = (PLATFORM === "android" ? attrs["resource-id"] : attrs.name) || "";
    const words = (PLATFORM === "android" ? attrs.text : attrs.label) || "";
    const isText = PLATFORM === "android" ? m[1].endsWith("TextView") : m[1] === "XCUIElementTypeStaticText";
    out.push({ id: id.replace(/^.*?:id\//, ""), words, isText, r });
  }
  return out;
}

/**
 * Every row as it reads. Android flattens a row (its texts are siblings of the
 * row view, inside its bounds), so texts and buttons are matched to rows by
 * geometry, on both platforms alike.
 */
async function readRows(d) {
  const els = elementsOf(await d.getPageSource());
  const rows = els
    .filter((e) => e.id.startsWith("AgentDevice_"))
    .map((e) => ({ key: e.id.replace("AgentDevice_", ""), r: e.r, texts: [], remove: false, rename: false, state: undefined }));
  for (const e of els) {
    if (e.id.startsWith("AgentDeviceRemove_")) {
      const row = rows.find((x) => inside(x.r, e.r));
      if (row) row.remove = true;
    } else if (e.id === "AgentDeviceRename") {
      const row = rows.find((x) => inside(x.r, e.r));
      if (row) row.rename = true;
    } else if (e.id.startsWith("AgentDeviceState_")) {
      const row = rows.find((x) => x.key === e.id.replace("AgentDeviceState_", ""));
      if (row && e.words) row.state = e.words;
    } else if (e.isText && e.words.trim()) {
      const row = rows.find((x) => inside(x.r, e.r));
      if (row && !row.texts.includes(e.words)) row.texts.push(e.words);
    }
  }
  return rows.map(({ key, texts, remove, rename, state }) => {
    // The row's first text is its name; the about line holds "·" or "This phone".
    const [name, ...rest] = texts.filter((t) => t !== state && t !== "Details" && !/^(Remove|Remove this phone|Rename)$/.test(t));
    const about = rest.find((t) => /·|This phone|Seen|Last seen/.test(t));
    return { key, name, about, state, remove, rename };
  });
}

/** The app locks itself after a while untouched: unlock it and come back to My devices. */
async function stayUnlocked(d) {
  if (!(await existsTestId(d, "EnterPIN", 500))) return;
  console.log("[devices] the app locked itself — unlocking");
  await unlockIfLocked(d);
  await waitForTestId(d, "AgentDeviceList", 30000);
}

async function openDevices(d) {
  await unlockToHome(d);
  if (!(await existsTestId(d, "AgentDeviceList", 1500))) {
    await tapTestId(d, "MyAgent", 15000).catch(() => undefined);
    if (!(await existsTestId(d, "AgentDevices", 5000))) await scrollToTestId(d, "AgentDevices", 4);
    await tapTestId(d, "AgentDevices", 15000);
  }
  await waitForTestId(d, "AgentDeviceList", 30000);
  // The list comes from the agent: wait for a row, or its refusal in words.
  for (const until = Date.now() + 60000; ; await sleep(1000)) {
    if (await existsTestId(d, "AgentDeviceError", 300)) throw new Error(`My devices: ${await textOf(d, "AgentDeviceError")}`);
    if ((await d.$$(`//*[starts-with(${ID},"com.ariesbifold:id/AgentDevice_")]`)).length > 0) break;
    if (Date.now() > until) throw new Error("My devices showed no row within 60 s");
  }
}

async function report(d, label) {
  await stayUnlocked(d);
  const rows = await readRows(d);
  const sibling = await existsTestId(d, "SiblingNotice", 500);
  console.log(`[devices] ${label}: "also open as you" notice ${sibling ? "SHOWN" : "not shown"}`);
  for (const r of rows) {
    console.log(`[devices] ${label} ${r.key}: "${r.name}" · about="${r.about ?? ""}" · state="${r.state ?? ""}" · remove=${r.remove} rename=${r.rename}`);
  }
  console.log(`DEVICES_JSON ${JSON.stringify({ platform: PLATFORM, udid: UDID, action: ACTION, label, rows })}`);
  await screenshot(d, `devices-${ACTION}-${label}-${PLATFORM}`);
  return rows;
}

let driver;
let undoLock;
const t0 = Date.now();
const lap = (what) => console.log(`[devices] ${what}: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
try {
  await ensureAppium();
  driver = await makeDriver({ platform: PLATFORM, udid: UDID, keepState: true });
  if (ACTION === "erase") {
    // A removed phone: its next call to the agent is refused, and My Agent
    // says it is no longer linked, with Erase and Link again of equal weight.
    await unlockToHome(driver);
    await tapTestId(driver, "MyAgent", 15000).catch(() => undefined);
    for (const until = Date.now() + 120000; !(await existsTestId(driver, "VtaLinkErase", 2000)); ) {
      if (await existsTestId(driver, "AgentDevices", 500)) {
        await tapTestId(driver, "AgentDevices", 5000).catch(() => undefined);
        await sleep(3000);
        await tapTestId(driver, "MyAgent", 5000).catch(() => undefined);
      }
      if (Date.now() > until) throw new Error("the removed phone never showed its no-longer-linked screen within 120 s");
    }
    console.log(`[devices] removed phone: "${await textOf(driver, "VtaLinkError")}"`);
    const both = (await existsTestId(driver, "VtaLinkErase", 500)) && (await existsTestId(driver, "VtaLinkScanAgain", 500));
    if (!both) throw new Error("the removed phone must offer Erase and Link again");
    await screenshot(driver, `devices-removed-${PLATFORM}`);
    lap("removed screen");
    await tapTestId(driver, "VtaLinkErase", 15000);
    console.log(`[devices] erase explains: "${await textOf(driver, "VtaLinkEraseWhat")}"`);
    await tapTestId(driver, "VtaLinkEraseConfirm", 15000);
    await waitForTestId(driver, "VtaLinkErased", 60000);
    console.log(`[devices] erased: "${await textOf(driver, "VtaLinkErased")}"`);
    await screenshot(driver, `devices-erased-${PLATFORM}`);
    lap("erase");
    printSuccess("MY DEVICES — erase");
    process.exitCode = 0;
  } else {
  await openDevices(driver);
  lap("open My devices");
  const before = await report(driver, "before");
  if (!before.some((r) => r.rename)) throw new Error('no row is "This phone" (no Rename on any row)');
  if (before.some((r) => r.rename && r.remove)) throw new Error("this phone's row offers Remove");

  if (ACTION === "rename") {
    const name = process.env.NAME;
    if (!name) throw new Error("ACTION=rename needs NAME");
    await stayUnlocked(driver);
    await tapTestId(driver, "AgentDeviceRename", 15000);
    const input = await waitForTestId(driver, "DeviceNameInput", 15000);
    await input.clearValue();
    await input.setValue(name);
    await tapTestId(driver, "DeviceNameSave", 15000);
    for (const until = Date.now() + 60000; await existsTestId(driver, "DeviceNameInput", 500); await sleep(1000)) {
      if (await existsTestId(driver, "AgentDeviceError", 300)) throw new Error(`rename refused: ${await textOf(driver, "AgentDeviceError")}`);
      if (Date.now() > until) throw new Error("the name prompt stayed open 60 s after Save");
    }
    lap("rename");
    // The prompt closes before the list is read again from the agent (about
    // 2 s): wait for this phone's row to carry the new name, not the first frame.
    let mine;
    for (const until = Date.now() + 30000; ; await sleep(1500)) {
      mine = (await readRows(driver)).find((r) => r.rename);
      if (mine?.name === name.trim() || Date.now() > until) break;
    }
    await report(driver, "after");
    if (mine?.name !== name.trim()) throw new Error(`this phone reads "${mine?.name}", not "${name.trim()}", 30 s after Save`);
  }

  if (ACTION === "remove") {
    const did = process.env.TARGET_DID;
    const byName = process.env.TARGET_NAME;
    if (!did && !byName && !process.env.TARGET_KEY) throw new Error("ACTION=remove needs TARGET_DID, TARGET_NAME or TARGET_KEY");
    let key = process.env.TARGET_KEY || (did ? deviceKey(did) : before.find((r) => r.name === byName && !r.rename)?.key);
    if (!key && byName) {
      await scrollToTestId(driver, "LostPhone", 40).catch(() => undefined);
      key = (await readRows(driver)).find((r) => r.name === byName && !r.rename)?.key;
    }
    if (!key) throw new Error(`no other device named "${byName}"`);
    let row = before.find((r) => r.key === key);
    if (!row) {
      // Android's page source holds only what is on screen: bring the row in.
      await scrollToTestId(driver, `AgentDevice_${key}`, 40).catch(() => undefined);
      row = (await readRows(driver)).find((r) => r.key === key);
    }
    if (!row) throw new Error(`no row for ${did ?? byName ?? key} (key ${key})`);
    if (row.rename) throw new Error("TARGET_DID is this phone: it is never removed here");
    if (!row.remove) throw new Error(`the row for ${did} offers no Remove`);
    undoLock = ownerLockSetup();
    await stayUnlocked(driver);
    // Until it is on screen, not merely present: iOS's source holds rows off
    // screen too, so "exists" said yes to a row 8 screens down (#10 re-run).
    // scrollToTestId returns at once when the button is already displayed.
    await scrollToTestId(driver, `AgentDeviceRemove_${key}`, 40);
    await tapTestId(driver, `AgentDeviceRemove_${key}`, 15000);
    await answerOwnerPrompt();
    for (const until = Date.now() + 90000; ; await sleep(1000)) {
      if (await existsTestId(driver, "AgentDeviceRemoved", 500)) break;
      if (await existsTestId(driver, "AgentDeviceError", 300)) throw new Error(`removal refused: ${await textOf(driver, "AgentDeviceError")}`);
      if (Date.now() > until) throw new Error("no AgentDeviceRemoved within 90 s");
    }
    console.log(`[devices] removed: "${await textOf(driver, "AgentDeviceRemoved")}"`);
    lap("remove");
    const after = await report(driver, "after");
    const gone = after.find((r) => r.key === key);
    console.log(
      gone
        ? `[devices] the removed device stays listed: state="${gone.state ?? ""}", remove=${gone.remove}`
        : "[devices] the removed device is no longer listed (revoked, never registered)"
    );
    if (gone && (!gone.state || gone.remove)) throw new Error("a removed device still listed must say so, and offer no Remove");
  }

  if (ACTION === "rotate") {
    // The lost-phone card, under the list: offered only when the agent keeps
    // key ids through a change; one owner check covers every identity.
    await stayUnlocked(driver);
    await scrollToTestId(driver, "LostPhone", 40);
    if (!(await existsTestId(driver, "LostPhoneRotate", 3000))) {
      const said = await textOf(driver, "LostPhoneState").catch(() => "");
      throw new Error(`the lost-phone card offers no key change: "${said}"`);
    }
    undoLock = ownerLockSetup();
    await scrollToTestId(driver, "LostPhoneRotate", 6);
    await tapTestId(driver, "LostPhoneRotate", 15000);
    await answerOwnerPrompt();
    let said = "";
    for (const until = Date.now() + 180000; ; await sleep(1500)) {
      said = await textOf(driver, "LostPhoneState").catch(() => "");
      const busy = await existsTestId(driver, "LostPhoneRotate", 300).then(async (b) => b && !(await textOf(driver, "LostPhoneRotate").catch(() => "")).match(/Change my/i));
      if (said && !busy) break;
      if (Date.now() > until) throw new Error("the key change never finished within 180 s");
    }
    console.log(`[devices] lost-phone card: "${said}"`);
    lap("rotate");
    await screenshot(driver, `devices-rotate-${PLATFORM}`);
    if (/new keys are saved|nouvelles clés sont enregistrées|novas chaves estão salvas/i.test(said)) {
      // Changed on the agent; DID hosts serve cached documents for a few
      // minutes, so the card says so calmly (lab: 300 s cache). Reported as
      // its own outcome; it passes only when ROTATE_ALLOW_UNPUBLISHED=1 says a
      // cached host is expected, which on the lab it always is.
      console.log("[devices] ROTATED, NOT YET SEEN BY EVERYONE — the agent changed the keys; the DID host still serves the cached document");
      if (process.env.ROTATE_ALLOW_UNPUBLISHED !== "1") throw new Error(`the new keys are not served yet: "${said}"`);
    } else if (!/^Done\./.test(said)) {
      throw new Error(`the key change did not finish for every identity: "${said}"`);
    }
  }

  lap("done");
  printSuccess(`MY DEVICES — ${ACTION}`);
  process.exitCode = 0;
  }
} catch (err) {
  process.exitCode = 1;
  console.error(err);
  if (driver) {
    await screenshot(driver, `devices-fail-${ACTION}-${PLATFORM}`).catch(() => undefined);
    await dumpSource(driver, `devices-fail-${ACTION}-${PLATFORM}`).catch(() => undefined);
  }
  printFailure(`MY DEVICES — ${ACTION}`, err);
} finally {
  undoLock?.();
  await driver?.deleteSession().catch(() => undefined);
  stopAppium();
}
