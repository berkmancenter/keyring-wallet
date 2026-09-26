// node --test e2e/lib/filledRule.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { fillShareOfBmp, judgeButtons } from "./filledRule.js";

// The 225 gate's new-person Communities screen, in points: the tab bar starts
// at 785, "I was invited" ends above it, "I want to join" runs under it.
const TAB_TOP = 785;
const invited = { id: "AgentInvited", x: 36, y: 644, width: 330, height: 125 };
const joinDoor = { id: "AgentJoinCommunity", x: 36, y: 776, width: 330, height: 101 };

test("a button half under the tab bar is ignored, not counted as filled", async () => {
  // Measured, the half-hidden door is mostly the bar's black: it would read filled.
  const shareOf = (b) => (b.id === "AgentJoinCommunity" ? 0.9 : 0.08);
  const judged = await judgeButtons([invited, joinDoor], TAB_TOP, shareOf);
  assert.deepEqual(judged, [{ id: "AgentInvited", filled: false, share: 0.08 }]);
});

test("a filled button wholly above the tab bar still counts", async () => {
  // The known-bad desk: two filled buttons, both above the bar, both judged.
  const vet = { id: "VettingVetSomeoneElse", x: 24, y: 574, width: 354, height: 49 };
  const clear = { id: "VettingDeskClearButton", x: 24, y: 640, width: 354, height: 49 };
  const judged = await judgeButtons([vet, clear], TAB_TOP, () => 0.95);
  assert.deepEqual(
    judged.map((b) => [b.id, b.filled]),
    [
      ["VettingVetSomeoneElse", true],
      ["VettingDeskClearButton", true],
    ]
  );
});

test("a button ending exactly at the tab bar is judged; one above the window is not", async () => {
  const flush = { id: "Flush", x: 0, y: TAB_TOP - 50, width: 200, height: 50 };
  const above = { id: "Above", x: 0, y: -10, width: 200, height: 50 };
  const judged = await judgeButtons([flush, above], TAB_TOP, () => 0.9);
  assert.deepEqual(judged.map((b) => b.id), ["Flush"]);
});

test("rows, icons and repeats are not judged", async () => {
  const icon = { id: "Icon", x: 0, y: 100, width: 40, height: 40 };
  const tall = { id: "Card", x: 0, y: 100, width: 300, height: 260 };
  const button = { id: "Go", x: 0, y: 400, width: 300, height: 48 };
  const judged = await judgeButtons([icon, tall, button, { ...button }], TAB_TOP, () => 0.9);
  assert.deepEqual(judged.map((b) => b.id), ["Go"]);
});

/** A 24-bit BMP, `rows` top to bottom, each a luminance per pixel (0 dark, 1 light). */
function bmp(rows, { bottomUp = true } = {}) {
  const height = rows.length;
  const width = rows[0].length;
  const rowBytes = Math.ceil((width * 24) / 32) * 4;
  const buf = Buffer.alloc(54 + rowBytes * height);
  buf.write("BM", 0);
  buf.writeUInt32LE(54, 10);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(bottomUp ? height : -height, 22);
  buf.writeUInt16LE(24, 28);
  rows.forEach((row, y) => {
    const stored = bottomUp ? height - 1 - y : y;
    row.forEach((v, x) => buf.fill(Math.round(v * 255), 54 + stored * rowBytes + x * 3, 54 + stored * rowBytes + x * 3 + 3));
  });
  return buf;
}

test("a region is read from the right rows, whichever way the BMP stores them", () => {
  const rows = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ];
  for (const bottomUp of [true, false]) {
    const buf = bmp(rows, { bottomUp });
    assert.equal(fillShareOfBmp(buf, { x: 0, y: 0, width: 4, height: 2 }), 1, `top half dark (bottomUp=${bottomUp})`);
    assert.equal(fillShareOfBmp(buf, { x: 0, y: 2, width: 4, height: 2 }), 0, `bottom half light (bottomUp=${bottomUp})`);
    assert.equal(fillShareOfBmp(buf), 0.5, `whole image (bottomUp=${bottomUp})`);
  }
});

test("a region running off the image is read only where the image is", () => {
  const buf = bmp([
    [1, 1],
    [0, 0],
  ]);
  assert.equal(fillShareOfBmp(buf, { x: 0, y: 1, width: 2, height: 10 }), 1);
});
