// node --test e2e/lib/qrSvg.test.mjs
// The fixtures (fixtures/qr-svg.json) were drawn by the Rust qrcode crate with pnm's own render settings
// (VTI-Eucalyptus vta-cli-common/src/qr.rs svg()), so these read what `pnm vta qr --out` writes, byte for byte.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { decodeGrid, decodeQrSvg, gridOfSvg } from "./qrSvg.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(readFileSync(path.join(here, "fixtures/qr-svg.json"), "utf8"));
const byName = (start) => cases.find((c) => c.name.startsWith(start));

test("pnm's SVG of a did:webvh reads back to the DID: a version-5, level-M code (upstream's own test)", () => {
  const c = byName("upstream qr.rs test DID, level M");
  const got = decodeQrSvg(c.svg);
  assert.equal(got.text, c.text);
  assert.equal(got.version, 5);
  assert.equal(got.size, 37);
  assert.equal(got.ecLevel, "M");
});

test("every fixture reads back to its text: version information, mixed segments, another level", () => {
  for (const c of cases) {
    const got = decodeQrSvg(c.svg);
    assert.equal(got.text, c.text, c.name);
    assert.equal(got.ecLevel, c.level, c.name);
  }
  assert.ok(decodeQrSvg(byName("a long did:webvh").svg).version >= 7, "the long DID exercises the version-information areas");
});

test("the quiet zone is trimmed: the grid starts at a finder pattern's corner", () => {
  const grid = gridOfSvg(byName("upstream qr.rs test DID, level M").svg);
  assert.equal(grid.length, 37);
  // A finder: a 7-module dark ring around a light ring around a 3 × 3 dark centre.
  assert.deepEqual(grid[0].slice(0, 8), [true, true, true, true, true, true, true, false]);
  assert.deepEqual(grid[1].slice(0, 7), [true, false, false, false, false, false, true]);
  assert.deepEqual(grid[3].slice(0, 7), [true, false, true, true, true, false, true]);
});

test("<rect> modules read the same as the crate's path, so another renderer's SVG works too", () => {
  const c = byName("upstream qr.rs test DID, level M");
  const grid = gridOfSvg(c.svg);
  const rects = grid.flatMap((row, y) => row.map((dark, x) => (dark ? `<rect x="${(x + 4) * 10}" y="${(y + 4) * 10}" width="10" height="10"/>` : ""))).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 450 450"><rect x="0" y="0" width="450" height="450" fill="#fff"/>${rects}</svg>`;
  assert.equal(decodeQrSvg(svg).text, c.text);
});

test("what is not a QR code says why, rather than returning text", () => {
  assert.throws(() => decodeQrSvg('<svg><rect x="0" y="0" width="10" height="10" fill="#ffffff"/></svg>'), /no dark modules/);
  assert.throws(() => decodeQrSvg('<svg><path fill="#000" d="M0 0h80v40H0V0"/></svg>'), /not a QR code's square/);
  // A square of the right size with no format information.
  const blank = Array.from({ length: 21 }, () => new Array(21).fill(false));
  assert.throws(() => decodeGrid(blank), /no valid format information/);
});

test("a damaged read is not passed off as the DID: one data module flipped changes the text or fails", () => {
  const c = byName("upstream qr.rs test DID, level M");
  const grid = gridOfSvg(c.svg);
  // Bottom-right is always data (the first codeword's first bits).
  grid[36][36] = !grid[36][36];
  let text;
  try {
    text = decodeGrid(grid).text;
  } catch {
    text = undefined;
  }
  assert.notEqual(text, c.text);
});
