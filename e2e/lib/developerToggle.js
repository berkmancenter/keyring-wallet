/**
 * The decision behind "make sure a Developer-screen switch is on" (flows.js
 * ensureDeveloperToggle). DIDComm v2, the wallet mailbox and TSP carriage are
 * on by default since builds 278/282 (app/src/store.tsx), so a runner that
 * blindly tapped the row would turn them OFF; it has to read the switch and
 * tap only when the switch disagrees. Pure, so node --test can hold it.
 */

/**
 * The switch's state from what Appium exposes.
 *
 * Android: the row keeps its Switch visible to UiAutomator, whose `checked`
 * attribute is "true"/"false". iOS: the accessible row hides its Switch from
 * XCUITest (Developer.tsx), so the row carries the state as its
 * accessibilityValue, read as the element's `value` ("on"/"off").
 *
 * Returns true, false, or null when nothing readable was exposed.
 */
export function switchState({ platform, checked, value }) {
  if (platform === "android") {
    if (checked === "true" || checked === true) return true;
    if (checked === "false" || checked === false) return false;
    return null;
  }
  const v = (value ?? "").toString().trim().toLowerCase();
  if (v === "on" || v === "1" || v === "true") return true;
  if (v === "off" || v === "0" || v === "false") return false;
  return null;
}

/**
 * What to do about a switch read as `state` when the run wants `wantOn`:
 * "tap" when they disagree, "leave" when they agree, "assume" when the state
 * could not be read: the default is the wanted state on every current build,
 * and a blind tap would flip a switch that was already right. The markers the
 * runner asserts afterwards (the out-of-band/2.0 invitation, the mailbox's
 * "forwarding on", the TSP envelope lines) catch a wrong assumption loudly.
 */
export function toggleAction(state, wantOn = true) {
  if (state === null || state === undefined) return "assume";
  return state === wantOn ? "leave" : "tap";
}
