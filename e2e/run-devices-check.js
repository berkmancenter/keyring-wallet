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
 *   ACTION=remove TARGET_DID=<the other DID>  removes that device (never this phone)
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
import { deviceKey } from "./lib/testIdKeys.js";
import { printFailure, printSuccess } from "./lib/banner.js";

const PLATFORM = process.env.PLATFORM || "ios";
const UDID = process.env.UDID;
const ACTION = process.env.ACTION || "list";
const OWNER_PIN = process.env.OWNER_PIN || "1111";
const ID = PLATFORM === "android" ? "@resource-id" : "@name";
const TEXT = PLATFORM === "android" ? "//android.widget.TextView" : "//XCUIElementTypeStaticText";
const TEXT_OF = PLATFORM === "android" ? "text" : "label";

if (!UDID) throw new Error("UDID is required: the simulator's udid or the emulator's serial");
if (!["list", "rename", "remove"].includes(ACTION)) throw new Error(`ACTION must be list, rename or remove, not ${ACTION}`);

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

const rectOf = async (el) => ({ ...(await el.getLocation()), ...(await el.getSize()) });
const inside = (r, p) => {
  const cx = p.x + p.width / 2;
  const cy = p.y + p.height / 2;
  return cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height;
};
const idOf = async (el) => String(await el.getAttribute(PLATFORM === "android" ? "resource-id" : "name")).replace(/^.*?:id\//, "");

/**
 * Every row as it reads. Android flattens a row (its texts are siblings of the
 * row view, inside its bounds), so texts and buttons are matched to rows by
 * geometry, on both platforms alike.
 */
async function readRows(d) {
  const rows = [];
  for (const el of await d.$$(`//*[starts-with(${ID},"com.ariesbifold:id/AgentDevice_")]`)) {
    rows.push({ key: (await idOf(el)).replace("AgentDevice_", ""), r: await rectOf(el), texts: [], remove: false, rename: false, state: undefined });
  }
  for (const t of await d.$$(TEXT)) {
    const words = (await t.getAttribute(TEXT_OF)) || "";
    if (!words.trim()) continue;
    const r = await rectOf(t);
    const row = rows.find((x) => inside(x.r, r));
    if (row && !row.texts.includes(words)) row.texts.push(words);
  }
  for (const b of await d.$$(`//*[starts-with(${ID},"com.ariesbifold:id/AgentDeviceRemove_")]`)) {
    const r = await rectOf(b);
    const row = rows.find((x) => inside(x.r, r));
    if (row) row.remove = true;
  }
  for (const b of await d.$$(`//*[starts-with(${ID},"com.ariesbifold:id/AgentDeviceState_")]`)) {
    const key = (await idOf(b)).replace("AgentDeviceState_", "");
    const row = rows.find((x) => x.key === key);
    if (row) row.state = (await b.getAttribute(TEXT_OF)) || (await textOf(d, `AgentDeviceState_${key}`).catch(() => ""));
  }
  const rename = await d.$(`//*[${ID}="com.ariesbifold:id/AgentDeviceRename"]`);
  if (await rename.isExisting()) {
    const r = await rectOf(rename);
    const row = rows.find((x) => inside(x.r, r));
    if (row) row.rename = true;
  }
  return rows.map(({ key, texts, remove, rename, state }) => {
    // The row's first text is its name; the about line holds "·" or "This phone".
    const [name, ...rest] = texts.filter((t) => t !== state && t !== "Details" && !/^(Remove|Remove this phone|Rename)$/.test(t));
    const about = rest.find((t) => /·|This phone|Seen|Last seen/.test(t));
    return { key, name, about, state, remove, rename };
  });
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
  const rows = await readRows(d);
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
  await openDevices(driver);
  lap("open My devices");
  const before = await report(driver, "before");
  if (!before.some((r) => r.rename)) throw new Error('no row is "This phone" (no Rename on any row)');
  if (before.some((r) => r.rename && r.remove)) throw new Error("this phone's row offers Remove");

  if (ACTION === "rename") {
    const name = process.env.NAME;
    if (!name) throw new Error("ACTION=rename needs NAME");
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
    const after = await report(driver, "after");
    const mine = after.find((r) => r.rename);
    if (mine?.name !== name.trim()) throw new Error(`this phone reads "${mine?.name}", not "${name.trim()}"`);
  }

  if (ACTION === "remove") {
    const did = process.env.TARGET_DID;
    if (!did) throw new Error("ACTION=remove needs TARGET_DID");
    const key = deviceKey(did);
    const row = before.find((r) => r.key === key);
    if (!row) throw new Error(`no row for ${did} (key ${key})`);
    if (row.rename) throw new Error("TARGET_DID is this phone: it is never removed here");
    if (!row.remove) throw new Error(`the row for ${did} offers no Remove`);
    undoLock = ownerLockSetup();
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

  lap("done");
  printSuccess(`MY DEVICES — ${ACTION}`);
  process.exitCode = 0;
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
