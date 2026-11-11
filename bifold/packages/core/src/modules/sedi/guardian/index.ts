/**
 * The Guardian check's entry points (trusted-approver plan, stage 2, S1/S2), behind the state-verified approvers switch
 * (isStateVerifiedApproversEnabled, with STATE_VERIFIED_APPROVERS_REMOTE_OFF and SEDI_KERI_REMOTE_OFF). Off, they
 * refuse with `switchedOff` and read nothing.
 *
 * Material is the raw chain a guardian's phone would present: every KEL stream involved, every registry (rip and its
 * updates), and every credential's proof (ACDC text followed by its state disclosure). How that material travels from
 * the guardian's phone is not built yet.
 *
 * @module sedi/guardian
 */
import { isStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'

import {
  MalformedMaterial,
  guardianIn,
  parseObject,
  socialIn,
  type ChainContext,
  type GuardianResult,
  type SocialResult,
  type TelInput,
} from './chain'
import { DIGESTS } from '../cesr/codes'

import { digest, replayKel, type Digest, type Replay } from './kel'

export { SEDI_SCHEMAS, type RefusalReason } from './chain'

export interface ChainMaterial {
  kels: Uint8Array[]
  tels: TelInput[]
  creds: string[]
}

export interface CheckOptions {
  /** The State roots this phone trusts (AIDs). */
  trustedRoots: string[]
  now?: Date
}

/**
 * Why the presented material is refused before any chain check. Every outcome other than valid REFUSES, and none of
 * these is a statement that the material is genuine or harmless: a destructive edit can land as any of the three (an
 * edited character can make a stream unreadable, or name a code Keyring lacks). They are kept apart, and must never
 * collapse into one, for log fidelity only, not as a safety property: each says what stopped the check.
 * - `unsupportedCesr`: Keyring can't verify this. It uses a code or a KERI feature (a delegated event, a weighted
 *   threshold, witnesses, a digest code other than E/I) that this package does not verify yet.
 * - `malformedCesr`: this can't be read. A KEL stream does not add up as CESR (cut short, counts wrong, trailing
 *   bytes, empty), a credential's or TEL event's text is not a JSON object, or one registry or credential is
 *   presented twice.
 * - `kelNotReplaying`: the stream reads, but the KEL it carries does not verify (a SAID, prior, pre-rotation or
 *   controller signature fails, or it is duplicitous), or two presented streams claim the same prefix. The material may have been constructed or edited, so the
 *   whole presentation is refused, even when that KEL is not on the chain being checked. It carries the prefix the
 *   KEL claims, and nothing of its contents.
 */
export type MaterialRefusal =
  | { ok: false; reason: 'unsupportedCesr' | 'malformedCesr'; detail: string }
  | { ok: false; reason: 'kelNotReplaying'; prefix: string; detail: string }

type Built = { ok: true; ctx: ChainContext } | MaterialRefusal

// The wording of these details matters: they are refusals, and must never read as "the material was fine".
const cannotVerify = (what: string) => `Keyring can't verify this (unsupported: ${what})`
const cannotRead = (what: string) => `this can't be read (${what})`

/** Raised only by `guarded` below, and caught only by decide(): a SAID in a credential or a TEL event under a digest
 * code this package lacks (refused, see MaterialRefusal). */
class UnsupportedDigestCode extends Error {}

/** The chain checks' digest: a code outside ./codes.ts (a credential's or TEL event's SAID, a nested block's) is a
 * code Keyring can't verify, so it is raised as UnsupportedDigestCode for decide() to refuse as unsupportedCesr, never left to
 * throw out of an entry point. Wherever the checks compute a SAID, they come through here. */
const guarded: Digest = (code, bytes) => {
  if (!DIGESTS[code]) throw new UnsupportedDigestCode(`digest code ${code} in a credential or TEL SAID`)
  return digest(code, bytes)
}

function build(material: ChainMaterial, options: CheckOptions): Built {
  const kels = new Map<string, Replay>()
  for (const bytes of material.kels) {
    const r = replayKel(digest, bytes)
    if (r.ok) {
      // Two presented KELs for one prefix contradict each other, as duplicity within one stream does: refused, never
      // resolved by which came last (a truncated copy beside the real one would otherwise choose the history read).
      if (kels.has(r.state.pre))
        return {
          ok: false,
          reason: 'kelNotReplaying',
          prefix: r.state.pre,
          detail: `two presented KELs claim ${r.state.pre}`,
        }
      kels.set(r.state.pre, r)
      continue
    }
    // Nothing presented is ever treated as if it were absent: a stream this package cannot read, one that uses a
    // feature it does not verify, and one whose KEL does not replay each refuse the whole check (see MaterialRefusal).
    if (r.cesr) {
      const what = r.reason.slice(r.cesr.length + 2)
      return { ok: false, reason: r.cesr, detail: r.cesr === 'malformedCesr' ? cannotRead(what) : cannotVerify(what) }
    }
    if (r.limit) return { ok: false, reason: 'unsupportedCesr', detail: cannotVerify(r.reason) }
    const prefix = r.pre ?? ''
    return { ok: false, reason: 'kelNotReplaying', prefix, detail: `a presented KEL (${prefix}) does not replay` }
  }
  // A registry or credential presented twice is refused the same way: one SAID, two presentations, never a winner.
  const tels = new Map<string, TelInput>()
  for (const t of material.tels) {
    const rd = parseObject<{ d: string }>(t.ripText, 'a TEL rip').d
    if (tels.has(rd)) throw new MalformedMaterial(`registry ${rd} presented twice`)
    tels.set(rd, t)
  }
  const creds = new Map<string, string>()
  for (const text of material.creds) {
    const end = text.lastIndexOf('}')
    const said = parseObject<{ d: string }>(text.slice(0, end + 1), 'a credential').d
    if (creds.has(said)) throw new MalformedMaterial(`credential ${said} presented twice`)
    creds.set(said, text)
  }
  return {
    ok: true,
    ctx: {
      digest: guarded,
      kels,
      tels,
      creds,
      trustedRoots: new Set(options.trustedRoots),
      now: options.now ?? new Date(),
    },
  }
}

const switchedOff = {
  ok: false as const,
  reason: 'switchedOff' as const,
  detail: 'state-verified approvers are switched off',
}

/**
 * The one place a verdict leaves this module: both entry points go through it, in this order. The switch; then every
 * KEL stream through the CESR reader and its replay, where any stream that does not read and replay refuses the whole
 * check (`unsupportedCesr`, `malformedCesr` or `kelNotReplaying`) before a chain check runs; then the check itself, whose `{ ok: true }` is the only way "valid" comes
 * back. The fail-closed row in guardianK0.test.ts runs every unreadable-stream case through both entry points.
 */
function decide<R>(
  material: ChainMaterial,
  options: CheckOptions,
  check: (ctx: ChainContext) => R
): R | typeof switchedOff | MaterialRefusal {
  if (!isStateVerifiedApproversEnabled()) return switchedOff
  try {
    const built = build(material, options)
    if (!built.ok) return built
    return check(built.ctx)
  } catch (e) {
    // Only these two are turned into refusals: material that can't be read, and a SAID under a digest code Keyring
    // can't verify. Anything else is a bug and still throws.
    if (e instanceof MalformedMaterial) return { ok: false, reason: 'malformedCesr', detail: cannotRead(e.message) }
    if (e instanceof UnsupportedDigestCode)
      return { ok: false, reason: 'unsupportedCesr', detail: cannotVerify(e.message) }
    throw e
  }
}

/** A Guardian credential `guardianSaid`, issued to `holder` and naming `ward`, chained to a trusted State root. */
export function verifyGuardian(
  material: ChainMaterial,
  guardianSaid: string,
  expect: { holder: string; ward: string },
  options: CheckOptions
): GuardianResult | typeof switchedOff | MaterialRefusal {
  return decide(material, options, (ctx) =>
    guardianIn(ctx, guardianSaid, { guardian: expect.holder, ward: expect.ward })
  )
}

/** A Social Authorization `socialSaid` issued to `ward`, chained to its issuer's Guardian credential (S2). */
export function verifySocialAuthorization(
  material: ChainMaterial,
  socialSaid: string,
  expect: { ward: string },
  options: CheckOptions
): SocialResult | typeof switchedOff | MaterialRefusal {
  return decide(material, options, (ctx) => socialIn(ctx, socialSaid, expect))
}
