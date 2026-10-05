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

export async function capturePersonaDid(d, stem, name) {
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
    const ios = d.e2ePlatform === "ios";
    const did = String((await el.getAttribute(ios ? "label" : "text").catch(() => "")) || "").replace(/\s+/g, "");
    await d.saveScreenshot(path.join(dir, `${name}.png`)).catch(() => undefined);
    console.log(`PERSONA-DID ${name} ${did || "(empty)"}`);
    return did || undefined;
  } catch (e) {
    console.log(`PERSONA-DID ${name} (capture failed: ${String(e.message).split("\n")[0].slice(0, 100)})`);
    return undefined;
  }
}
