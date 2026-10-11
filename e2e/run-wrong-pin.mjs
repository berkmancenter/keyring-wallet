#!/usr/bin/env node
/**
 * IN-257 (bifold #384): a wrong PIN on the unlock screen empties the field, so the person can start over. Before it,
 * the six dots stayed filled after "Incorrect PIN" and had to be deleted one by one.
 *
 * On a phone that already holds a wallet with the harness PIN (E2E_PIN, else 123456; any leg after run-vta-link.js):
 * the app is ended and started again, which lands on the unlock screen (EnterPIN); a wrong PIN of the same length is
 * typed (it submits itself on the last digit); once the error shows, the field is read; then the right PIN is typed.
 * Row (lib/rows.js):
 *   wrong-pin-clears   PASS needs all three: the error line shows (InlineErrorText, or "Incorrect PIN" on the page),
 *                      the PIN field then holds nothing (Android: its text; iOS: its value; the masked "● ● ●" counts
 *                      as digits), and typing the right PIN unlocks (EnterPIN gone, the home tabs shown).
 *                      SKIP "build lacks clearSignal" on a build before #384 (the PINInput prop the fix adds; a prop
 *                      name, not a testID, but kept as a literal in the bundle like one), and SKIP when the phone has
 *                      no wallet (the link before it failed).
 * One wrong attempt only: the lockout starts at five (attemptLockoutConfig), and the right PIN resets the count. The
 * driver always leaves the wallet unlocked (lib/flows.js unlockIfLocked), whatever the row said.
 *   PLATFORM=android UDID=emulator-5570 APPIUM_PORT=4760 node run-wrong-pin.mjs
 *   PLATFORM=ios UDID=<sim> IOS_APP=<app> IOS_DEVICE_NAME=… IOS_PLATFORM_VERSION=… APPIUM_PORT=4768 node run-wrong-pin.mjs
 */
import "./lib/cli-guard.js";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { byTestId, ensureAppium, existsTestId, screenshot, sleep, stopAppium, tapTestId } from "./lib/driver.js";
import { buildLacks } from "./lib/buildHas.js";
import { PIN } from "./lib/config.js";
import { unlockIfLocked } from "./lib/flows.js";
import { makeDriver, textOf } from "./lib/keyringRoles.js";
import { createRows, selectedRows } from "./lib/rows.js";

export const ROW = "wrong-pin-clears";

/** A wrong PIN of the same length: every digit moved by one, so it can never be the right one. */
export const wrongPinFor = (pin) =>
  String(pin)
    .split("")
    .map((c) => (/\d/.test(c) ? String((Number(c) + 1) % 10) : c))
    .join("");

/**
 * How many characters a PIN field holds, from what the platform reads back: the masked value is "● ● ● ● ● ●"
 * (bullets joined by spaces, PINInput's displayValue), shown digits are "1 2 3"; spaces are padding. An empty
 * field reads "" or null; iOS can answer with the field's accessibility words when empty, which hold no digit
 * or bullet.
 */
export const pinCount = (raw) => (String(raw ?? "").match(/[0-9●•]/g) ?? []).length;

/** The PIN field's contents as the platform reads them: Android's text, iOS's value. Returns { raw, count }. */
export async function readPinField(d, key = "EnterPIN") {
  const el = byTestId(d, key);
  const raw = d.e2ePlatform === "ios" ? await el.getAttribute("value").catch(() => "") : await el.getAttribute("text").catch(() => "");
  return { raw: raw ?? "", count: pinCount(raw) };
}

/** Type a PIN into the field: a digit at a time on iOS (one setValue can drop a keystroke there, flows.js). */
async function typePin(d, pin) {
  const field = byTestId(d, "EnterPIN");
  await field.click().catch(() => undefined);
  if (d.e2ePlatform === "ios") {
    for (const digit of pin) {
      await field.addValue(digit);
      await sleep(200);
    }
  } else {
    await field.setValue(pin);
  }
}

/** The unlock screen's error line, or "" within `ms`: InlineErrorText, else "Incorrect PIN…" anywhere on the page. */
async function errorLine(d, ms) {
  for (const until = Date.now() + ms; Date.now() < until; await sleep(1000)) {
    if (await existsTestId(d, "InlineErrorText", 500)) {
      const words = (await textOf(d, "InlineErrorText").catch(() => "")).trim();
      if (words) return words;
    }
    const m = (await d.getPageSource().catch(() => "")).match(/Incorrect PIN[^"]*/);
    if (m) return m[0];
  }
  return "";
}

const log = (m) => console.log(`[e2e] ${new Date().toISOString().slice(11, 23)}Z ${m}`);

async function main() {
  const PLATFORM = process.env.PLATFORM === "ios" ? "ios" : "android";
  const BID = process.env.E2E_APP_ID || "asml.bkc.harvard.wallet";
  const rows = createRows({ label: "wrong-pin" });
  // Not selected (a rerun of other rows): the row says so and nothing is opened.
  const only = selectedRows();
  if (only && !only.has(ROW)) {
    await rows.row(ROW, () => true);
    rows.summary();
    return rows.exitCode();
  }
  const lacks = buildLacks("clearSignal", { platform: PLATFORM });
  if (lacks) {
    rows.skip(ROW, `${lacks} (bifold #384, IN-257: PINInput's clearSignal)`);
    rows.summary();
    return rows.exitCode();
  }
  let d;
  try {
    await ensureAppium();
    d = await makeDriver({ platform: PLATFORM, udid: process.env.UDID, deviceName: process.env.IOS_DEVICE_NAME, keepState: true });
    rows.setDriver(d);
    await d.activateApp(BID);
    if (await existsTestId(d, "GetStarted", 8000)) {
      rows.skip(ROW, "no wallet on this phone (the link before this row did not finish)");
      return rows.exitCode();
    }
    // A fresh start of the app always asks for the PIN.
    await d.terminateApp(BID).catch(() => undefined);
    await sleep(2000);
    await d.activateApp(BID);
    const locked = await existsTestId(d, "EnterPIN", 120000);
    const wrong = wrongPinFor(PIN);
    let error = "";
    let after = { raw: "", count: -1 };
    let unlocked = false;
    let how = "";
    if (locked) {
      await typePin(d, wrong);
      // It submits itself on the sixth digit. A dropped submit is tapped once (Enter), only if the field still holds it.
      error = await errorLine(d, 10000);
      if (!error && (await readPinField(d)).count === wrong.length && (await existsTestId(d, "Enter", 1500))) {
        log("no error 10 s after the wrong PIN, field still full: tapping Enter once");
        await tapTestId(d, "Enter", 10000).catch(() => undefined);
        error = await errorLine(d, 10000);
      }
      // The clear comes with the error; read twice a second apart and keep the later reading.
      await sleep(1000);
      after = await readPinField(d);
      await screenshot(d, "wrong-pin-after-error").catch(() => undefined);
      log(`after the wrong PIN: error "${error}" · field ${JSON.stringify(after.raw)} (${after.count})`);
      // The right PIN, typed into the field as it now is.
      await typePin(d, PIN);
      for (const until = Date.now() + 30000; Date.now() < until && !unlocked; await sleep(1500)) {
        unlocked = !(await byTestId(d, "EnterPIN").isExisting().catch(() => true));
      }
      if (!unlocked && (await existsTestId(d, "Enter", 1500))) {
        await tapTestId(d, "Enter", 10000).catch(() => undefined);
        for (const until = Date.now() + 20000; Date.now() < until && !unlocked; await sleep(1500)) {
          unlocked = !(await byTestId(d, "EnterPIN").isExisting().catch(() => true));
        }
        how = " (after tapping Enter)";
      }
      const home = unlocked && (await existsTestId(d, "Contacts", 30000));
      how = `${unlocked ? (home ? "unlocked to the home tabs" : "the unlock screen went, but no home tabs in 30 s") : "still on the unlock screen 30 s after the right PIN"}${how}`;
      unlocked = unlocked && home;
    }
    await rows.row(ROW, () => {
      if (!locked) return { ok: false, detail: "the app started again without the unlock screen (EnterPIN) in 120 s" };
      const wrongs = [!error && "no error line after the wrong PIN", after.count !== 0 && `the field still holds ${after.count} character(s) (${JSON.stringify(after.raw)})`, !unlocked && how].filter(Boolean);
      return wrongs.length
        ? { ok: false, detail: `${wrongs.join("; ")}${error ? `; error "${error}"` : ""}` }
        : { ok: true, detail: `error "${error}"; the field then empty (${JSON.stringify(after.raw)}); the right PIN ${how}` };
    });
  } catch (e) {
    log(`error: ${String(e.message).split("\n")[0]}`);
    if (d) await screenshot(d, "wrong-pin-failure").catch(() => undefined);
    rows.fatal(e);
  } finally {
    // Leave the wallet unlocked for whatever runs next.
    if (d) await unlockIfLocked(d).catch(() => undefined);
    rows.summary();
    if (d) await d.deleteSession().catch(() => undefined);
    stopAppium();
  }
  return rows.exitCode();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
