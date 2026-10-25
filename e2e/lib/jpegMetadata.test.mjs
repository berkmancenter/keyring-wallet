import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { jpegMetadata } from "./jpegMetadata.mjs";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "test-chat-photo-gps.jpg");

test("finds the GPS position in the chat photo fixture (the positive control for every scan of a received photo)", () => {
  const m = jpegMetadata(readFileSync(fixture));
  assert.deepEqual(m, { jpeg: true, exif: true, gps: true, width: 2400, height: 1800 });
});

test("finds no Exif and no GPS once the file is re-encoded without them", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "jpegmeta-"));
  const out = path.join(dir, "stripped.jpg");
  try {
    execFileSync("magick", [fixture, "-strip", "-resize", "1600x1600", out]);
  } catch {
    t.skip("ImageMagick is not installed here");
    return;
  }
  assert.deepEqual(jpegMetadata(readFileSync(out)), { jpeg: true, exif: false, gps: false, width: 1600, height: 1200 });
});

test("reports a file that is not a JPEG, or is cut short, as not one", () => {
  assert.equal(jpegMetadata(Buffer.from("%PDF-1.7")).jpeg, false);
  assert.deepEqual(jpegMetadata(readFileSync(fixture).subarray(0, 40)), { jpeg: true, exif: false, gps: false });
});
