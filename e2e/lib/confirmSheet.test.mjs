import assert from "node:assert/strict";
import { test } from "node:test";

import { PIN } from "./config.js";
import { answerConfirmSheet } from "./confirmSheet.js";
import { handleBiometricConfirmIfPresent } from "./flows.js";
import { fakeDriver } from "./pages/testing/fakeDriver.mjs";

// From bifold #937 on, the confirm sheet a signing act asks shows on every emulator and simulator (no biometrics
// there), and Confirm opens a Keyring PIN entry. Before, the confirm was skipped there and this helper never saw
// the sheet; a sheet it does not fill stalls the leg (join, invitation, vetting).

/** The sheet as the app shows it: Confirm and Cancel. */
const SHEET = { ConfirmBiometric: {}, CancelBiometric: {} };

/** Confirm opens the PIN entry; its Confirm closes it only for the run's PIN. */
function pinSheet(d) {
  d.onTap.ConfirmBiometric = () => {
    d.hide("ConfirmBiometric", "CancelBiometric");
    d.show("ConfirmActionEnterPIN");
    d.show("ConfirmActionWithPIN");
  };
  d.onTap.ConfirmActionWithPIN = () => {
    if (d.values.ConfirmActionEnterPIN === PIN) d.hide("ConfirmActionEnterPIN", "ConfirmActionWithPIN");
  };
}

test("no sheet: nothing is tapped, as before", async () => {
  const d = fakeDriver({ platform: "ios", screen: {} });
  assert.equal(await handleBiometricConfirmIfPresent(d), false);
  assert.deepEqual(d.taps, []);
});

for (const platform of ["android", "ios"]) {
  test(`the sheet asks for the Keyring PIN (${platform}): the run's PIN is typed and the entry closes`, async () => {
    const d = fakeDriver({ platform, screen: { ...SHEET } });
    pinSheet(d);
    assert.equal(await handleBiometricConfirmIfPresent(d), true);
    // The field is tapped to focus it, as unlockIfLocked does.
    assert.deepEqual(d.taps, ["ConfirmBiometric", "ConfirmActionEnterPIN", "ConfirmActionWithPIN"]);
    assert.equal(d.values.ConfirmActionEnterPIN, PIN);
    assert.equal(d.has("ConfirmActionEnterPIN"), false);
  });
}

test("the sheet asks for the phone's biometrics (a real device): Confirm only, the OS prompt is the operator's", async () => {
  const d = fakeDriver({ platform: "ios", screen: { ...SHEET } });
  // While the OS prompt is up the sheet shows a spinner: neither button.
  d.onTap.ConfirmBiometric = () => d.hide("ConfirmBiometric", "CancelBiometric");
  assert.equal(await handleBiometricConfirmIfPresent(d), true);
  assert.deepEqual(d.taps, ["ConfirmBiometric"]);
  assert.equal(d.values.ConfirmActionEnterPIN, undefined);
});

// The rest drive the sheet logic directly, with a scripted screen and no waiting.
function io(screen, onTap = {}) {
  const shown = new Set(Object.keys(screen));
  const taps = [];
  const typed = [];
  let t = 0;
  return {
    taps,
    typed,
    shown,
    exists: async (key) => shown.has(key),
    tap: async (key) => {
      taps.push(key);
      onTap[key]?.(shown);
    },
    typePin: async (key, pin) => typed.push([key, pin]),
    sleep: async (ms) => void (t += ms),
    now: () => t,
  };
}

test("the biometric key not there: the first Confirm leaves the sheet up offering the PIN, the second opens it", async () => {
  let first = true;
  const s = io(SHEET, {
    ConfirmBiometric: (shown) => {
      if (first) return void (first = false); // the sheet stays, now in its PIN mode
      shown.delete("ConfirmBiometric");
      shown.add("ConfirmActionEnterPIN");
    },
    ConfirmActionWithPIN: (shown) => shown.delete("ConfirmActionEnterPIN"),
  });
  assert.equal(await answerConfirmSheet(s, { pin: "135790" }), "pin");
  assert.deepEqual(s.taps, ["ConfirmBiometric", "ConfirmBiometric", "ConfirmActionWithPIN"]);
});

test("only Cancel on the sheet (Keyring can't check the PIN here): the step fails in words, nothing is tapped", async () => {
  const s = io({ CancelBiometric: {} });
  await assert.rejects(answerConfirmSheet(s, { pin: "135790" }), /offers only Cancel/);
  assert.deepEqual(s.taps, []);
});

test("only Cancel left after Confirm: the step fails in words", async () => {
  const s = io(SHEET, { ConfirmBiometric: (shown) => shown.delete("ConfirmBiometric") });
  await assert.rejects(answerConfirmSheet(s, { pin: "135790" }), /offers only Cancel/);
});

test("the PIN entry still open after its Confirm: the step fails, it does not pass as confirmed", async () => {
  const s = io(SHEET, {
    ConfirmBiometric: (shown) => {
      shown.delete("ConfirmBiometric");
      shown.add("ConfirmActionEnterPIN");
    },
  });
  await assert.rejects(answerConfirmSheet(s, { pin: "135790", closeWithin: 2000 }), /still open/);
  assert.deepEqual(s.typed, [["ConfirmActionEnterPIN", "135790"]]);
});
