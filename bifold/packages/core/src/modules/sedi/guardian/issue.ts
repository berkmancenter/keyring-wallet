/**
 * Building what a Keyring phone ISSUES as a KERI controller: a credential registry (its TEL), an ACDC v2 credential,
 * the registry updates that issue and revoke it, and the holder's proof (the ACDC followed by its blinded state
 * disclosure). Written in exactly the forms this package's own checks read (./chain.ts: verifyTel, stateOf,
 * parseProof, verifyAcdcV2), which are the K0 kit's forms (keripy 7143832; fixtures k0-utah-v2, e.g. tel-S2-social-*,
 * acdc-S2-social*). Used by the guardian's phone to issue the Social Authorization (S2) to the person it cares for.
 *
 * Pure: no keys, no storage, no network, and no clock. The caller passes the times (as ISO strings, never parsed here:
 * sedi/ parses a date only in readExpiry) and the randomness (the agent's KMS). Signing and anchoring are the
 * caller's: each registry event this builds must be anchored by a seal in the issuer's own KEL, which the caller signs
 * (sedi/holder/controller appendInteraction).
 *
 * @module sedi/guardian/issue
 */
import { b64Encode } from '../cesr/qb64'
import { b64Int } from '../identity/keriEvents'

import { DUMMY, saidOfRaw, type Digest } from './kel'
import { SEDI_SCHEMAS, blidOf, labelQb64, saidifyAcdcV2, type Blinder, type Sad } from './chain'

const te = new TextEncoder()
/** Random bytes of a given length (the agent's KMS, agent.kms.randomBytes). */
export type Random = (length: number) => Uint8Array

/** qb64 of `raw` under a code of `code.length` characters (1 or 2): the code's lead bytes, then the raw bytes. */
function qb64(code: string, raw: Uint8Array): string {
  const lead = code.length === 1 ? 1 : 2
  const padded = new Uint8Array(lead + raw.length)
  padded.set(raw, lead)
  return code + b64Encode(padded).slice(code.length)
}

const fresh = (random: Random, length: number): Uint8Array => {
  const bytes = random(length)
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) throw new Error('the key store gave no random bytes')
  return bytes
}

/** A salty nonce, as keripy writes the `u` of a block or a registry: Salt_128 ('0A', 24 characters). */
export const salt128 = (random: Random): string => qb64('0A', fresh(random, 16))

/** A blinding nonce, as keripy writes a blinded state's uuid: Salt_256 ('a', 44 characters). */
export const salt256 = (random: Random): string => qb64('a', fresh(random, 32))

/** The text of a registry or ACDC event with its version string carrying its own size ('ACDC' + v2 JSON). */
function withAcdcSize(fields: Record<string, unknown>): string {
  const draft = JSON.stringify({ v: 'ACDCCAACAAJSONAAAA.', ...fields })
  const size = te.encode(draft).length
  return JSON.stringify({ v: `ACDCCAACAAJSON${b64Int(size, 4)}.`, ...fields })
}

/** An event's SAID (Blake3, 'E') over its text with `d` dummied, as verifyTel recomputes it (saidOfRaw). */
function saided(dig: Digest, fields: Record<string, unknown>): { text: string; said: string } {
  const dummied = withAcdcSize({ ...fields, d: DUMMY })
  const said = dig('E', te.encode(dummied))
  const text = withAcdcSize({ ...fields, d: said })
  if (saidOfRaw(dig, text, said, ['d']) !== said) throw new Error('a registry event SAID does not recompute')
  return { text, said }
}

/** A registry inception (TEL `rip`) by `issuer` at `dt`. Its SAID is the registry's id (`rd`), and its own seal's `d`. */
export function registryInception(
  dig: Digest,
  issuer: string,
  dt: string,
  random: Random
): { text: string; rd: string } {
  const { text, said } = saided(dig, { t: 'rip', d: DUMMY, u: salt128(random), i: issuer, n: '0', dt })
  return { text, rd: said }
}

/**
 * A registry update (TEL `bup`), number `n` (1: the issuance, 2: the revocation), after the event with SAID `prior`,
 * binding the blinded state `blid` (the state disclosed only to whoever holds the proof).
 */
export function registryUpdate(
  dig: Digest,
  rd: string,
  n: number,
  prior: string,
  dt: string,
  blid: string
): { text: string; said: string } {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('a registry update follows the inception')
  return saided(dig, { t: 'bup', d: DUMMY, rd, n: n.toString(16), p: prior, dt, b: blid })
}

/** The seal an issuer's KEL carries for a registry event: `{ i: rd, s: n (hex), d: its SAID }`. */
export const sealOf = (rd: string, n: number, said: string) => ({ i: rd, s: n.toString(16), d: said })

/** A blinded state: the credential `td` is `ts` ('issued' or 'revoked'), under a fresh uuid. */
export function blindedState(dig: Digest, td: string, ts: 'issued' | 'revoked', random: Random): Blinder {
  const uuid = salt256(random)
  return { blid: blidOf(dig, { uuid, td, ts }), uuid, td, ts }
}

/**
 * The holder's proof: the ACDC text, then its BlindedStateQuadruples group (`-aAj`: blid, uuid, td, state label)
 * inside one attachment group (`-C`), exactly as parseProof reads it.
 */
export function proofOf(acdcText: string, b: Blinder): string {
  const quadruple = b.blid + b.uuid + (b.td || '1AAP') + labelQb64(b.ts)
  if (quadruple.length % 4 !== 0) throw new RangeError('a blinded state quadruple is a whole number of quadlets')
  const group = '-a' + b64Int(quadruple.length / 4, 2) + quadruple
  return acdcText + '-C' + b64Int(group.length / 4, 2) + group
}

/** The rules text the K0 kit's credentials carry: they are test credentials, not legal instruments. */
const RULES = 'Test only. Not a legal instrument.'

/** A placeholder SAID for saidifyAcdcV2 to replace: its code letter ('E', Blake3) is what it reads. */
const PLACEHOLDER = 'E' + '#'.repeat(43)

/**
 * The Social Authorization (S2) a guardian issues the person it cares for: issued by the guardian's own AID (the
 * Guardian card's holder), to `ward` (the card's own ward), in registry `rd`, with an I2I `guardian` edge to the
 * Guardian credential `guardianSaid`. Its fields and their order are the K0 kit's (acdc-S2-social.json).
 */
export function socialAuthorization(
  dig: Digest,
  args: { issuer: string; ward: string; rd: string; guardianSaid: string; issued: string; expires: string },
  random: Random
): { sad: Sad; text: string } {
  const template: Sad = {
    v: 'ACDCCAACAAJSONAAAA.',
    t: 'acm',
    d: PLACEHOLDER,
    u: salt128(random),
    i: args.issuer,
    rd: args.rd,
    s: SEDI_SCHEMAS.social,
    a: {
      d: PLACEHOLDER,
      u: salt128(random),
      i: args.ward,
      issued: args.issued,
      expires: args.expires,
      rc: { myEmptySpace: ['all'] },
    },
    e: {
      d: PLACEHOLDER,
      u: salt128(random),
      guardian: {
        d: PLACEHOLDER,
        u: salt128(random),
        n: args.guardianSaid,
        s: SEDI_SCHEMAS.guardian,
        o: 'I2I',
      },
    },
    r: { d: PLACEHOLDER, l: RULES },
  } as unknown as Sad
  const sad = saidifyAcdcV2(dig, template)
  return { sad, text: JSON.stringify(sad) }
}

/**
 * Any ACDC v2 from a template whose `d`s are placeholders (for the tests' own state kit, which issues the chain a
 * Guardian card stands on). Production issues only {@link socialAuthorization}.
 */
export function acdcFromTemplate(dig: Digest, template: Sad): { sad: Sad; text: string } {
  const sad = saidifyAcdcV2(dig, template)
  return { sad, text: JSON.stringify(sad) }
}

export { PLACEHOLDER as SAID_PLACEHOLDER }
