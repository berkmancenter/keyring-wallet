// node --test e2e/lib/exifTags.test.mjs
// JPEGs made here: an SOI, one APP1 "Exif" segment built from the tags given, and an EOI. No image data is needed:
// exifTags reads only the markers before SOS.
import assert from "node:assert/strict";
import { test } from "node:test";

import { exifConcerns, exifTags } from "./exifTags.mjs";

/** A little-endian TIFF block: IFD0 with `ifd0` tags, an optional Exif sub-IFD, and an optional IFD1. */
function tiff({ ifd0, exif, ifd1 }) {
  const ifdSize = (n) => 2 + n * 12 + 4;
  const tags0 = [...ifd0, ...(exif ? [0x8769] : [])];
  const off0 = 8;
  const offExif = off0 + ifdSize(tags0.length);
  const offIfd1 = offExif + (exif ? ifdSize(exif.length) : 0);
  const size = offIfd1 + (ifd1 ? ifdSize(ifd1.length) : 0);
  const v = new DataView(new ArrayBuffer(size));
  v.setUint8(0, 0x49); v.setUint8(1, 0x49); v.setUint16(2, 42, true); v.setUint32(4, off0, true);
  const write = (off, tags, next, values = new Map()) => {
    v.setUint16(off, tags.length, true);
    tags.forEach((tag, k) => {
      const e = off + 2 + k * 12;
      v.setUint16(e, tag, true); v.setUint16(e + 2, 4, true); v.setUint32(e + 4, 1, true); v.setUint32(e + 8, values.get(tag) ?? 0, true);
    });
    v.setUint32(off + 2 + tags.length * 12, next, true);
  };
  write(off0, tags0, ifd1 ? offIfd1 : 0, new Map([[0x8769, offExif]]));
  if (exif) write(offExif, exif, 0);
  if (ifd1) write(offIfd1, ifd1, 0);
  return Buffer.from(v.buffer);
}

function jpeg(parts) {
  const body = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff(parts)]);
  const len = body.length + 2;
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff]), body, Buffer.from([0xff, 0xd9])]);
}

// What the 272 RC's re-encode wrote into every chat photo (10-25): orientation, resolution, pixel size, colour space.
const reencoded = { ifd0: [0x0112, 0x011a, 0x011b, 0x0128], exif: [0xa001, 0xa002, 0xa003] };

test("the re-encoded chat photo's Exif block is harmless", () => {
  assert.deepEqual(exifConcerns(jpeg(reencoded)), []);
  assert.deepEqual(exifTags(jpeg(reencoded)).ifds.length, 1);
});

test("no Exif at all is harmless", () => {
  assert.deepEqual(exifConcerns(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), []);
});

test("control: a GPS pointer fails, named", () => {
  const c = exifConcerns(jpeg({ ...reencoded, ifd0: [...reencoded.ifd0, 0x8825] }));
  assert.equal(c.length, 1);
  assert.match(c[0], /0x8825 \(GPSInfo\)/);
});

test("control: a camera's make, model and date each fail", () => {
  const c = exifConcerns(jpeg({ ...reencoded, ifd0: [...reencoded.ifd0, 0x010f, 0x0110, 0x0132] }));
  assert.deepEqual(c, ["IFD0 tag 0x10f", "IFD0 tag 0x110", "IFD0 tag 0x132"]);
});

test("control: a capture time in the Exif sub-IFD fails", () => {
  assert.deepEqual(exifConcerns(jpeg({ ...reencoded, exif: [...reencoded.exif, 0x9003] })), ["Exif tag 0x9003"]);
});

test("control: an embedded thumbnail (IFD1) fails, even with nothing else in the block", () => {
  const c = exifConcerns(jpeg({ ...reencoded, ifd1: [0x0103, 0x0201, 0x0202] }));
  assert.equal(c.length, 1);
  assert.match(c[0], /IFD1/);
});
