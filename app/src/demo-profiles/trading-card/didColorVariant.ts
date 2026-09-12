/**
 * Per-contact "foil" variation for the trading card: the same card design,
 * hue-rotated by an amount derived deterministically from the contact's DID.
 *
 * Rotating hue in HSL space (rather than picking arbitrary colors) keeps
 * whatever saturation/lightness relationship the base branding already has —
 * so every variant reads as "the same card, different foil," never a clash,
 * no matter which hue it lands on. Same technique as GitHub/Slack per-user
 * avatar colors, applied to a card instead of an avatar.
 *
 * Deterministic and stable: the same DID always renders the same variant, so
 * a contact's card doesn't shuffle across app restarts or re-renders.
 */

/** A small, fast, deterministic string hash (djb2). Good enough for a color seed — not a security use. */
const hashDid = (did: string): number => {
  let hash = 5381
  for (let i = 0; i < did.length; i++) {
    hash = (hash * 33) ^ did.charCodeAt(i)
  }
  return hash >>> 0 // unsigned
}

/** The DID's hue rotation, in degrees [0, 360). */
export const hueRotationForDid = (did: string): number => hashDid(did) % 360

const hexToRgb = (hex: string): [number, number, number] => {
  const normalized = hex.replace('#', '')
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized
  const int = parseInt(value, 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  const rN = r / 255
  const gN = g / 255
  const bN = b / 255
  const max = Math.max(rN, gN, bN)
  const min = Math.min(rN, gN, bN)
  const l = (max + min) / 2

  if (max === min) return [0, 0, l]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case rN:
      h = (gN - bN) / d + (gN < bN ? 6 : 0)
      break
    case gN:
      h = (bN - rN) / d + 2
      break
    default:
      h = (rN - gN) / d + 4
  }
  return [h * 60, s, l]
}

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }

  const hueToRgb = (p: number, q: number, t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hNorm = h / 360
  return [
    Math.round(hueToRgb(p, q, hNorm + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, hNorm) * 255),
    Math.round(hueToRgb(p, q, hNorm - 1 / 3) * 255),
  ]
}

const rgbToHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')

/** Rotate a hex color's hue by `degrees`, preserving its saturation and lightness. */
export const rotateHueHex = (hex: string, degrees: number): string => {
  const [r, g, b] = hexToRgb(hex)
  const [h, s, l] = rgbToHsl(r, g, b)
  const rotated = (((h + degrees) % 360) + 360) % 360
  const [rr, rg, rb] = hslToRgb(rotated, s, l)
  return rgbToHex(rr, rg, rb)
}

export interface CardColors {
  primary: string
  secondary: string
}

/** The given branding colors, re-tinted for this DID's foil variant. */
export const cardVariantForDid = (did: string, base: CardColors): CardColors => {
  const rotation = hueRotationForDid(did)
  return {
    primary: rotateHueHex(base.primary, rotation),
    secondary: rotateHueHex(base.secondary, rotation),
  }
}
