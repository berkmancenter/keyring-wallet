/**
 * The persona DID a screen shows (bifold #305), captured for the record when PERSONA_SHOTS names a folder.
 *
 * Each place that shows an identity uses DidDetails: a `<stem>Toggle` that opens it, then `<stem>Did`. This opens
 * the toggle, reads the DID, saves a screenshot as `<PERSONA_SHOTS>/<name>.png`, and prints one line,
 * `PERSONA-DID <name> <did>`, so a wrapper can compare it with what the community lists for that member.
 * Never throws: a missing identity line is logged, not a failed run.
 *
 * Stems: `VettingRequestMine` (applicant, request card), `VettingDeskApplicant` (vetter, desk),
 * `VettingCheckApplicant` (vetter, step 4), `AgentCommunityIdentity_<communityCardKey>` (community card).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { byTestId, existsTestId, scrollToTestId, sleep, tapTestId } from "./driver.js";

/** An element's box. WebdriverIO elements have no getRect(); location and size together are the rect. */
async function rectOf(el) {
  const { x, y } = await el.getLocation();
  const { width, height } = await el.getSize();
  return { x, y, width, height };
}

/**
 * Whether an element sits wholly above the tab bar (bifold #322: the last line of a page used to end behind it):
 * `{ state: "clear" | "HIDDEN" | "unread", detail }`, printed as `FOOT <name> <state> — <detail>`.
 */
export async function footCheck(d, id, name = id) {
  let state;
  let detail;
  try {
    const r = await rectOf(byTestId(d, id));
    const tab = await rectOf(byTestId(d, "MyAgent"));
    const bottom = Math.round(r.y + r.height);
    const top = Math.round(tab.y);
    state = bottom <= top ? "clear" : "HIDDEN";
    detail = `${id} ends at y=${bottom}, the tab bar starts at y=${top}`;
  } catch (e) {
    state = "unread";
    detail = String(e.message).split("\n")[0].slice(0, 200);
  }
  console.log(`FOOT ${name} ${state} — ${detail}`);
  return { state, detail };
}

/** `footCheck` as true/false, or undefined when either rect cannot be read. */
export async function footClear(d, id, name = id) {
  const { state } = await footCheck(d, id, name);
  return state === "unread" ? undefined : state === "clear";
}

/**
 * `rows` (lib/rows.js), when given, also records the foot check as the row `foot-<name>`: PASS when clear, FAIL
 * with the state and detail otherwise — the row kk.sh used to re-derive from the FOOT line.
 */
export async function capturePersonaDid(d, stem, name, { rows } = {}) {
  const dir = process.env.PERSONA_SHOTS;
  if (!dir) return undefined;
  try {
    mkdirSync(dir, { recursive: true });
    await scrollToTestId(d, `${stem}Toggle`, 6).catch(() => undefined);
    if (!(await existsTestId(d, `${stem}Toggle`, 4000))) {
      console.log(`PERSONA-DID ${name} (no ${stem}Toggle on screen)`);
      await d.saveScreenshot(path.join(dir, `${name}-missing.png`)).catch(() => undefined);
      return undefined;
    }
    if (!(await existsTestId(d, `${stem}Did`, 800))) await tapTestId(d, `${stem}Toggle`, 8000);
    await sleep(1000);
    await scrollToTestId(d, `${stem}Did`, 4).catch(() => undefined);
    const el = byTestId(d, `${stem}Did`);
    // Bring the whole DID line well above the tab bar: a line can exist (iOS) or sit at the bottom edge yet be cut off.
    try {
      const { height } = await d.getWindowSize();
      for (let i = 0; i < 3; i++) {
        const r = await rectOf(el);
        if (r.y + r.height <= height * 0.72) break;
        const x = Math.floor((await d.getWindowSize()).width / 2);
        await d.action("pointer").move({ x, y: Math.floor(height * 0.7) }).down().pause(80).move({ x, y: Math.floor(height * 0.4), duration: 400 }).up().perform();
        await sleep(700);
      }
    } catch (e) {
      // Best effort, but said: a silent catch here hid that this never scrolled (235's request card, cut off).
      console.log(`PERSONA-DID ${name} (could not lift the line: ${String(e.message).split("\n")[0].slice(0, 100)})`);
    }
    const ios = d.e2ePlatform === "ios";
    const did = String((await el.getAttribute(ios ? "label" : "text").catch(() => "")) || "").replace(/\s+/g, "");
    await d.saveScreenshot(path.join(dir, `${name}.png`)).catch(() => undefined);
    console.log(`PERSONA-DID ${name} ${did || "(empty)"}`);
    const foot = await footCheck(d, `${stem}Did`, name);
    if (rows) await rows.row(`foot-${name}`, () => ({ ok: foot.state === "clear", detail: foot.state === "clear" ? foot.detail : `${foot.state} ${foot.detail}` }));
    return did || undefined;
  } catch (e) {
    console.log(`PERSONA-DID ${name} (capture failed: ${String(e.message).split("\n")[0].slice(0, 100)})`);
    return undefined;
  }
}
