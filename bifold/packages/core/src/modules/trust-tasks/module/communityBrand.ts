/**
 * How a community's cards look in the Wallet: one colour, a pattern and a monogram (or the community's logo), the
 * same on the list and in a card's details, so a community is recognised by its card and not only by reading it.
 *
 * The colour is the one the community publishes (`branding.accentColor` in its manifest) when it gives one, made
 * readable with white text if it is not; otherwise a hue drawn from the community's DID, so every community has its
 * own colour without publishing anything (most publish nothing yet). Every colour here keeps white text at 4.5:1 or
 * better. Nothing is read from the network here: the inputs are what the phone already keeps.
 *
 * @module trust-tasks/module/communityBrand
 */

export type PassPattern = 'waves' | 'stripes' | 'rings' | 'dots'

/** What the phone keeps of a community's branding (VtiCommunityStore `community-brand`); absent fields: none given. */
export interface CommunityBrandRecord {
  communityDid: string
  accentColor?: string
  logoUrl?: string
  /** When the community last said it. */
  at?: string
}

export interface CommunityBrandInput {
  communityDid: string
  /** What the community calls itself, when it has said. */
  name?: string
  /** `branding.accentColor` as kept (already checked with {@link normalisedAccent}). */
  accentColor?: string
  /** A logo the phone holds for it (a local file), when there is one. */
  logo?: string
}

export interface CommunityBrand {
  /** The card's colour, #rrggbb; white text on it is at least {@link MIN_CONTRAST}:1. */
  color: string
  pattern: PassPattern
  /** Up to two letters standing for the community where there is no logo. */
  monogram: string
  logo?: string
  /** Whether the colour is the community's own (or that, darkened to be readable), not one drawn from its DID. */
  fromAccent: boolean
}

/** WCAG AA for normal text. */
export const MIN_CONTRAST = 4.5

const PATTERNS: readonly PassPattern[] = ['waves', 'stripes', 'rings', 'dots']

/** FNV-1a: a small, stable hash, so one community always draws the same hue and pattern. */
export function brandHash(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** `#rgb` or `#rrggbb` (any case) as `#rrggbb`; anything else is no colour. */
export function normalisedAccent(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const hex = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex
  if (/^#[0-9a-f]{3}$/.test(hex)) return `#${[...hex.slice(1)].map((c) => c + c).join('')}`
  return undefined
}

/**
 * A logo address worth fetching: https only (a plain-http logo would be readable and replaceable on the way), no
 * credentials in it, and of a sane length. Anything else is no logo, and the monogram is shown.
 */
export function httpsLogoUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.length > 2048) return undefined
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16) / 255
const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** Contrast ratio of white text on `hex`. */
export function contrastWithWhite(hex: string): number {
  const luminance =
    0.2126 * linear(channel(hex, 1)) + 0.7152 * linear(channel(hex, 3)) + 0.0722 * linear(channel(hex, 5))
  return 1.05 / (luminance + 0.05)
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return toHex(f(0), f(8), f(4))
}

function hexToHsl(hex: string): [number, number, number] {
  const r = channel(hex, 1)
  const g = channel(hex, 3)
  const b = channel(hex, 5)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60
  return [h, s, l]
}

/** The community's colour, darkened (same hue) until white text on it is readable. */
export function readableAccent(hex: string): string {
  if (contrastWithWhite(hex) >= MIN_CONTRAST) return hex
  const [h, s, l] = hexToHsl(hex)
  for (let lightness = l; lightness > 0; lightness -= 0.01) {
    const candidate = hslToHex(h, s, Math.max(0, lightness))
    if (contrastWithWhite(candidate) >= MIN_CONTRAST) return candidate
  }
  return '#000000'
}

/** Hues near the app's error red are left out, so no community's card reads as "revoked". */
const ERROR_HUE = 354
const ERROR_HUE_SPAN = 15

/** The hue a DID draws, kept out of the error-red band. */
export function didHue(communityDid: string): number {
  const hue = brandHash(communityDid) % 360
  const fromError = Math.abs(((hue - ERROR_HUE + 540) % 360) - 180)
  return fromError < ERROR_HUE_SPAN ? (hue + 2 * ERROR_HUE_SPAN) % 360 : hue
}

/** HSL(hue, 50%, 30%): white text on it is at 4.98:1 or better for every hue. */
export function colourAtHue(hue: number): string {
  return hslToHex(hue, 0.5, 0.3)
}

/** A colour drawn from the DID (see {@link didHue}, {@link colourAtHue}). */
export function didColour(communityDid: string): string {
  return colourAtHue(didHue(communityDid))
}

/** How far a hue is from the error red, in degrees (tests). */
export function hueDistanceFromError(hue: number): number {
  return Math.abs(((hue - ERROR_HUE + 540) % 360) - 180)
}

export { ERROR_HUE_SPAN }

const initial = (word: string) => Array.from(word).find((c) => /[\p{L}\p{N}]/u.test(c)) ?? ''

/**
 * Up to two letters: the first and last words of the community's name ("Riverside Climbing Club" → "RC"); without a
 * name, the first two parts of its DID's handle ("al-community2-vtc" → "AC"), else the first letter it has.
 */
export function monogramOf(name: string | undefined, handle: string | undefined): string {
  const named = name?.trim()
  const words = named ? named.split(/\s+/) : (handle ?? '').split(/[-_.\s]+/)
  const parts = words.filter((word) => initial(word))
  const picked = named ? [parts[0], parts.length > 1 ? parts[parts.length - 1] : undefined] : [parts[0], parts[1]]
  return picked
    .filter((word): word is string => !!word)
    .map(initial)
    .join('')
    .toLocaleUpperCase()
}

/** The last path segment of a did:webvh, the operator's readable handle (communityName.ts `didPathName`). */
function handleOf(did: string): string | undefined {
  const parts = did.split(':')
  if (parts[1] !== 'webvh' || parts.length < 5) return undefined
  try {
    return decodeURIComponent(parts[parts.length - 1]) || undefined
  } catch {
    return undefined
  }
}

export function communityBrand(input: CommunityBrandInput): CommunityBrand {
  const accent = normalisedAccent(input.accentColor)
  const hash = brandHash(input.communityDid)
  return {
    color: accent ? readableAccent(accent) : didColour(input.communityDid),
    pattern: PATTERNS[(hash >>> 9) % PATTERNS.length],
    monogram: monogramOf(input.name, handleOf(input.communityDid)) || '?',
    logo: input.logo,
    fromAccent: !!accent,
  }
}
