// Which buttons on the screen are drawn FILLED — the step's one next action —
// and which are outlined. Appium cannot read a style, so each button's own
// screenshot is measured: a filled button is mostly the brand colour, an
// outlined one mostly the page with a thin border and its label.
//
// The rule itself (what counts as filled, which buttons are judged) lives in
// filledRule.js, so it can be re-proved offline against saved evidence.
//
// macOS only (sips turns the PNG into a BMP this reads without dependencies);
// the gate runs on the Mac. Used by the release gate's "one filled button per
// step" check (docs: next-release gate §2, §3).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { byTestId, scrollToTestId, sleep } from "./driver.js";
import { fillShareOfBmp, judgeButtons } from "./filledRule.js";

export { FILLED_SHARE, fillShareOfBmp, judgeButtons } from "./filledRule.js";

/** A PNG (base64, as Appium returns it) as a BMP buffer. */
export function bmpOfPng(base64) {
  const dir = mkdtempSync(join(tmpdir(), "filled-"));
  try {
    const png = join(dir, "b.png");
    const bmp = join(dir, "b.bmp");
    writeFileSync(png, Buffer.from(base64, "base64"));
    execFileSync("sips", ["-s", "format", "bmp", png, "--out", bmp], { stdio: "ignore" });
    return readFileSync(bmp);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The fill share of a PNG (base64, as Appium returns it). */
export function fillShareOfPng(base64) {
  return fillShareOfBmp(bmpOfPng(base64));
}

const testIdOf = (raw) => String(raw ?? "").replace(/^com\.ariesbifold:id\//, "");

/** The testIDs of the buttons on screen now, each with whether it is drawn filled. */
export async function buttonsOnScreen(driver) {
  const android = driver.e2ePlatform === "android" || driver.isAndroid;
  const elements = android
    ? await driver.$$('//*[@clickable="true" and @resource-id!=""]')
    : await driver.$$('//XCUIElementTypeButton[@name!=""]');
  const tab = byTestId(driver, "MyAgent");
  const tabTop = (await tab.isExisting().catch(() => false))
    ? (await tab.getLocation()).y
    : (await driver.getWindowSize()).height;
  const buttons = [];
  for (const el of elements) {
    if (!(await el.isDisplayed().catch(() => false))) continue;
    const id = testIdOf(await el.getAttribute(android ? "resource-id" : "name"));
    if (!id) continue;
    const { x, y } = await el.getLocation();
    const { width, height } = await el.getSize();
    buttons.push({ id, x, y, width, height, el });
  }
  return judgeButtons(buttons, tabTop, async (b) => fillShareOfPng(await driver.takeElementScreenshot(b.el.elementId)));
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
  // A step settles over a moment (a ticket in the field is checked before
  // "Use this link" takes over): judge it for up to ~6 s, not at one instant.
  // A button that never changes still fails, with what was last seen.
  let last;
  for (let i = 0; i < 6; i++) {
    if (i > 0) await sleep(1000);
    const { at, expected } = await expectedAt(driver, where);
    const seen = await buttonsOnScreen(driver);
    const filledSet = new Set(seen.filter((b) => b.filled).map((b) => b.id));
    // The step's button below the fold (the desk's "Codes match" sits under
    // the big code): scroll it into view and judge both views together, so a
    // second filled button cannot hide by scrolling away. Being reachable is
    // §6's question; this says when it took a scroll.
    if (expected && !seen.some((b) => b.id === expected)) {
      // scrollToTestId stops once the button "is displayed", which a half-hidden
      // one already is; then drag the page up until it is whole on screen.
      await scrollToTestId(driver, expected, 3).catch(() => undefined);
      let after = await buttonsOnScreen(driver);
      let drags = 0;
      for (; drags < 3 && !after.some((b) => b.id === expected); drags++) {
        await dragUp(driver);
        after = await buttonsOnScreen(driver);
      }
      for (const b of after) if (b.filled) filledSet.add(b.id);
      console.log(`[e2e] ${where}: ${expected} was below the fold — judged after scrolling (${drags} drag${drags === 1 ? "" : "s"})`);
    }
    const filled = [...filledSet];
    const want = expected ? [expected] : [];
    last = { at, filled, want };
    if (filled.length === want.length && filled.every((id) => want.includes(id))) {
      console.log(`[e2e] ${where} (${at.side} ${at.step}): one filled button${expected ? ` (${expected})` : " — none, a waiting step"}`);
      return;
    }
  }
  throw new Error(`${where} (${last.at.side} ${last.at.step}): filled buttons ${JSON.stringify(last.filled)}, expected ${JSON.stringify(last.want)}`);
}

/** Drag the page up a fifth of the window. */
async function dragUp(driver) {
  const { width, height } = await driver.getWindowSize();
  const x = Math.round(width / 2);
  await driver.performActions([
    {
      type: "pointer",
      id: "finger",
      parameters: { pointerType: "touch" },
      actions: [
        { type: "pointerMove", duration: 0, x, y: Math.round(height * 0.6) },
        { type: "pointerDown", button: 0 },
        { type: "pause", duration: 100 },
        { type: "pointerMove", duration: 400, x, y: Math.round(height * 0.4) },
        { type: "pointerUp", button: 0 },
      ],
    },
  ]);
  await driver.releaseActions().catch(() => undefined);
  await sleep(700);
}

/** The step the vetting screen is on, and the one button that should be filled on it. */
async function expectedAt(driver, where) {
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
      // An empty field on Android reports its placeholder as its text, and the
      // placeholder is a ticket's start ("vetting-ticket:?v=1&…"): not a ticket.
      const hint = (await input.getAttribute("hint").catch(() => null)) ?? "vetting-ticket:?v=1&…";
      return text.startsWith("vetting-ticket:") && text !== hint && !text.endsWith("…");
    };
    // As the screen decides (VtiVetting ticketLinkReady): "Use this link" once
    // the field holds a ticket the screen has not refused.
    const askVetter = (await pasted()) && !(await has("VettingTicketRefused")) ? "VettingRequestButton" : "VettingScanTicketButton";
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
  return { at, expected };
}
