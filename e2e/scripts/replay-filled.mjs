// Re-run the one-filled-button rule (lib/filledRule.js) offline, on saved
// evidence: a full-screen screenshot plus where each button was. A change to
// the rule must still FAIL the known-bad evidence and PASS a good screen, and
// the build that produced the evidence may no longer be installed anywhere.
//
//   node e2e/scripts/replay-filled.mjs --png shot.png --source run.log [--contains VettingDeskClearButton]
//   node e2e/scripts/replay-filled.mjs --png shot.png --transcript run.log --batch 1
//   … [--expect VettingVetSomeoneElse] [--no-clip]
//
// --source: an iOS page source, or a log holding one (the last one that
//   contains --contains, if given). Buttons are its XCUIElementTypeButtons.
// --transcript: a webdriverio transcript of buttonsOnScreen; batch N is the
//   buttons measured before the Nth full-screen screenshot (1-based).
// --expect: the one testID that should be filled (none: a waiting step).
// --no-clip: judge half-hidden buttons too, as the rule did before 5e6d025.
// --points-width: the window's width in points, when the evidence does not
//   say (a transcript with no window-size call); 402 on an iPhone 17 Pro.
// iOS only, and macOS only (sips).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { FILLED_SHARE, fillShareOfBmp, judgeButtons } from "../lib/filledRule.js";

const { values: opt } = parseArgs({
  options: {
    png: { type: "string" },
    source: { type: "string" },
    contains: { type: "string" },
    transcript: { type: "string" },
    batch: { type: "string", default: "1" },
    "points-width": { type: "string" },
    expect: { type: "string" },
    "no-clip": { type: "boolean", default: false },
  },
});
if (!opt.png || !(opt.source || opt.transcript)) {
  console.error("usage: --png <screenshot> (--source <page source/log> | --transcript <log> --batch N)");
  process.exit(2);
}

const idOf = (name) => name.replace(/^com\.ariesbifold:id\//, "");

/** Buttons and window width from the last page source in `text`. */
function fromSource(text) {
  const sources = text.split(/<\?xml/).slice(1);
  const pick = [...sources].reverse().find((s) => !opt.contains || s.includes(opt.contains));
  if (!pick) throw new Error(`no page source${opt.contains ? ` containing ${opt.contains}` : ""}`);
  const attr = (tag, a) => Number((tag.match(new RegExp(` ${a}="(-?[\\d.]+)"`)) ?? [])[1]);
  const app = pick.match(/<XCUIElementTypeApplication[^>]*>/)?.[0] ?? "";
  const buttons = [...pick.matchAll(/<XCUIElementTypeButton[^>]*>/g)]
    .map(([tag]) => ({ tag, name: (tag.match(/ name="([^"]*)"/) ?? [])[1] ?? "" }))
    .filter((b) => b.name && / visible="true"/.test(b.tag))
    .map(({ tag, name }) => ({
      id: idOf(name),
      x: attr(tag, "x"),
      y: attr(tag, "y"),
      width: attr(tag, "width"),
      height: attr(tag, "height"),
    }));
  return { buttons, windowWidth: attr(app, "width") };
}

/** Buttons measured before the Nth full-screen screenshot of a transcript. */
function fromTranscript(text) {
  const lines = text.split("\n");
  const batches = [[]];
  let pendingName;
  let windowWidth;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const result = () => lines.slice(i + 1).find((l) => /INFO webdriver: RESULT/.test(l)) ?? "";
    if (/\/window\/rect$/.test(line)) windowWidth ??= Number((result().match(/width: (\d+)/) ?? [])[1]);
    else if (/\/element\/[^/]+\/attribute\/name$/.test(line)) pendingName = result().replace(/.*RESULT /, "").trim();
    else if (/\/element\/[^/]+\/rect$/.test(line) && pendingName) {
      const n = (k) => Number((result().match(new RegExp(`${k}: (-?[\\d.]+)`)) ?? [])[1]);
      batches.at(-1).push({ id: idOf(pendingName), x: n("x"), y: n("y"), width: n("width"), height: n("height") });
      pendingName = undefined;
    } else if (/\/session\/[^/]+\/screenshot$/.test(line)) batches.push([]);
  }
  const buttons = batches[Number(opt.batch) - 1];
  if (!buttons?.length) throw new Error(`no buttons measured before screenshot ${opt.batch}`);
  return { buttons, windowWidth };
}

const { buttons, windowWidth } = opt.source
  ? fromSource(readFileSync(opt.source, "utf8"))
  : fromTranscript(readFileSync(opt.transcript, "utf8"));

const dir = mkdtempSync(join(tmpdir(), "replay-"));
let bmp;
try {
  execFileSync("sips", ["-s", "format", "bmp", opt.png, "--out", join(dir, "s.bmp")], { stdio: "ignore" });
  bmp = readFileSync(join(dir, "s.bmp"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const imageWidth = bmp.readInt32LE(18);
const imageHeight = Math.abs(bmp.readInt32LE(22));
const pointsWidth = windowWidth || Number(opt["points-width"]);
if (!pointsWidth) {
  // Guessing 1 crops pixel regions at point coordinates and measures the wrong
  // part of the screen — a silent PASS (first replay of run 3, 225 gate).
  console.error("the evidence does not give the window's width in points: pass --points-width");
  process.exit(2);
}
const scale = imageWidth / pointsWidth;
const tab = buttons.find((b) => b.id === "MyAgent");
const tabTop = opt["no-clip"] ? Infinity : tab ? tab.y : imageHeight / scale;

const judged = await judgeButtons(buttons, tabTop, (b) =>
  fillShareOfBmp(bmp, { x: b.x * scale, y: b.y * scale, width: b.width * scale, height: b.height * scale })
);
const rectOf = Object.fromEntries(buttons.map((b) => [b.id, b]));
console.log(`rule: ${opt["no-clip"] ? "before 5e6d025 (no clip)" : `clip at the tab bar (y ${tabTop})`}; filled > ${FILLED_SHARE}; scale ${scale}`);
for (const b of judged) {
  const r = rectOf[b.id];
  console.log(`  ${b.filled ? "FILLED  " : "outlined"} ${b.share.toFixed(3)}  ${b.id}  (y ${r.y}–${r.y + r.height})`);
}
const skipped = buttons.filter((b) => !judged.some((j) => j.id === b.id) && b.width >= 120 && b.height >= 30 && b.height <= 200);
for (const b of skipped) console.log(`  not judged      ${b.id}  (y ${b.y}–${b.y + b.height}: not whole above the tab bar)`);
const filled = judged.filter((b) => b.filled).map((b) => b.id);
const want = opt.expect ? [opt.expect] : [];
const pass = filled.length === want.length && filled.every((id) => want.includes(id));
console.log(`${pass ? "PASS" : "FAIL"}: filled ${JSON.stringify(filled)}, expected ${JSON.stringify(want)}`);
process.exit(pass ? 0 : 1);
