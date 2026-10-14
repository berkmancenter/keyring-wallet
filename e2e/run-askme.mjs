#!/usr/bin/env node
/**
 * bifold #285 (approval rules on the phone) on a built app, Android: My Agent → Manage →
 * "Ask me before…" → switch on contexts/create (owner check first) → "Send me a test
 * request" → the request shows as a notification and in Requests → Decline clears it →
 * switch the rule off. The runner's own rules are read before, during and after.
 *
 * Rows through lib/rows.js, each as soon as it is known: "no lock: refusal shown" (DEVICE_PIN), "switch on (owner
 * check)", "test request held" (needs the switch), "notification + Requests" (needs the request), "approve clears
 * it" / "decline clears it" (needs the card), "switch off". Exit 0 all pass or skipped, 3 any fail, 1 the run broke.
 *
 *   E2E_APP_ID=<pkg> UDID=emulator-5572 RUNNER_VTA=<slug> PNM_BIN=<pnm> node run-askme.mjs
 */
import "./lib/cli-guard.js";
import { execFileSync } from "node:child_process";
import { dumpSource, ensureAppium, existsTestId, screenshot as rawScreenshot, scrollToTestId, sleep, stopAppium, tapTestId } from "./lib/driver.js";
import { makeDriver, textOf, unlockToHome } from "./lib/keyringRoles.js";
import { handleBiometricConfirmIfPresent, unlockIfLocked } from "./lib/flows.js";
import { APP_ID } from "./lib/config.js";
import { createRows } from "./lib/rows.js";

const { UDID, RUNNER_VTA, PNM_BIN } = process.env;
const TASK = "https://trusttasks.org/spec/vta/contexts/create/1.0";
const utc = () => new Date().toISOString().slice(11, 23) + "Z";
const log = (s) => console.log(`[e2e] ${utc()} ${s}`);
const rows = createRows({ label: "askme" });
const SWITCH_ON = "switch on (owner check)";
const HELD = "test request held";
const CARD = "notification + Requests";
const row = (name, ok, what, opts) => rows.row(name, () => ({ ok, detail: what }), opts);
const txt = async (d, id) => ((await existsTestId(d, id, 800)) ? (await textOf(d, id).catch(() => "")).replace(/\s+/g, " ").trim() : null);
const rules = () => {
  try {
    const out = execFileSync(PNM_BIN, ["--vta", RUNNER_VTA, "approvals", "list"], { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
    const j = JSON.parse(out.slice(out.indexOf("{")));
    return { rules: (j.rules ?? []).map((r) => r.taskType ?? r.task ?? JSON.stringify(r).slice(0, 80)), sets: Object.keys(j.approverSets ?? {}) };
  } catch (e) {
    return { error: String(e.message).slice(0, 120) };
  }
};
const adb = (...a) => execFileSync("adb", ["-s", UDID, ...a], { encoding: "utf8" });
const switchState = async (d) => {
  const el = d.$(`android=new UiSelector().resourceId("com.ariesbifold:id/AskMeSwitch_contextsCreate")`);
  if (!(await el.isExisting().catch(() => false))) return "absent";
  return String(await el.getAttribute("checked").catch(() => "?"));
};

/** Tap the Switch itself: an element click on a React Native Switch can miss it. Falls back to its centre by coordinates. */
async function flipSwitch(d, want) {
  await tapTestId(d, "AskMeSwitch_contextsCreate", 10000);
  await sleep(3000);
  if ((await switchState(d)) === String(want) || (await existsTestId(d, "AskMeError", 300))) return "element tap";
  const el = d.$(`android=new UiSelector().resourceId("com.ariesbifold:id/AskMeSwitch_contextsCreate")`);
  const loc = await el.getLocation();
  const size = await el.getSize();
  const r = { x: loc.x, y: loc.y, width: size.width, height: size.height };
  const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
  await d.performActions([{ type: "pointer", id: "f", parameters: { pointerType: "touch" }, actions: [{ type: "pointerMove", duration: 0, x, y }, { type: "pointerDown", button: 0 }, { type: "pause", duration: 120 }, { type: "pointerUp", button: 0 }] }]);
  await d.releaseActions().catch(() => undefined);
  await sleep(1500);
  await screenshot(d, `askme-after-coordinate-tap-${want ? "on" : "off"}`);
  return `coordinate tap at ${x},${y} (rect ${JSON.stringify(r)})`;
}

const screenshot = (d, n) => rawScreenshot(d, n).catch((e) => log(`screenshot ${n} not taken: ${String(e.message).slice(0, 80)}`));
const PIN_DEV = process.env.DEVICE_PIN || "";
/** Answer Android's device-credential prompt (the owner check) with the device PIN. */
async function answerCredential(d, tag) {
  // Wait for a system auth window (BiometricPrompt / AuthContainer / device-credential); type the
  // PIN only into one: with just the app on screen, Enter presses the focused row (17:15:36Z).
  let win = "";
  for (let i = 0; i < 16 && !win; i++) {
    await sleep(500);
    const ws = adb("shell", "dumpsys", "window", "windows");
    win = (ws.match(/Window\{[^}]*(AuthContainer|BiometricPrompt|ConfirmDeviceCredential|CredentialView|biometric)[^}]*\}/i) || [""])[0];
  }
  const focus = adb("shell", "dumpsys", "window").split("\n").find((l) => /mCurrentFocus/.test(l)) ?? "";
  await screenshot(d, `askme-credential-${tag}`);
  const titles = [...new Set((adb("shell", "dumpsys", "window", "windows").match(/Window\{[0-9a-f]+ u0 [^}]+\}/g) || []).map((w) => w.replace(/Window\{[0-9a-f]+ u0 /, "").replace("}", "")))];
  log(`windows (${tag}): ${titles.join(" | ").slice(0, 400)}`);
  if (!win) {
    log(`credential prompt (${tag}): none shown in 8 s (focus ${focus.trim().slice(0, 120)}); nothing typed`);
    return false;
  }
  log(`credential prompt (${tag}): ${win.slice(0, 140)} · focus ${focus.trim().slice(0, 100)}; typing the PIN`);
  adb("shell", "input", "text", PIN_DEV);
  adb("shell", "input", "keyevent", "66");
  await sleep(2500);
  return true;
}

/** Manage: a segment in the older agent home, the AgentSettings toggle in K6 (bifold #297). */
async function openManage(d) {
  if (await existsTestId(d, "AgentSegment_manage", 2000)) return tapTestId(d, "AgentSegment_manage", 8000);
  if (await existsTestId(d, "AgentAskMeRow", 1500)) return undefined;
  await scrollToTestId(d, "AgentSettings", 8).catch(() => undefined);
  return tapTestId(d, "AgentSettings", 10000).catch(() => log("no AgentSettings toggle either; scrolling for the row"));
}

let d;
try {
  await ensureAppium();
  d = await makeDriver({ platform: "android", udid: UDID, keepState: true });
  rows.setDriver(d);
  await d.activateApp(APP_ID);
  await unlockToHome(d);
  log(`runner rules before: ${JSON.stringify(rules())}`);
  await tapTestId(d, "MyAgent", 15000);
  await sleep(1500);
  await openManage(d);
  await scrollToTestId(d, "AgentAskMeRow", 6).catch(() => undefined);
  await tapTestId(d, "AgentAskMeRow", 15000);
  for (let i = 0; i < 30 && !(await existsTestId(d, "AskMeSwitch_contextsCreate", 1000)); i++) await sleep(1000);
  log(`Ask me: enforcement "${await txt(d, "AskMeEnforcement")}" · error "${await txt(d, "AskMeError")}" · contextsCreate switch ${await switchState(d)}`);
  await screenshot(d, "askme-1-open");
  await dumpSource(d, "askme-1-open");
  if (PIN_DEV) {
    // Before the device has a screen lock: the owner check refuses, and the screen must say so.
    await scrollToTestId(d, "AskMeSwitch_contextsCreate", 4).catch(() => undefined);
    await tapTestId(d, "AskMeSwitch_contextsCreate", 10000);
    let words = null;
    for (let i = 0; i < 15 && !words; i++) {
      words = await txt(d, "AskMeError");
      if (!words) await sleep(1000);
    }
    await screenshot(d, "askme-0-no-lock");
    log(`0: no screen lock → AskMeError "${words}" · switch ${await switchState(d)}`);
    await row("no lock: refusal shown", Boolean(words) && /screen lock|lock screen|PIN|passcode/i.test(words ?? ""), `"${words}"`);
    adb("shell", "locksettings", "set-pin", PIN_DEV);
    log("device PIN set (after the link)");
    // react-native-keychain keys stay usable 5 s after a device-credential auth, and set-pin is one:
    // wait past it so the owner check really prompts (a6, 10-04).
    await sleep(Number(process.env.AFTER_PIN_WAIT_MS || 8000));
  }

  // 2 — switch on (owner check first).
  await scrollToTestId(d, "AskMeSwitch_contextsCreate", 4).catch(() => undefined);
  console.log(`TAP-ON ${new Date().toISOString()}`);
  if (PIN_DEV) {
    await tapTestId(d, "AskMeSwitch_contextsCreate", 10000);
    log("2: switch tapped (element); answering the credential prompt");
    await answerCredential(d, "on");
  } else log(`2: switch tapped by ${await flipSwitch(d, true)}`);
  await dumpSource(d, "askme-2-after-tap");
  await handleBiometricConfirmIfPresent(d).catch(() => undefined);
  await unlockIfLocked(d).catch(() => undefined);
  let on = "?";
  for (let i = 0; i < 30; i++) {
    on = await switchState(d);
    if (on === "true" || (await existsTestId(d, "AskMeError", 300))) break;
    await sleep(1000);
  }
  const during = rules();
  log(`2: switch ${on} · error "${await txt(d, "AskMeError")}" · runner rules ${JSON.stringify(during)}`);
  await screenshot(d, "askme-2-on");
  await row(SWITCH_ON, on === "true" && JSON.stringify(during).includes("contexts/create"), `switch ${on}; runner ${JSON.stringify(during)}`);

  if (process.env.ONOFF_ONLY !== "1") {
  // 3 — send a test request.
  await scrollToTestId(d, "AskMeTest", 4).catch(() => undefined);
  const t0 = Date.now();
  await tapTestId(d, "AskMeTest", 10000);
  let tested = null;
  for (let i = 0; i < 60 && !tested; i++) {
    tested = (await txt(d, "AskMeTested")) ?? ((await existsTestId(d, "AskMeError", 300)) ? `ERROR: ${await txt(d, "AskMeError")}` : null);
    if (!tested) await sleep(1000);
  }
  log(`3: after the send (${((Date.now() - t0) / 1000).toFixed(1)} s): "${tested}"`);
  await screenshot(d, "askme-3-sent");
  await row(HELD, /Your agent is asking you now/i.test(tested ?? ""), `"${tested}"`, { needs: [SWITCH_ON] });

  // 4 — a notification and a card in Requests.
  let posted = false;
  for (let i = 0; i < 30 && !posted; i++) {
    posted = /keyring-wake/.test(adb("shell", "dumpsys", "notification", "--noredact")) && adb("shell", "dumpsys", "notification", "--noredact").includes(APP_ID);
    if (!posted) await sleep(2000);
  }
  log(`4: keyring-wake notification ${posted ? "posted" : "NOT posted in 60 s"} (the app is in the foreground)`);
  await d.back().catch(() => undefined);
  await sleep(1500);
  await tapTestId(d, "MyAgent", 10000).catch(() => undefined);
  await scrollToTestId(d, "AgentRequestsRow", 6).catch(() => undefined);
  await tapTestId(d, "AgentRequestsRow", 10000).catch(() => log("no AgentRequestsRow"));
  let card = false;
  for (let i = 0; i < 20 && !card; i++) {
    card = await existsTestId(d, "DenyConsentButton", 1000);
    if (!card) await sleep(1000);
  }
  await screenshot(d, "askme-4-requests");
  log(`4: a request card in Requests: ${card ? "yes" : "NO"}`);
  await row(CARD, card, `card ${card ? "shown" : "absent"}; notification ${posted ? "posted" : "not posted (foreground)"}`, { needs: [HELD] });

  // 5 — Approve (DECIDE=approve: a test request approved from the phone, 235 gate) or Decline clears it.
  if (card && process.env.DECIDE === "approve") {
    const t5 = Date.now();
    await tapTestId(d, "ApproveConsentButton", 5000);
    console.log(`TAP-APPROVE ${new Date().toISOString()}`);
    await answerCredential(d, "approve").catch(() => undefined);
    let left = true;
    for (let i = 0; i < 25 && left; i++) {
      await sleep(1000);
      left = await existsTestId(d, "ApproveConsentButton", 500);
    }
    const btn = left ? await d.$('android=new UiSelector().resourceId("com.ariesbifold:id/ApproveConsentButton")') : null;
    const enabled = btn ? await btn.getAttribute("enabled").catch(() => "?") : "-";
    const page = await d.getPageSource();
    const words = (page.match(/text="[^"]*(couldn't|could not|refused|error|Error|422|try again|Try again)[^"]*"/g) ?? []).slice(0, 4);
    await screenshot(d, "askme-5-approved");
    await dumpSource(d, "askme-5-approved").catch(() => undefined);
    log(`5: after Approve (${((Date.now() - t5) / 1000).toFixed(1)} s): card still there ${left}; Approve enabled "${enabled}"; on screen ${JSON.stringify(words)}`);
    await row("approve clears it", !left, left ? `the card stays; Approve enabled "${enabled}"; ${JSON.stringify(words)}` : "cleared", { needs: [CARD] });
  } else if (card) {
    await tapTestId(d, "DenyConsentButton", 5000);
    // A decision may step down a version first (0.2 refused after 5.8 s on a 0.52.0 runner, 17:23Z).
    let left = true;
    for (let i = 0; i < 20 && left; i++) {
      await sleep(1000);
      left = await existsTestId(d, "DenyConsentButton", 500);
    }
    log(`5: after Decline, a card still waits: ${left}`);
    await row("decline clears it", !left, left ? "a card still waits" : "cleared", { needs: [CARD] });
  }

  } // end of steps 3–5
  // 6 — switch the rule off.
  if (process.env.ONOFF_ONLY !== "1") {
    await d.back().catch(() => undefined);
    await sleep(1500);
    await openManage(d);
    await scrollToTestId(d, "AgentAskMeRow", 6).catch(() => undefined);
    await tapTestId(d, "AgentAskMeRow", 15000);
    for (let i = 0; i < 30 && !(await existsTestId(d, "AskMeSwitch_contextsCreate", 1000)); i++) await sleep(1000);
  } else await sleep(Number(process.env.AFTER_PIN_WAIT_MS || 8000));
  if (PIN_DEV) {
    await tapTestId(d, "AskMeSwitch_contextsCreate", 10000);
    await answerCredential(d, "off");
  } else log(`6: switch tapped by ${await flipSwitch(d, false)}`);
  await handleBiometricConfirmIfPresent(d).catch(() => undefined);
  let off = "?";
  for (let i = 0; i < 30; i++) {
    off = await switchState(d);
    if (off === "false" || (await existsTestId(d, "AskMeError", 300))) break;
    await sleep(1000);
  }
  const after = rules();
  await screenshot(d, "askme-6-off");
  log(`6: switch ${off} · runner rules ${JSON.stringify(after)}`);
  await row("switch off", off === "false" && !JSON.stringify(after).includes("contexts/create"), `switch ${off}; runner ${JSON.stringify(after)}`);
} catch (err) {
  log(`error: ${err.message}`);
  rows.fatal(err);
  if (d) await screenshot(d, "askme-failure").catch(() => undefined);
} finally {
  if (PIN_DEV) {
    try {
      adb("shell", "locksettings", "clear", "--old", PIN_DEV);
      log("device PIN cleared");
    } catch (e) {
      log(`device PIN NOT cleared: ${String(e.message).slice(0, 120)}`);
    }
  }
  rows.summary();
  process.exitCode = rows.exitCode();
  if (d) await d.deleteSession().catch(() => undefined);
  stopAppium();
}
