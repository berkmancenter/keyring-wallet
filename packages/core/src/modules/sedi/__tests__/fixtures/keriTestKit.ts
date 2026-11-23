/**
 * Tests only: a small in-memory KERI controller (one transferable P-256 AID, its KEL, interaction events), and a test
 * state that issues the K0-shaped chain (root → org unit → issuing agent → Guardian card) to any holder AID. With them
 * a test can stand a Guardian card on a holder whose key it holds, which the K0 fixtures cannot (their keys were never
 * kept), and so test what that holder ISSUES (the Social Authorization, S2) against this package's own verifier.
 *
 * KEL events are written exactly as sedi/guardian/kel.ts replays them and the K0 kit writes them (kel-jordan.cesr);
 * registries and credentials come from the production builders (../../guardian/issue), so the round trip tests those.
 */
import { p256 } from '@noble/curves/nist.js'
import { randomBytes } from '@noble/hashes/utils.js'

import { SEDI_SCHEMAS, type Blinder, type Sad } from '../../guardian/chain'
import {
  SAID_PLACEHOLDER as P,
  acdcFromTemplate,
  blindedState,
  proofOf,
  registryInception,
  registryUpdate,
  salt128,
  sealOf,
  type Random,
} from '../../guardian/issue'
import { digest } from '../../guardian/kel'
import {
  inceptionBody,
  indexedP256Sig,
  interactionBody,
  nextKeyDigest,
  p256KeyQb64,
  signedEvent,
  type EventBody,
} from '../../identity/keriEvents'

const te = new TextEncoder()

export const random: Random = (n) => randomBytes(n)

/** One AID's controller: its key, its KEL so far (CESR text), and interaction events that anchor seals. */
export class TestController {
  readonly aid: string
  kel: string
  sn = 0
  said: string
  private readonly sk: Uint8Array
  /** Interaction events signed (each a seal list), for rows that assert what was or was not anchored. */
  readonly anchored: Record<string, string>[][] = []

  constructor() {
    this.sk = p256.utils.randomSecretKey()
    const key = p256KeyQb64(p256.getPublicKey(this.sk, true))
    const next = p256KeyQb64(p256.getPublicKey(p256.utils.randomSecretKey(), true))
    const body = inceptionBody(key, nextKeyDigest(next))
    this.aid = body.pre
    this.said = body.said
    this.kel = this.signed(body)
  }

  private signed(body: EventBody): string {
    return signedEvent(body, [indexedP256Sig(p256.sign(body.raw, this.sk, { prehash: true }), 0)])
  }

  /** Sign and append an interaction event anchoring `seals`. */
  anchor(seals: Record<string, string>[]): { sn: number; said: string } {
    const body = interactionBody(this.aid, this.sn + 1, this.said, seals)
    this.kel += this.signed(body)
    this.sn = body.sn
    this.said = body.said
    this.anchored.push(seals)
    return { sn: body.sn, said: body.said }
  }

  /** The holder-controller interface the S2 issuer uses (trust-tasks/socialAuthorization HolderController). */
  readonly api = {
    holderCodeOf: async () => this.aid,
    holderKel: async () => te.encode(this.kel),
    appendInteraction: async (_agent: unknown, seals: Array<{ i: string; s: string; d: string }>) => this.anchor(seals),
  }
}

/** One credential a test state issued: its registry, its text, and its current blinded state. */
interface Issued {
  sad: Sad
  text: string
  rd: string
  ripText: string
  updateTexts: string[]
  blinder: Blinder
  issuer: TestController
}

const NOW = '2026-11-13T00:00:00.000Z'

function issue(by: TestController, template: Sad): Issued {
  const rip = registryInception(digest, by.aid, NOW, random)
  const { sad, text } = acdcFromTemplate(digest, { ...template, i: by.aid, rd: rip.rd } as Sad)
  const blinder = blindedState(digest, sad.d, 'issued', random)
  const bup = registryUpdate(digest, rip.rd, 1, rip.rd, NOW, blinder.blid)
  by.anchor([sealOf(rip.rd, 0, rip.rd), sealOf(rip.rd, 1, bup.said)])
  return { sad, text, rd: rip.rd, ripText: rip.text, updateTexts: [bup.text], blinder, issuer: by }
}

/** Revoke `c`: the second registry update, anchored in its issuer's KEL. Returns the revoked disclosure. */
export function revoke(c: Issued): void {
  const blinder = blindedState(digest, c.sad.d, 'revoked', random)
  const prior = JSON.parse(c.updateTexts[c.updateTexts.length - 1]).d as string
  const bup = registryUpdate(digest, c.rd, 2, prior, NOW, blinder.blid)
  c.issuer.anchor([sealOf(c.rd, 2, bup.said)])
  c.updateTexts = [...c.updateTexts, bup.text]
  c.blinder = blinder
}

const block = (fields: Record<string, unknown>) => ({ d: P, u: salt128(random), ...fields })
const edge = (n: string, s: string) => block({ n, s, o: 'I2I' })
const rules = { d: P, l: 'Test only. Not a legal instrument.' }

/**
 * A test state (root, org unit, issuing agent), and a Guardian card it issues to `holder` naming `ward`. The card's
 * evidence is shaped as the phone keeps it (trust-tasks/guardianEvidence GuardianEvidence).
 */
export function testState() {
  const root = new TestController()
  const unitAid = new TestController()
  const agentAid = new TestController()
  const unit = issue(root, {
    v: 'ACDCCAACAAJSONAAAA.',
    t: 'acm',
    d: P,
    u: salt128(random),
    i: '',
    rd: '',
    s: SEDI_SCHEMAS.orgUnit,
    a: block({ i: unitAid.aid, issuedDate: NOW, unit: 'TestSediProgramOffice' }),
    r: rules,
  } as unknown as Sad)
  const agentCred = issue(unitAid, {
    v: 'ACDCCAACAAJSONAAAA.',
    t: 'acm',
    d: P,
    u: salt128(random),
    i: '',
    rd: '',
    s: SEDI_SCHEMAS.issuingAgent,
    a: block({ i: agentAid.aid, issuedDate: NOW, role: 'SediIssuingAgent', name: block({ value: 'Test Agent' }) }),
    e: block({ orgUnit: edge(unit.sad.d, SEDI_SCHEMAS.orgUnit) }),
    r: rules,
  } as unknown as Sad)

  const guardianFor = (holder: string, ward: string, expires = '2030-11-10T00:00:00.000Z') =>
    issue(agentAid, {
      v: 'ACDCCAACAAJSONAAAA.',
      t: 'acm',
      d: P,
      u: salt128(random),
      i: '',
      rd: '',
      s: SEDI_SCHEMAS.guardian,
      a: block({
        i: holder,
        role: 'parent',
        ward,
        issuedDate: block({ value: NOW }),
        expirationDate: block({ value: expires }),
      }),
      e: block({ utahAgent: edge(agentCred.sad.d, SEDI_SCHEMAS.issuingAgent) }),
      r: rules,
    } as unknown as Sad)

  /** A card's evidence as the phone keeps it: the three state KELs, three registries and three proofs. */
  const evidenceOf = (g: Issued, opts: { omitRevocation?: boolean } = {}) => {
    const shown = (c: Issued) =>
      opts.omitRevocation && c === g && c.updateTexts.length > 1
        ? { updateTexts: c.updateTexts.slice(0, 1), blinder: issuedBlinders.get(c)! }
        : { updateTexts: c.updateTexts, blinder: c.blinder }
    return {
      guardianSaid: g.sad.d,
      holder: g.sad.a!.i as string,
      kels: [root.kel, unitAid.kel, agentAid.kel],
      tels: [unit, agentCred, g].map((c) => ({ ripText: c.ripText, updateTexts: shown(c).updateTexts })),
      creds: [unit, agentCred, g].map((c) => proofOf(c.text, shown(c).blinder)),
    }
  }
  const issuedBlinders = new Map<Issued, Blinder>()
  const guardian = (holder: string, ward: string, expires?: string) => {
    const g = guardianFor(holder, ward, expires)
    issuedBlinders.set(g, g.blinder)
    return g
  }

  return { root, unitAid, agentAid, unit, agentCred, guardian, evidenceOf }
}
