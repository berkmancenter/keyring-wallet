/**
 * Digests, SAIDs and KEL replay for the Guardian check: a TypeScript port of ref-21's verifier.mjs (tsp-reference/
 * ref-21-sedi-keri-lifecycle, SEDI/KERI lane) on this package's own CESR reader (../cesr) instead of cesr-ts, with
 * @noble/hashes v2 for Blake3 and SHA-256. No Node built-ins, no storage, no network.
 *
 * @module sedi/guardian/kel
 */
import { blake3 } from '@noble/hashes/blake3.js'
import { sha256 } from '@noble/hashes/sha2.js'

import { readKelStream } from '../cesr/reader'
import { DIGESTS } from '../cesr/codes'
import { b64Encode, keyCode } from '../cesr/qb64'
import { verifySignature } from '../cesr/signatures'

const te = new TextEncoder()
export const DUMMY = '#'.repeat(44)

export type Digest = (code: string, bytes: Uint8Array) => string

/** qb64 of a 32-byte digest under a one-character code (E: Blake3-256, I: SHA2-256). */
export const digest: Digest = (code, bytes) => {
  const fn = code === 'E' ? blake3 : code === 'I' ? sha256 : undefined
  if (!fn) throw new Error(`unsupported digest code ${code}`)
  const padded = new Uint8Array(33)
  padded.set(fn(bytes), 1)
  return code + b64Encode(padded).slice(1)
}

/** The SAID of `rawText` with every field in `labels` that carries `said` dummied, in the exact received bytes. */
export function saidOfRaw(dig: Digest, rawText: string, said: string, labels = ['d']): string {
  let t = rawText
  for (const l of labels) t = t.split(`"${l}":"${said}"`).join(`"${l}":"${DUMMY}"`)
  return dig(said[0], te.encode(t))
}

export interface KeyState {
  pre: string
  sn: number
  said: string
  keys: string[]
  ndigs: string[]
  wits: string[]
  toad: number
  ilk: string
}

export interface HistoryEntry extends KeyState {
  /** The seals that may anchor a presented TEL event: an ixn's, as ref-21 reads them (empty for icp and rot). */
  seals: Record<string, unknown>[]
  /** Every seal in the event's "a", whatever its ilk. Read only by the TEL completeness check (chain.ts verifyTel),
   * which must see every event the issuer anchored for a registry, so that a seal in an icp or rot is not missed. */
  anchors: Record<string, unknown>[]
  receipts: number
  sigs: number
}

export type Replay =
  | { ok: true; state: KeyState; history: HistoryEntry[] }
  | {
      ok: false
      reason: string
      /** Set when the stream holds CESR this package does not read: never replayed as if it were absent. */
      cesr?: 'unsupportedCesr' | 'malformedCesr'
      /** Set when the stream read but uses a code or KERI feature this package cannot verify. Refused all the same: it
       * says only why Keyring cannot verify it, nothing about whether the stream is genuine or undamaged. */
      limit?: true
      /** The identifier prefix the stream's first event claims; absent only when the stream did not read. */
      pre?: string
      duplicity?: true
      state?: KeyState | null
      history: HistoryEntry[]
    }

const SEAL_KEYS = ['i', 's', 'd', 'rd', 'bi', 'ri', 'n', 'p', 'dt']

/** Replay a KEL stream: SAIDs, inception, order, priors, pre-rotation, controller signatures, seal shape, duplicity. */
export function replayKel(dig: Digest, bytes: Uint8Array): Replay {
  const read = readKelStream(bytes)
  if (!read.ok) return { ok: false, reason: `${read.reason}: ${read.detail}`, cesr: read.reason, history: [] }
  const history: HistoryEntry[] = []
  let st: KeyState | null = null
  const seen = new Map<number, string>()
  const claimed = read.frames[0]?.body.pre
  for (const f of read.frames) {
    const b = f.body
    const fail = (reason: string, limit?: true): Replay => ({
      ok: false,
      reason: `sn ${b.sn} ${b.ilk}: ${reason}`,
      ...(limit ? { limit } : {}),
      pre: claimed,
      state: st,
      history,
    })

    // A code outside ./codes.ts is one Keyring cannot verify, reported (and refused) before anything uses it: an unknown key code would
    // otherwise count as a missing signature (and read as an edited KEL), and an unknown digest code would throw.
    const badDigest = [b.said, ...b.ndigs].find((x) => !DIGESTS[x[0]])
    if (badDigest !== undefined) return fail(`digest code ${badDigest[0]}`, true)
    const badKey = b.keys.find((k) => !keyCode(k))
    if (badKey !== undefined) return fail(`key code ${badKey[0]}`, true)
    if (!DIGESTS[b.pre[0]] && !keyCode(b.pre)) return fail(`prefix code ${b.pre[0]}`, true)

    // A self-addressing prefix may use another digest code than the SAID (keripy Habery: prefix SHA2-256 'I',
    // event SAID Blake3 'E'), so 'i' is dummied too and checked on its own.
    const selfAddr = b.ilk === 'icp' && ['E', 'I'].includes(b.pre[0]) && b.pre.length === 44
    if (selfAddr && b.pre !== b.said) {
      const dummied = b.text
        .split(`"d":"${b.said}"`)
        .join(`"d":"${DUMMY}"`)
        .split(`"i":"${b.pre}"`)
        .join(`"i":"${DUMMY}"`)
      if (dig(b.pre[0], te.encode(dummied)) !== b.pre) return fail('self-addressing prefix does not recompute')
      if (dig(b.said[0], te.encode(dummied)) !== b.said) return fail('SAID does not recompute')
    } else if (saidOfRaw(dig, b.text, b.said, selfAddr ? ['d', 'i'] : ['d']) !== b.said) {
      return fail('SAID does not recompute')
    }

    if (seen.has(b.sn)) {
      if (seen.get(b.sn) !== b.said)
        return { ok: false, duplicity: true, reason: `duplicity at sn ${b.sn}`, pre: claimed, state: st, history }
      continue
    }

    // Before the order checks, so a delegated event (dip, drt) is reported as the limit it is, not as out of order.
    if (b.ilk !== 'icp' && b.ilk !== 'rot' && b.ilk !== 'ixn') return fail(`ilk ${b.ilk}`, true)

    let keys: string[], ndigs: string[], wits: string[], toad: number
    if (b.ilk === 'icp') {
      if (st) return fail('second inception')
      if (b.sn !== 0) return fail('icp sn must be 0')
      keys = b.keys
      ndigs = b.ndigs
      wits = b.backs
      toad = b.bn ?? 0
    } else {
      if (!st) return fail('event before inception')
      if (b.pre !== st.pre) return fail('wrong prefix')
      if (b.sn !== st.sn + 1) return fail(`out of order (have ${st.sn})`)
      if (b.prior !== st.said) return fail('prior digest does not match')
      if (b.ilk === 'rot') {
        const committed = st.ndigs
        const unrevealed = b.keys.find((k) => !committed.some((n) => dig(n[0], te.encode(k)) === n))
        if (unrevealed) return fail(`revealed key ${unrevealed.slice(0, 12)}… not committed by prior next digest`)
        keys = b.keys
        ndigs = b.ndigs
        wits = b.backs.length ? b.backs : st.wits
        toad = b.bn ?? st.toad
      } else {
        keys = st.keys
        ndigs = st.ndigs
        wits = st.wits
        toad = st.toad
      }
    }

    // Controller signatures, against the threshold (a number here; weighted thresholds are not read).
    const sigs = f.groups.filter((g) => g.name === 'ControllerIdxSigs').flatMap((g) => g.items)
    const kt = Number(b.kt || 1)
    if (!Number.isInteger(kt) || kt < 1) return fail(`signing threshold ${b.kt}`, true)
    let good = 0
    for (const s of sigs) {
      const k = keys[s.index]
      if (k && verifySignature(k, s, b.raw)) good++
    }
    if (good < kt) return fail(`controller signatures ${good}/${kt}`)
    // No witness receipts are read: a KEL that names witnesses cannot meet its threshold here and is refused.
    if (toad > 0) return fail(`witnesses (bt ${toad}; receipts are not read)`, true)

    const anchors = b.seals ?? []
    if (
      anchors.some(
        (s) => !s || typeof s !== 'object' || Array.isArray(s) || !Object.keys(s).every((k) => SEAL_KEYS.includes(k))
      )
    )
      return fail('malformed seal in "a"')

    st = { pre: b.pre, sn: b.sn, said: b.said, keys, ndigs, wits, toad, ilk: b.ilk }
    seen.set(b.sn, b.said)
    history[b.sn] = { ...st, seals: b.ilk === 'ixn' ? anchors : [], anchors, receipts: 0, sigs: good }
  }
  return st ? { ok: true, state: st, history } : { ok: false, reason: 'no events', pre: claimed, history }
}
