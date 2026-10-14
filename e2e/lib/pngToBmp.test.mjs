// node --test e2e/lib/pngToBmp.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { fillShareOfBmp } from "./filledRule.js";
import { convertPngToBmp, onPath, pngToBmpCommand } from "./pngToBmp.js";

const only = (...cmds) => (c) => cmds.includes(c);

test("macOS keeps using sips, even when ImageMagick is also installed", () => {
  const [cmd, args] = pngToBmpCommand("darwin", only("sips", "magick"), "a.png", "a.bmp");
  assert.equal(cmd, "sips");
  assert.deepEqual(args, ["-s", "format", "bmp", "a.png", "--out", "a.bmp"]);
});

test("Linux uses magick, else convert, asking for a 24-bit BMP", () => {
  const [m, margs] = pngToBmpCommand("linux", only("magick", "convert"), "a.png", "a.bmp");
  assert.equal(m, "magick");
  assert.ok(margs.includes("bmp3:a.bmp") && margs.includes("TrueColor"));
  assert.equal(pngToBmpCommand("linux", only("convert"), "a.png", "a.bmp")[0], "convert");
});

test("macOS without sips falls back to ImageMagick; no tool at all is a clear error", () => {
  assert.equal(pngToBmpCommand("darwin", only("magick"), "a", "b")[0], "magick");
  assert.throws(() => pngToBmpCommand("linux", () => false, "a", "b"), /ImageMagick/);
});

// A 2x2 solid-black PNG; the real converter must yield a BMP the measure reads as filled.
const BLACK_2X2_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQAAAABazTCJAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oKAgUQH1qznyEAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTAtMDJUMDU6MTY6MzErMDA6MDBl7TKUAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTEwLTAyVDA1OjE2OjMxKzAwOjAwFLCKKAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMC0wMlQwNToxNjozMSswMDowMEOlq/cAAAAMSURBVAjXY2BgYAAAAAQAASc0JwoAAAAASUVORK5CYII=";

test("the real converter turns a PNG into a BMP fillShareOfBmp reads", (t) => {
  if (!onPath("magick") && !onPath("convert") && !onPath("sips")) return t.skip("no image tool");
  const dir = mkdtempSync(join(tmpdir(), "pngbmp-"));
  try {
    const png = join(dir, "b.png");
    const bmp = join(dir, "b.bmp");
    writeFileSync(png, Buffer.from(BLACK_2X2_PNG, "base64"));
    convertPngToBmp(png, bmp);
    assert.equal(fillShareOfBmp(readFileSync(bmp)), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
