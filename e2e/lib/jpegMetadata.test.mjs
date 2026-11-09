import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { jpegMetadata } from "./jpegMetadata.mjs";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "test-chat-photo-gps.jpg");

/** `bytes` with every APP1 segment cut out: the fixture as it would be with its Exif removed, built without any tool. */
function withoutApp1(bytes) {
  const parts = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i] === 0xff && bytes[i + 1] !== 0xda) {
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (bytes[i + 1] !== 0xe1) parts.push(bytes.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  parts.push(bytes.subarray(i));
  return Buffer.concat(parts);
}

test("finds the GPS position in the chat photo fixture (the positive control for every scan of a received photo)", () => {
  const m = jpegMetadata(readFileSync(fixture));
  assert.deepEqual(m, { jpeg: true, exif: true, gps: true, xmp: false, width: 2400, height: 1800 });
});

// Built here rather than with an image tool, so this control runs on every machine: a skipped negative control would
// read as a pass.
test("finds no Exif and no GPS in the same image with its Exif segment cut out", () => {
  const stripped = withoutApp1(readFileSync(fixture));
  assert.ok(stripped.length < readFileSync(fixture).length);
  assert.deepEqual(jpegMetadata(stripped), { jpeg: true, exif: false, gps: false, xmp: false, width: 2400, height: 1800 });
});

// A JPEG this test did not build: a real encoder's own segment layout, so the scanner is not only right about files
// shaped the way withoutApp1 makes them. Format robustness, not the control the photo row relies on (that is the case
// above, which always runs), so it may skip where ImageMagick is not installed.
test("reads an encoder-written JPEG without Exif as such", (t) => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "jpegmeta-")), "stripped.jpg");
  try {
    execFileSync("magick", [fixture, "-strip", "-resize", "1600x1600", out]);
  } catch {
    t.skip("ImageMagick is not installed here");
    return;
  }
  assert.deepEqual(jpegMetadata(readFileSync(out)), {
    jpeg: true,
    exif: false,
    gps: false,
    xmp: false,
    width: 1600,
    height: 1200,
  });
});

test("reports a file that is not a JPEG, or is cut short, as not one", () => {
  assert.equal(jpegMetadata(Buffer.from("%PDF-1.7")).jpeg, false);
  assert.deepEqual(jpegMetadata(readFileSync(fixture).subarray(0, 40)), { jpeg: true, exif: false, gps: false, xmp: false });
});

// XMP can carry a location too (exif:GPSLatitude in its RDF), so a received photo must carry no XMP packet at all.
test("finds an XMP packet, which a received photo must not carry", () => {
  const stripped = withoutApp1(readFileSync(fixture));
  const packet = Buffer.from(
    'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="10,0.0N"/></rdf:RDF></x:xmpmeta>',
    "binary"
  );
  const segment = Buffer.concat([Buffer.from([0xff, 0xe1, (packet.length + 2) >> 8, (packet.length + 2) & 0xff]), packet]);
  const withXmp = Buffer.concat([stripped.subarray(0, 2), segment, stripped.subarray(2)]);
  assert.deepEqual(jpegMetadata(withXmp), { jpeg: true, exif: false, gps: false, xmp: true, width: 2400, height: 1800 });
});
