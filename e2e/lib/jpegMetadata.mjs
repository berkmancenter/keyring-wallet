/**
 * What a JPEG carries besides its pixels: whether it has an Exif segment (APP1, "Exif\0\0"), and whether that holds a
 * GPS position (the GPSInfo tag, 0x8825). Read from the bytes, so a run can prove that a photo received over chat lost
 * its location on the sender's phone (rich messaging Step 3: the re-encode drops EXIF; Jest cannot show it, since it
 * runs the manipulator's mock).
 *
 * Only the header segments are walked, up to the first scan (SOS); a truncated or non-JPEG file is reported as such.
 */

/** @param {Uint8Array} b @returns {{ jpeg: boolean, exif: boolean, gps: boolean, width?: number, height?: number }} */
export function jpegMetadata(b) {
  const out = { jpeg: false, exif: false, gps: false };
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return out;
  out.jpeg = true;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return out;
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xda || marker === 0xd9) return out;
    const length = (b[i + 2] << 8) | b[i + 3];
    if (length < 2 || i + 2 + length > b.length) return out;
    const body = b.subarray(i + 4, i + 2 + length);
    if (marker === 0xe1 && body.length >= 6 && Buffer.from(body.subarray(0, 6)).equals(Buffer.from("Exif\0\0", "binary"))) {
      out.exif = true;
      if (hasGpsTag(body.subarray(6))) out.gps = true;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && body.length >= 5) {
      out.height = (body[1] << 8) | body[2];
      out.width = (body[3] << 8) | body[4];
    }
    i += 2 + length;
  }
  return out;
}

// IFD0 of the TIFF structure inside the Exif segment: does any entry carry the GPSInfo tag?
function hasGpsTag(tiff) {
  if (tiff.length < 8) return false;
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  const u16 = (o) => (le ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1]);
  const u32 = (o) => (le ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16)) + tiff[o + 3] * 2 ** 24 : tiff[o] * 2 ** 24 + ((tiff[o + 1] << 16) | (tiff[o + 2] << 8) | tiff[o + 3]));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return false;
  const count = u16(ifd);
  for (let k = 0; k < count && ifd + 2 + 12 * (k + 1) <= tiff.length; k++) {
    if (u16(ifd + 2 + 12 * k) === 0x8825) return true;
  }
  return false;
}
