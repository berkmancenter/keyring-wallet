/**
 * A minimal CESR stream reader for KERI key event logs: it frames a stream into events and their attachments, for the
 * codes in ./codes.ts only. An unknown count code, signature code, version or kind is refused as `unsupportedCesr`; a
 * stream that is cut short or does not add up is refused as `malformedCesr`. It never skips or guesses.
 *
 * Its output, on every K0 fixture stream, is checked against what cesr-ts 2.0.0 reads from the same bytes
 * (__tests__/fixtures/k0-utah-v2/cesr-ts-reads.json).
 *
 * @module sedi/cesr/reader
 */
import { COUNTERS, INDEXED_SIGS, KERI_V2_JSON } from './codes'
import { b64Int, rawOf } from './qb64'

export type CesrRefusal = { ok: false; reason: 'unsupportedCesr' | 'malformedCesr'; detail: string }

export interface IndexedSig {
  code: string
  index: number
  raw: Uint8Array
}

export interface KelEvent {
  /** The event's exact bytes, as signed. */
  raw: Uint8Array
  text: string
  ilk: string
  sn: number
  pre: string
  said: string
  prior?: string
  /** Absent fields read as empty, as cesr-ts reads them. */
  keys: string[]
  ndigs: string[]
  backs: string[]
  bn?: number
  kt: string
  /** The next-key threshold as written ("nt"), when the event carries one. */
  nt?: string
  seals?: Record<string, unknown>[]
}

export interface KelFrame {
  body: KelEvent
  groups: { name: 'ControllerIdxSigs'; items: IndexedSig[] }[]
}

const td = new TextDecoder()
const unsupported = (detail: string): CesrRefusal => ({ ok: false, reason: 'unsupportedCesr', detail })
const malformed = (detail: string): CesrRefusal => ({ ok: false, reason: 'malformedCesr', detail })

const hexInt = (value: unknown): number | undefined =>
  typeof value === 'string' && /^[0-9a-f]+$/.test(value) ? parseInt(value, 16) : undefined

function bodyAt(bytes: Uint8Array, text: string, at: number): { ok: true; event: KelEvent; end: number } | CesrRefusal {
  const head = text.slice(at, at + 25)
  if (!head.startsWith('{"v":"')) return unsupported(`at ${at}: a body that does not open with its version string`)
  const vs = head.slice(6, 25)
  if (!vs.startsWith(KERI_V2_JSON) || vs[18] !== '.') return unsupported(`at ${at}: version ${vs}`)
  const size = b64Int(vs.slice(14, 18))
  if (at + size > bytes.length) return malformed(`at ${at}: body of ${size} bytes runs past the stream`)
  const raw = bytes.slice(at, at + size)
  const bodyText = td.decode(raw)
  let ked: Record<string, unknown>
  try {
    ked = JSON.parse(bodyText) as Record<string, unknown>
  } catch {
    return malformed(`at ${at}: body is not JSON`)
  }
  if (ked.v !== vs) return malformed(`at ${at}: version string is not the body's own`)
  const sn = hexInt(ked.s)
  if (typeof ked.t !== 'string' || typeof ked.i !== 'string' || typeof ked.d !== 'string' || sn === undefined)
    return malformed(`at ${at}: event without t, i, d or a hex s`)
  const strings = (v: unknown) => (Array.isArray(v) ? (v as string[]) : undefined)
  const event: KelEvent = {
    raw,
    text: bodyText,
    ilk: ked.t,
    sn,
    pre: ked.i,
    said: ked.d,
    ...(typeof ked.p === 'string' ? { prior: ked.p } : {}),
    keys: strings(ked.k) ?? [],
    ndigs: strings(ked.n) ?? [],
    backs: strings(ked.b) ?? [],
    ...(hexInt(ked.bt) !== undefined ? { bn: hexInt(ked.bt) } : {}),
    kt: String(ked.kt ?? ''),
    ...(ked.nt !== undefined ? { nt: String(ked.nt) } : {}),
    ...(Array.isArray(ked.a) ? { seals: ked.a as Record<string, unknown>[] } : {}),
  }
  return { ok: true, event, end: at + size }
}

function groupAt(text: string, at: number): { ok: true; group: KelFrame['groups'][number]; end: number } | CesrRefusal {
  const code = text.slice(at, at + 2)
  const counter = COUNTERS[code]
  if (!counter) return unsupported(`at ${at}: count code ${code}`)
  if (at + 4 > text.length) return malformed(`at ${at}: count code cut short`)
  const length = b64Int(text.slice(at + 2, at + 4)) * 4
  const start = at + 4
  const end = start + length
  if (end > text.length) return malformed(`at ${at}: ${code} group of ${length} characters runs past the stream`)
  const items: IndexedSig[] = []
  for (let i = start; i < end; ) {
    const sigCode = text[i]
    const kind = INDEXED_SIGS[sigCode]
    if (!kind) return unsupported(`at ${i}: indexed signature code ${sigCode}`)
    if (i + kind.fs > end) return malformed(`at ${i}: signature runs past its ${code} group`)
    const qb64 = text.slice(i, i + kind.fs)
    items.push({ code: sigCode, index: b64Int(qb64[1]), raw: rawOf(qb64, 2) })
    i += kind.fs
  }
  return { ok: true, group: { name: counter.name, items }, end }
}

/** Frame a KEL stream: each event with the attachment groups that follow it. */
export function readKelStream(bytes: Uint8Array): { ok: true; frames: KelFrame[] } | CesrRefusal {
  const text = td.decode(bytes)
  // A stream with no event in it is not a KEL; refused here so it can never stand for one that is absent.
  if (text.length === 0) return malformed('an empty stream')
  const frames: KelFrame[] = []
  let at = 0
  while (at < text.length) {
    if (text[at] !== '{') return unsupported(`at ${at}: stream does not continue with an event body`)
    const body = bodyAt(bytes, text, at)
    if (!body.ok) return body
    at = body.end
    const groups: KelFrame['groups'] = []
    while (at < text.length && text[at] !== '{') {
      if (text[at] !== '-') return unsupported(`at ${at}: attachment does not open with a count code`)
      const g = groupAt(text, at)
      if (!g.ok) return g
      groups.push(g.group)
      at = g.end
    }
    frames.push({ body: body.event, groups })
  }
  return { ok: true, frames }
}
