// Which buttons on the screen are drawn FILLED — the step's one next action —
// and which are outlined. Appium cannot read a style, so each button's own
// screenshot is measured: a filled button is mostly the brand colour, an
// outlined one mostly the page with a thin border and its label.
//
// macOS only (sips turns the PNG into a BMP this reads without dependencies);
// the gate runs on the Mac. Used by the release gate's "one filled button per
// step" check (docs: next-release gate §2, §3).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Share of an image's pixels that are the brand fill: dark and saturated. */
export function fillShareOfBmp(buf) {
  const offset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const height = Math.abs(buf.readInt32LE(22));
  const bpp = buf.readUInt16LE(28);
  if (bpp !== 24 && bpp !== 32) throw new Error(`BMP with ${bpp} bits per pixel`);
  const step = bpp / 8;
  const rowBytes = Math.ceil((width * bpp) / 32) * 4;
  let fill = 0;
  let total = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = offset + y * rowBytes + x * step;
      const b = buf[i] / 255;
      const g = buf[i + 1] / 255;
      const r = buf[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luminance < 0.5 && max - min > 0.15) fill++;
      total++;
    }
  }
  return total ? fill / total : 0;
}

/** The brand-fill share of a PNG (base64, as Appium returns it). */
export function fillShareOfPng(base64) {
  const dir = mkdtempSync(join(tmpdir(), "filled-"));
  try {
    const png = join(dir, "b.png");
    const bmp = join(dir, "b.bmp");
    writeFileSync(png, Buffer.from(base64, "base64"));
    execFileSync("sips", ["-s", "format", "bmp", png, "--out", bmp], { stdio: "ignore" });
    return fillShareOfBmp(readFileSync(bmp));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A button more than this much brand fill is drawn filled. */
export const FILLED_SHARE = 0.4;

const testIdOf = (raw) => String(raw ?? "").replace(/^com\.ariesbifold:id\//, "");

/** The testIDs of the buttons on screen now, each with whether it is drawn filled. */
export async function buttonsOnScreen(driver) {
  const android = driver.e2ePlatform === "android" || driver.isAndroid;
  const elements = android
    ? await driver.$$('//*[@clickable="true" and @resource-id!=""]')
    : await driver.$$('//XCUIElementTypeButton[@name!=""]');
  const seen = new Map();
  for (const el of elements) {
    if (!(await el.isDisplayed().catch(() => false))) continue;
    const id = testIdOf(await el.getAttribute(android ? "resource-id" : "name"));
    if (!id || seen.has(id)) continue;
    const { width, height } = await el.getSize();
    // Rows and icons are not the step's buttons: a button is wide and short.
    if (width < 120 || height < 30 || height > 200) continue;
    const share = fillShareOfPng(await driver.takeElementScreenshot(el.elementId));
    seen.set(id, share > FILLED_SHARE);
  }
  return [...seen.entries()].map(([id, filled]) => ({ id, filled }));
}

/** The testIDs drawn filled right now. */
export async function filledButtonIds(driver) {
  return (await buttonsOnScreen(driver)).filter((b) => b.filled).map((b) => b.id);
}

/**
 * The gate's check: exactly one filled button, and it is `expected` (a testID,
 * or undefined for a step with nothing to do but wait → none filled).
 */
export async function assertOneFilled(driver, expected, where) {
  const filled = await filledButtonIds(driver);
  const want = expected ? [expected] : [];
  const ok = filled.length === want.length && filled.every((id) => want.includes(id));
  if (!ok) {
    throw new Error(`${where}: filled buttons ${JSON.stringify(filled)}, expected ${JSON.stringify(want)}`);
  }
  console.log(`[e2e] ${where}: one filled button${expected ? ` (${expected})` : " — none, a waiting step"}`);
}

// ---- the vetting steps (mirrors bifold screens/vettingPrimary.ts) ----------

const DESK_PRIMARY = {
  ticket: "VettingNewTicketButton",
  request: "VettingOpenSessionButton",
  match: "VettingCodesMatch",
  waitCard: undefined,
  check: "VettingAttestButton",
  done: "VettingVetSomeoneElse",
};

/** Which step the vetting screen says it is on, and for which side. */
async function vettingStepOf(driver) {
  const source = await driver.getPageSource();
  const m = source.match(/Vetting(Applicant|Vetter)Step_([A-Za-z]+)/);
  return m ? { side: m[1] === "Vetter" ? "vetter" : "applicant", step: m[2] } : undefined;
}

/**
 * The gate's per-step check on the vetting screen: exactly one filled button,
 * the step's next action. Off unless E2E_ONE_FILLED=1 — builds before the
 * one-primary change (keyring-bifold#143) fill several.
 */
export async function checkVettingStep(driver, where) {
  if (process.env.E2E_ONE_FILLED !== "1") return;
  const at = await vettingStepOf(driver);
  if (!at) throw new Error(`${where}: the vetting screen names no step`);
  let expected;
  if (at.side === "vetter") {
    expected = DESK_PRIMARY[at.step];
  } else {
    const has = async (id) => (await driver.$$(`//*[contains(@resource-id,"${id}") or @name="${id}"]`)).length > 0;
    const pasted = async () => {
      const input = await driver.$(`//*[contains(@resource-id,"VettingTicketInput") or @name="VettingTicketInput"]`);
      const text = (await input.getText().catch(() => "")) ?? "";
      return text.startsWith("vetting-ticket:");
    };
    const askVetter = (await pasted()) ? "VettingRequestButton" : "VettingScanTicketButton";
    expected = {
      member: "VettingGoToMyAgent",
      name: "VettingStartButton",
      ticket: askVetter,
      match: "VettingCodesMatch",
      send: "VettingSendCardButton",
      apply: (await has("VettingApplyButton")) ? "VettingApplyButton" : askVetter,
      waiting: undefined,
      checking: undefined,
    }[at.step];
  }
  await assertOneFilled(driver, expected, `${where} (${at.side} ${at.step})`);
}
