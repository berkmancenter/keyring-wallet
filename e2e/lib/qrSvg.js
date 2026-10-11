/**
 * A QR code drawn as an SVG, read back to its text: what `pnm vta qr --out FILE.svg` holds, for the gate row that
 * proves the code pnm draws reaches Keyring's scanner (pnmlink.sh, pnmqr-scan).
 *
 * pnm renders with the Rust `qrcode` crate (VTI-Eucalyptus vta-cli-common/src/qr.rs: level M, black on white, quiet
 * zone): one `M{x} {y}h8v8H{x}V{y}` subpath per dark module, 8 units a module. This reads any SVG made of filled
 * rectangles (those subpaths, or `<rect>` elements) into the module grid, then decodes it the standard way: format
 * information, unmasking, the codewords in their zig-zag order, the blocks de-interleaved, then the numeric,
 * alphanumeric and byte segments the crate's optimal segmentation may mix.
 *
 * No error correction: an SVG is exact, so there is no damage to correct. A wrong read cannot pass a row either,
 * since the row compares the text with the agent's DID.
 *
 *   decodeQrSvg(svgText)   { text, version, ecLevel, mask, size }   or throws, saying why
 *   gridOfSvg(svgText)     the module grid (rows of booleans, dark = true), quiet zone trimmed
 *   decodeGrid(grid)       the grid's text and code parameters
 */

// ------------------------------------------------------------------ the SVG to a grid

const LIGHT = /^(#fff(fff)?|white|none|transparent)$/i;
const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];

/** A path's filled rectangles: each closed subpath is taken as its bounding box (M, m, h, H, v, V, l, L, z). */
function rectsOfPath(d) {
  const out = [];
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let x = 0;
  let y = 0;
  let pts = [];
  const close = () => {
    if (pts.length > 1) {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      if (r.w > 0 && r.h > 0) out.push(r);
    }
    pts = [];
  };
  let cmd = "";
  for (let i = 0; i < tokens.length; ) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const num = () => Number(tokens[i++]);
    switch (cmd) {
      case "M":
      case "m": {
        close();
        const nx = num();
        const ny = num();
        x = cmd === "m" ? x + nx : nx;
        y = cmd === "m" ? y + ny : ny;
        pts.push([x, y]);
        cmd = cmd === "m" ? "l" : "L"; // further pairs are line-tos
        break;
      }
      case "L":
      case "l": {
        const nx = num();
        const ny = num();
        x = cmd === "l" ? x + nx : nx;
        y = cmd === "l" ? y + ny : ny;
        pts.push([x, y]);
        break;
      }
      case "H":
      case "h":
        x = cmd === "h" ? x + num() : num();
        pts.push([x, y]);
        break;
      case "V":
      case "v":
        y = cmd === "v" ? y + num() : num();
        pts.push([x, y]);
        break;
      case "Z":
      case "z":
        close();
        break;
      default:
        throw new Error(`qrSvg: path command "${cmd}" is not a rectangle's`);
    }
  }
  close();
  return out;
}

/** The dark rectangles of an SVG: filled paths and `<rect>`s, the light background left out. */
function darkRects(svg) {
  const rects = [];
  for (const [tag] of svg.matchAll(/<(path|rect)\b[^>]*>/g)) {
    const fill = attr(tag, "fill");
    if (fill !== undefined && LIGHT.test(fill)) continue;
    if (tag.startsWith("<rect")) {
      const n = (k) => Number(attr(tag, k) ?? 0);
      rects.push({ x: n("x"), y: n("y"), w: n("width"), h: n("height") });
    } else {
      rects.push(...rectsOfPath(attr(tag, "d") ?? ""));
    }
  }
  return rects;
}

/** The module grid (dark = true), from its finder-to-finder extent: the quiet zone is left out. */
export function gridOfSvg(svg) {
  const rects = darkRects(String(svg));
  if (!rects.length) throw new Error("qrSvg: no dark modules in the SVG");
  const unit = Math.min(...rects.map((r) => Math.min(r.w, r.h)));
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  const size = Math.round((x1 - x0) / unit);
  if (Math.round((y1 - y0) / unit) !== size || size < 21 || (size - 17) % 4 !== 0) {
    throw new Error(`qrSvg: the dark modules span ${size} × ${Math.round((y1 - y0) / unit)}, not a QR code's square (21, 25, … 177)`);
  }
  const grid = Array.from({ length: size }, () => new Array(size).fill(false));
  for (const r of rects) {
    const c0 = Math.round((r.x - x0) / unit);
    const r0 = Math.round((r.y - y0) / unit);
    for (let rr = r0; rr < r0 + Math.round(r.h / unit); rr++) for (let cc = c0; cc < c0 + Math.round(r.w / unit); cc++) grid[rr][cc] = true;
  }
  return grid;
}

// ------------------------------------------------------------------ the grid to text

/** Error-correction codewords per block and blocks per version, [level][version] (ISO/IEC 18004 table 9). */
const ECC_PER_BLOCK = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const BLOCKS = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};
const LEVEL_OF_BITS = ["M", "L", "H", "Q"]; // the format's two level bits: 00 M, 01 L, 10 H, 11 Q

/** Alignment pattern centres, one axis (the same both ways). */
function alignmentCentres(version) {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

/** Which modules are not data: finders and their format areas, timing, alignment, version information. */
function functionModules(version) {
  const size = version * 4 + 17;
  const f = Array.from({ length: size }, () => new Array(size).fill(false));
  const region = (left, top, w, h) => {
    for (let r = top; r < top + h; r++) for (let c = left; c < left + w; c++) f[r][c] = true;
  };
  region(0, 0, 9, 9);
  region(size - 8, 0, 8, 9);
  region(0, size - 8, 9, 8);
  const centres = alignmentCentres(version);
  const last = centres.length - 1;
  centres.forEach((cy, i) =>
    centres.forEach((cx, j) => {
      if ((i === 0 && (j === 0 || j === last)) || (i === last && j === 0)) return;
      region(cx - 2, cy - 2, 5, 5);
    })
  );
  region(6, 9, 1, size - 17);
  region(9, 6, size - 17, 1);
  if (version >= 7) {
    region(size - 11, 0, 3, 6);
    region(0, size - 11, 6, 3);
  }
  return f;
}

/** The format's 15 bits for 5 data bits: BCH(15,5), then the fixed mask. */
function formatBits(data) {
  let v = data << 10;
  for (let i = 14; i >= 10; i--) if (v & (1 << i)) v ^= 0x537 << (i - 10);
  return ((data << 10) | v) ^ 0x5412;
}

const popcount = (n) => n.toString(2).replace(/0/g, "").length;

/** Level and mask from the two copies of the format information, the nearest valid code (≤ 3 bits off). */
function readFormat(grid) {
  const size = grid.length;
  const at = (x, y) => (grid[y][x] ? 1 : 0);
  let a = 0;
  for (let x = 0; x < 6; x++) a = (a << 1) | at(x, 8);
  a = (a << 1) | at(7, 8);
  a = (a << 1) | at(8, 8);
  a = (a << 1) | at(8, 7);
  for (let y = 5; y >= 0; y--) a = (a << 1) | at(8, y);
  let b = 0;
  for (let y = size - 1; y >= size - 7; y--) b = (b << 1) | at(8, y);
  for (let x = size - 8; x < size; x++) b = (b << 1) | at(x, 8);
  let best;
  for (let data = 0; data < 32; data++) {
    const code = formatBits(data);
    const off = Math.min(popcount(code ^ a), popcount(code ^ b));
    if (!best || off < best.off) best = { off, data };
  }
  if (best.off > 3) throw new Error("qrSvg: no valid format information (not a QR code, or a damaged one)");
  return { ecLevel: LEVEL_OF_BITS[best.data >> 3], mask: best.data & 7 };
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** The codewords, unmasked, in reading order: column pairs from the right, up then down, column 6 skipped. */
function readCodewords(grid, version, mask) {
  const size = grid.length;
  const fn = functionModules(version);
  const flip = MASKS[mask];
  const out = [];
  let byte = 0;
  let bits = 0;
  let up = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let k = 0; k < size; k++) {
      const r = up ? size - 1 - k : k;
      for (let col = 0; col < 2; col++) {
        const c = right - col;
        if (fn[r][c]) continue;
        byte = (byte << 1) | (grid[r][c] !== flip(r, c) ? 1 : 0);
        if (++bits === 8) {
          out.push(byte);
          byte = 0;
          bits = 0;
        }
      }
    }
    up = !up;
  }
  return out;
}

/** The data codewords, de-interleaved from their blocks (short blocks first, each long one a codeword longer). */
function dataCodewords(codewords, version, ecLevel) {
  const numBlocks = BLOCKS[ecLevel][version];
  const ecc = ECC_PER_BLOCK[ecLevel][version];
  const total = codewords.length;
  const shortLen = Math.floor(total / numBlocks);
  const numShort = numBlocks - (total % numBlocks);
  const shortData = shortLen - ecc;
  const blocks = Array.from({ length: numBlocks }, () => []);
  let k = 0;
  for (let i = 0; i < shortData; i++) for (const b of blocks) b.push(codewords[k++]);
  for (let j = numShort; j < numBlocks; j++) blocks[j].push(codewords[k++]);
  return blocks.flat();
}

const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/** The segments' text: numeric, alphanumeric and byte (UTF-8); an ECI designator is read past. */
function parseSegments(data, version) {
  let pos = 0;
  const left = () => data.length * 8 - pos;
  const read = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++, pos++) v = (v << 1) | ((data[pos >> 3] >> (7 - (pos & 7))) & 1);
    return v;
  };
  const size = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  const parts = [];
  while (left() >= 4) {
    const mode = read(4);
    if (mode === 0) break;
    if (mode === 0b0001) {
      let n = read([10, 12, 14][size]);
      let s = "";
      for (; n >= 3; n -= 3) s += String(read(10)).padStart(3, "0");
      if (n === 2) s += String(read(7)).padStart(2, "0");
      if (n === 1) s += String(read(4));
      parts.push(Buffer.from(s, "latin1"));
    } else if (mode === 0b0010) {
      let n = read([9, 11, 13][size]);
      let s = "";
      for (; n >= 2; n -= 2) {
        const v = read(11);
        s += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45];
      }
      if (n === 1) s += ALNUM[read(6)];
      parts.push(Buffer.from(s, "latin1"));
    } else if (mode === 0b0100) {
      const n = read([8, 16, 16][size]);
      const bytes = [];
      for (let i = 0; i < n; i++) bytes.push(read(8));
      parts.push(Buffer.from(bytes));
    } else if (mode === 0b0111) {
      const first = read(8);
      if ((first & 0x80) !== 0) read((first & 0x40) === 0 ? 8 : 16);
    } else {
      throw new Error(`qrSvg: segment mode ${mode.toString(2).padStart(4, "0")} is not one a DID is drawn in`);
    }
  }
  return Buffer.concat(parts).toString("utf8");
}

/** A module grid's text and the code it was drawn as. */
export function decodeGrid(grid) {
  const size = grid.length;
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 40) throw new Error(`qrSvg: ${size} modules a side is no QR version`);
  const { ecLevel, mask } = readFormat(grid);
  const data = dataCodewords(readCodewords(grid, version, mask), version, ecLevel);
  return { text: parseSegments(data, version), version, ecLevel, mask, size };
}

/** An SVG's QR code, as text. */
export function decodeQrSvg(svg) {
  return decodeGrid(gridOfSvg(svg));
}
