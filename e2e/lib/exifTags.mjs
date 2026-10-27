/**
 * What a JPEG's Exif block holds, tag by tag, and whether all of it is harmless to send in a chat photo.
 *
 * jpegMetadata.js answers "is there Exif / GPS / XMP"; this answers "is anything in the Exif block about a person,
 * a device, a place or a time". A re-encoded chat photo keeps a small Exif block written by the encoder (orientation,
 * resolution, pixel size, colour space: seen on the 272 RC, 10-25), so "no Exif at all" is the wrong test, and passing
 * whatever was observed would be too. The allowlist below is written from what each tag means, not from one run:
 * every listed tag describes how the pixels are laid out, nothing else. Any other tag fails, and so does a second IFD
 * (IFD1, the embedded thumbnail, which can be cut from the original photo) and any GPS pointer.
 */

/** IFD0 tags that only describe the image's layout. */
export const BENIGN_IFD0 = new Map([
  [0x0112, 'Orientation'],
  [0x011a, 'XResolution'],
  [0x011b, 'YResolution'],
  [0x0128, 'ResolutionUnit'],
  [0x0213, 'YCbCrPositioning'],
  [0x8769, 'ExifIFDPointer'],
]);

/** Exif sub-IFD tags that only describe the image's layout or the Exif version. */
export const BENIGN_EXIF = new Map([
  [0x9000, 'ExifVersion'],
  [0x9101, 'ComponentsConfiguration'],
  [0xa000, 'FlashpixVersion'],
  [0xa001, 'ColorSpace'],
  [0xa002, 'PixelXDimension'],
  [0xa003, 'PixelYDimension'],
]);

/** The Exif TIFF block (bytes after "Exif\0\0"), or null if the JPEG has none. */
function exifTiff(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && Buffer.from(b.subarray(i + 4, i + 10)).toString('binary') === 'Exif\0\0') return b.subarray(i + 10, i + 2 + len);
    i += 2 + len;
  }
  return null;
}

/**
 * @param {Uint8Array} bytes a JPEG
 * @returns {{ exif: boolean, ifds: number[][], exifIfd: number[] }} the tag ids of each IFD in the IFD0 chain (IFD0,
 *   then IFD1 if present …) and of the Exif sub-IFD
 */
export function exifTags(bytes) {
  const t = exifTiff(bytes);
  if (!t || t.length < 8) return { exif: false, ifds: [], exifIfd: [] };
  const le = t[0] === 0x49;
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (o) => v.getUint16(o, le);
  const u32 = (o) => v.getUint32(o, le);
  const readIfd = (off) => {
    const n = u16(off);
    const tags = [];
    const values = new Map();
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12;
      tags.push(u16(e));
      values.set(u16(e), u32(e + 8));
    }
    return { tags, values, next: u32(off + 2 + n * 12) };
  };
  const ifds = [];
  let exifIfd = [];
  let off = u32(4);
  for (let guard = 0; off && off + 2 <= t.length && guard < 8; guard++) {
    const ifd = readIfd(off);
    ifds.push(ifd.tags);
    if (ifds.length === 1 && ifd.values.has(0x8769)) exifIfd = readIfd(ifd.values.get(0x8769)).tags;
    off = ifd.next;
  }
  return { exif: true, ifds, exifIfd };
}

/** The reasons a photo's Exif block is not harmless; empty when it is (or when there is no Exif at all). */
export function exifConcerns(bytes) {
  const { exif, ifds, exifIfd } = exifTags(bytes);
  if (!exif) return [];
  const hex = (n) => `0x${n.toString(16)}`;
  const out = [];
  if (ifds.length > 1) out.push(`a second IFD (IFD1, the embedded thumbnail) with ${ifds[1].length} tags`);
  for (const tag of ifds[0] ?? []) if (!BENIGN_IFD0.has(tag)) out.push(`IFD0 tag ${hex(tag)}${tag === 0x8825 ? ' (GPSInfo)' : ''}`);
  for (const tag of exifIfd) if (!BENIGN_EXIF.has(tag)) out.push(`Exif tag ${hex(tag)}`);
  return out;
}
