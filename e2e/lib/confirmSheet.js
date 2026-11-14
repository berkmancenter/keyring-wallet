/**
 * The confirm sheet a signing act asks before it goes ahead (join, invitation, vetting step, room offer), answered
 * the way a person would. Dependency-free: `io` is the few driver calls it needs, so it is tested without a device.
 *
 * What the sheet can ask, from bifold #937 on:
 * - The phone's own biometrics (Biometric Unlock on): Confirm opens the OS prompt, which Appium cannot answer, so a
 *   real device hands it to the operator ("os").
 * - The Keyring PIN (Biometric Unlock off, no biometrics set up on the phone, which is every emulator and simulator,
 *   or the biometric key missing): Confirm opens a PIN entry, filled here with the run's PIN ("pin").
 * - Nothing it can check (only Cancel left: Keyring can't check the PIN on this screen): that is an app state, not a
 *   harness one, so it fails the step in words.
 * Before #937 an emulator never saw the sheet: the confirm was skipped on a phone with no biometrics ("none").
 */

/** Wait until `key` is no longer on screen; false if it is still there after `ms`. */
async function goneWithin(io, key, ms) {
  const now = io.now ?? Date.now;
  const until = now() + ms;
  while (now() < until) {
    if (!(await io.exists(key, 500))) return true;
    await io.sleep(500);
  }
  return !(await io.exists(key, 500));
}

const ONLY_CANCEL =
  "the confirm sheet offers only Cancel: Keyring can't check the PIN on this screen (app state; reopen the app with the PIN)";

/**
 * Answer the confirm sheet if it is showing. Returns how: "none" (no sheet), "pin" (the Keyring PIN was typed and the
 * entry closed), or "os" (Confirm tapped; the OS prompt is the operator's). Throws when the sheet offers only Cancel,
 * or the PIN entry stays open after its Confirm.
 *
 * io: { exists(key, ms), tap(key), typePin(key, pin), sleep(ms), now?(), log?(line) }
 */
export async function answerConfirmSheet(io, { pin, appearWithin = 1500, pinWithin = 5000, closeWithin = 15000 } = {}) {
  const log = io.log ?? (() => undefined);
  const now = io.now ?? Date.now;
  const asked = now();
  if (!(await io.exists("ConfirmBiometric", appearWithin))) {
    if (await io.exists("CancelBiometric", 300)) throw new Error(ONLY_CANCEL);
    return "none";
  }
  log(`confirm sheet up after ${now() - asked} ms`);
  // Two taps at most: when the biometric key is not there, the first Confirm leaves the sheet up, now offering the
  // Keyring PIN under the same button.
  for (let tap = 1; tap <= 2; tap++) {
    await io.tap("ConfirmBiometric");
    if (await io.exists("ConfirmActionEnterPIN", pinWithin)) {
      await io.typePin("ConfirmActionEnterPIN", pin);
      await io.tap("ConfirmActionWithPIN");
      if (await goneWithin(io, "ConfirmActionEnterPIN", closeWithin)) {
        log("confirmed with the Keyring PIN");
        return "pin";
      }
      throw new Error("the Keyring PIN entry is still open after its Confirm (a wrong PIN, or the tap was lost)");
    }
    if (tap === 1 && (await io.exists("ConfirmBiometric", 500))) continue;
    // Confirm gone and Cancel left: the sheet says Keyring can't check the PIN here.
    if (await io.exists("CancelBiometric", 300)) throw new Error(ONLY_CANCEL);
    // Neither button: the sheet is waiting on the OS prompt.
    return "os";
  }
  return "os";
}
