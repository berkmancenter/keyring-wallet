/**
 * What 217's gate asserts on screen, beyond the journeys' own steps
 * (keyring-wallet-45, 2026-09-23): no identity code (DID) outside Details
 * (#12), the QR tab saying what its codes are (keyring-bifold#85; the
 * scanner header back to one line, #95), and the
 * directory-consent switch shown and off (keyring-bifold#89).
 *
 * The copy checked is the English text; the runners use the en locale.
 */
import { byTestId, existsTestId, screenshot, sleep, tapTestId } from "./driver.js";
import { openQrSheet } from "./flows.js";

const DID = /\bdid:[a-z0-9]+:[^\s"'<>&]*/i;

const decode = (s) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, "\n").replace(/&amp;/g, "&");

/** Every string a person could read on the screen now: text on Android; label and value on iOS. */
async function readableStrings(driver) {
  const source = await driver.getPageSource();
  const attrs = driver.e2ePlatform === "ios" ? ["label", "value"] : ["text", "content-desc"];
  const re = new RegExp(`\\s(?:${attrs.join("|")})="([^"]*)"`, "g");
  return [...source.matchAll(re)].map((m) => decode(m[1])).filter(Boolean);
}

/**
 * #12: a person sees words, never an identity code, unless they open
 * Details. Call it on a screen where Details is closed. The failure names the
 * string, cut short: the gate log must not carry whole identifiers around.
 */
export async function assertNoDidShown(driver, where) {
  await assertNoLeakedText(driver, where);
  const shown = (await readableStrings(driver)).find((s) => DID.test(s));
  if (!shown) {
    console.log(`[e2e] gate: no identity code on ${where}`);
    return;
  }
  await screenshot(driver, `gate-did-shown-${where.replace(/\W+/g, "-")}`);
  const did = DID.exec(shown)[0];
  throw new Error(`${where} shows an identity code outside Details: "${did.slice(0, 24)}…"`);
}

// A translation key shown as itself ("Vetting.YourVetter", 219), or a value
// that never was one ("Auto lock time: undefined min", 219).
const RAW_KEY = /^[A-Z][A-Za-z0-9]*\.[A-Z][A-Za-z0-9_]*$/;
const LEAK = /\bundefined\b|\[object Object\]/;

/** No raw translation key and no "undefined" on screen — checked wherever identity codes are. */
export async function assertNoLeakedText(driver, where) {
  const leaked = (await readableStrings(driver)).find((s) => RAW_KEY.test(s.trim()) || LEAK.test(s));
  if (!leaked) return;
  await screenshot(driver, `gate-leaked-text-${where.replace(/\W+/g, "-")}`);
  throw new Error(`${where} shows "${leaked.slice(0, 80)}" — a raw key or an unset value`);
}

/** Menu → Settings reads with no raw key and no "undefined" (its lock time did, 219). */
export async function assertSettingsReads(driver) {
  await tapTestId(driver, "Settings", 15000);
  await sleep(1500);
  await assertNoLeakedText(driver, "Settings");
  console.log("[e2e] gate: Settings reads with no raw key and no \"undefined\"");
}

const textOf = async (driver, key) =>
  (await byTestId(driver, key).getAttribute(driver.e2ePlatform === "ios" ? "label" : "text")) || "";

/** keyring-bifold#89: the directory-consent switch is on screen, and off. */
export async function assertDirectoryConsentOff(driver, where) {
  if (!(await existsTestId(driver, "DirectoryConsentSwitch", 10000))) {
    await screenshot(driver, `gate-no-consent-${where.replace(/\W+/g, "-")}`);
    throw new Error(`${where}: no "list me in the directory" switch`);
  }
  const el = byTestId(driver, "DirectoryConsentSwitch");
  const state = String(await el.getAttribute(driver.e2ePlatform === "ios" ? "value" : "checked"));
  if (state !== "0" && state !== "false") throw new Error(`${where}: the directory-consent switch starts on ("${state}")`);
  const note = await textOf(driver, "DirectoryConsentNote");
  if (!/ask the community's admin/.test(note)) throw new Error(`${where}: the consent note reads "${note}"`);
  console.log(`[e2e] gate: ${where} asks about the directory, off by default`);
}

async function leave(driver) {
  if (await existsTestId(driver, "Back", 2000)) await tapTestId(driver, "Back", 5000);
  else await driver.back();
  await sleep(1500);
}

/**
 * keyring-bifold#85: the QR tab says what its codes are — on My QR code; the
 * scanner's header is one line again (#95). The header is checked when the
 * camera is up; a simulator without one shows the camera error instead, and
 * that is said, not failed. My QR code is checked always:
 * the contact code, titled as one, and — once the phone holds a community
 * identity — that identity, named for its community and without its code.
 */
export async function assertQrTabSaysWhatItIs(driver) {
  await openQrSheet(driver);
  await tapTestId(driver, "ScanQRCode", 15000);
  for (let i = 0; i < 3 && (await existsTestId(driver, "Continue", 3000)); i++) await tapTestId(driver, "Continue");
  // The header is one line again (keyring-bifold#95): a hint added in 217 sat
  // beside it in a row and ran off both edges of a real phone's screen.
  if (await existsTestId(driver, "ScanWhatCanI", 3000)) {
    await screenshot(driver, "gate-scanner-hint-back");
    throw new Error("the scanner header carries the removed \"what you can scan\" hint again");
  }
  const oneLine = driver.$(
    driver.e2ePlatform === "ios"
      ? '-ios predicate string:label == "A valid QR code will scan automatically."'
      : 'android=new UiSelector().text("A valid QR code will scan automatically.")'
  );
  if (await oneLine.waitForExist({ timeout: 8000 }).then(() => true).catch(() => false)) {
    console.log("[e2e] gate: the scanner header is the one line");
    // The shutter's "not recognized" box: one plain line and what Keyring
    // reads — not "Ths QR code…" and photos of physical credentials (219,
    // keyring-bifold#107, keyring-wallet#143: the app overrides the words).
    if (await existsTestId(driver, "ScanNow", 3000)) {
      await tapTestId(driver, "ScanNow", 5000);
      if (!(await existsTestId(driver, "BodyText", 8000))) throw new Error('the scanner\'s "not recognized" box did not open');
      const body = await textOf(driver, "BodyText");
      if (!/It reads your agent's code/.test(body) || /\bThs\b|photo/i.test(body)) {
        await screenshot(driver, "gate-scan-failure-copy");
        throw new Error(`the "not recognized" box reads "${body.slice(0, 120)}"`);
      }
      console.log("[e2e] gate: the scanner's \"not recognized\" box says what Keyring reads");
      if (await existsTestId(driver, "Okay", 3000)) await tapTestId(driver, "Okay", 5000);
      await sleep(1000);
    }
  } else if (await existsTestId(driver, "ErrorMessage", 2000)) {
    console.log("[e2e] gate: SKIPPED the scanner header — no camera here (checked on a device leg)");
  } else {
    await screenshot(driver, "gate-scanner-header");
    throw new Error("the scanner shows neither its one-line header nor a camera error");
  }
  await leave(driver);

  await openQrSheet(driver);
  await tapTestId(driver, "GenerateRelationshipQRCode", 15000);
  if (!(await existsTestId(driver, "MyQRCodeTitle", 20000))) throw new Error("My QR code shows no title");
  if (await existsTestId(driver, "MyQRContact", 2000)) await tapTestId(driver, "MyQRContact", 5000);
  const title = (await textOf(driver, "MyQRCodeTitle")).trim();
  const instruction = await textOf(driver, "MyQRCodeInstruction");
  if (title !== "Your contact code") throw new Error(`My QR code is titled "${title}", not "Your contact code"`);
  if (!/not for linking an agent or joining a community/.test(instruction)) throw new Error(`My QR code's instruction reads "${instruction}"`);
  console.log("[e2e] gate: My QR code says it is a contact code");
  if (await existsTestId(driver, "MyQRIdentity", 2000)) {
    await tapTestId(driver, "MyQRIdentity", 5000);
    await sleep(1000);
    const idTitle = (await textOf(driver, "MyQRCodeTitle")).trim();
    const idInstruction = await textOf(driver, "MyQRCodeInstruction");
    if (!/^Your identity for /.test(idTitle) || DID.test(idTitle)) throw new Error(`the identity code is titled "${idTitle}"`);
    // The named path: the journey's identity is for the run's community, and
    // when that community publishes a name the title must say it. A prefix
    // alone passed "an unnamed community (host)" after a relaunch (217 gate,
    // 2026-09-23; keyring-bifold#90).
    const shows = process.env.KEYRING_COMMUNITY_SHOWS_AS;
    if (shows && !idTitle.includes(shows)) {
      await screenshot(driver, "gate-identity-unnamed");
      throw new Error(`the identity code is titled "${idTitle}", not for "${shows}"`);
    }
    if (!/admin scans this to invite you/.test(idInstruction)) throw new Error(`the identity code's instruction reads "${idInstruction}"`);
    await assertNoDidShown(driver, "My QR code (identity)");
    console.log(`[e2e] gate: My QR code offers "${idTitle}"`);
  } else {
    console.log("[e2e] gate: no community identity on this phone yet — only the contact code checked");
  }
  await leave(driver);
}
