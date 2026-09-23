/**
 * What 217's gate asserts on screen, beyond the journeys' own steps
 * (keyring-wallet-45, 2026-09-23): no identity code (DID) outside Details
 * (#12), the QR tab saying what its codes are (keyring-bifold#85), and the
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
  const shown = (await readableStrings(driver)).find((s) => DID.test(s));
  if (!shown) {
    console.log(`[e2e] gate: no identity code on ${where}`);
    return;
  }
  await screenshot(driver, `gate-did-shown-${where.replace(/\W+/g, "-")}`);
  const did = DID.exec(shown)[0];
  throw new Error(`${where} shows an identity code outside Details: "${did.slice(0, 24)}…"`);
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
 * keyring-bifold#85: the QR tab says what its codes are. The scanner's hint
 * is checked when the camera is up; a simulator without one shows the camera
 * error instead, and that is said, not failed. My QR code is checked always:
 * the contact code, titled as one, and — once the phone holds a community
 * identity — that identity, named for its community and without its code.
 */
export async function assertQrTabSaysWhatItIs(driver) {
  await openQrSheet(driver);
  await tapTestId(driver, "ScanQRCode", 15000);
  for (let i = 0; i < 3 && (await existsTestId(driver, "Continue", 3000)); i++) await tapTestId(driver, "Continue");
  if (await existsTestId(driver, "ScanWhatCanI", 8000)) {
    const hint = await textOf(driver, "ScanWhatCanI");
    if (!/agent's code/.test(hint) || !/community's code/.test(hint)) throw new Error(`the scanner's hint reads "${hint}"`);
    console.log("[e2e] gate: the scanner says what it takes");
  } else if (await existsTestId(driver, "ErrorMessage", 2000)) {
    console.log("[e2e] gate: SKIPPED the scanner's hint — no camera here (checked on a device leg)");
  } else {
    await screenshot(driver, "gate-scanner-no-hint");
    throw new Error("the scanner shows neither its hint nor a camera error");
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
    if (!/admin scans this to invite you/.test(idInstruction)) throw new Error(`the identity code's instruction reads "${idInstruction}"`);
    await assertNoDidShown(driver, "My QR code (identity)");
    console.log(`[e2e] gate: My QR code offers "${idTitle}"`);
  } else {
    console.log("[e2e] gate: no community identity on this phone yet — only the contact code checked");
  }
  await leave(driver);
}
