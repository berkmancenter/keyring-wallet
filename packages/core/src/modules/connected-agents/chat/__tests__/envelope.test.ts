/**
 * Signed chat and control envelopes (plan §7.9; backlog 2, fb-C2), against the shared vectors
 * (`vectors/control-messages.json`, #1074, generated independently of both implementations): every `valid` vector
 * verifies, and every `refuse` vector is refused for its stated reason. Then Keyring's own signing, the version rule,
 * the freshness edges, and the order of the record and the act.
 */
import { DidKey, TypedArrayEncoder } from '@credo-ts/core'
import { ed25519 } from '@noble/curves/ed25519.js'

import vectors from '../../vectors/control-messages.json'
import {
  ENVELOPE_TYPE,
  buildEnvelope,
  envelopeBaseType,
  receiveEnvelope,
  signEnvelope,
  verifyEnvelope,
  type EnvelopeRefusal,
  type SignedEnvelope,
} from '../envelope'
import { MemorySeenIdStore } from '../seenIds'

/** An agent that resolves any did:key locally and signs with one Ed25519 key. */
function didKeySigner() {
  const secret = ed25519.utils.randomSecretKey()
  const publicKey = ed25519.getPublicKey(secret)
  const did = `did:key:z${TypedArrayEncoder.toBase58(new Uint8Array([0xed, 0x01, ...publicKey]))}`
  const agent = {
    dids: {
      resolveDidDocument: async (d: string) => DidKey.fromDid(d).didDocument,
      getCreatedDids: async () => [],
    },
    dependencyManager: {
      resolve: () => ({
        sign: async ({ data }: { data: Uint8Array }) => ({ signature: ed25519.sign(data, secret) }),
      }),
    },
  }
  return { did, agent: agent as never }
}

/** A receiver needs only to resolve did:key; it signs nothing. */
const verifier = didKeySigner().agent

/** The vectors spell one refusal with a hyphen. */
const REASON: Record<string, EnvelopeRefusal> = {
  stale: 'stale',
  future: 'future',
  repeated: 'repeated',
  recipient: 'recipient',
  proof: 'proof',
  'older-state': 'olderState',
}

type Vector = (typeof vectors.valid)[number] & {
  seenIds?: string[]
  lastApplied?: Record<string, string>
  reason?: string
}

async function seenFor(vector: Vector) {
  const seen = new MemorySeenIdStore()
  const now = new Date(vector.receiver.now)
  for (const id of vector.seenIds ?? []) await seen.claim(vector.receiver.did, id, vector.receiver.now, now)
  for (const [type, at] of Object.entries(vector.lastApplied ?? {})) {
    await seen.markApplied(vector.receiver.did, envelopeBaseType(type), at)
  }
  return seen
}

const checkVector = async (vector: Vector) =>
  verifyEnvelope(verifier, vector.document, {
    receiver: vector.receiver.did,
    issuer: vector.receiver.expectedIssuer,
    seen: await seenFor(vector),
    now: new Date(vector.receiver.now),
  })

describe('the shared vectors (control-messages.json, version 1)', () => {
  it('are the version these tests were written against', () => {
    expect(vectors.version).toBe(1)
    expect(vectors.valid.length).toBeGreaterThan(0)
    expect(vectors.refuse.length).toBeGreaterThan(0)
  })

  it.each(vectors.valid.map((v) => [v.name, v] as const))('valid: %s verifies', async (_name, vector) => {
    const check = await checkVector(vector)
    expect(check).toEqual({ result: 'ok', envelope: vector.document })
  })

  it.each(vectors.refuse.map((v) => [v.name, v] as const))('refuse: %s', async (_name, vector) => {
    const reason = REASON[vector.reason]
    expect(reason).toBeDefined()
    const check = await checkVector(vector as Vector)
    expect(check.result).toBe(reason)
  })

  it('a refused vector records nothing', async () => {
    for (const vector of vectors.refuse as Vector[]) {
      const seen = await seenFor(vector)
      const before = seen.ids.size
      await verifyEnvelope(verifier, vector.document, {
        receiver: vector.receiver.did,
        issuer: vector.receiver.expectedIssuer,
        seen,
        now: new Date(vector.receiver.now),
      })
      expect(seen.ids.size).toBe(before)
    }
  })

  it('control: the same document a second time is repeated', async () => {
    const vector = vectors.valid[0]
    const expectation = {
      receiver: vector.receiver.did,
      issuer: vector.receiver.expectedIssuer,
      seen: new MemorySeenIdStore(),
      now: new Date(vector.receiver.now),
    }
    expect((await verifyEnvelope(verifier, vector.document, expectation)).result).toBe('ok')
    expect((await verifyEnvelope(verifier, vector.document, expectation)).result).toBe('repeated')
  })
})

describe("Keyring's own envelopes", () => {
  const keyring = didKeySigner()
  const agentSide = didKeySigner()
  const NOW = new Date('2026-11-27T12:00:00.250Z')
  const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000)

  const chat = (overrides: Partial<Parameters<typeof buildEnvelope>[0]> = {}) =>
    buildEnvelope({
      type: ENVELOPE_TYPE.chat,
      recipient: agentSide.did,
      payload: { profile: 'keyring.chat/1', eventId: 'e1', type: 'message', content: { text: 'hi' } },
      now: NOW,
      ...overrides,
    })

  const expectation = (overrides: { now?: Date; seen?: MemorySeenIdStore } = {}) => ({
    receiver: agentSide.did,
    issuer: keyring.did,
    seen: overrides.seen ?? new MemorySeenIdStore(),
    now: overrides.now ?? NOW,
  })

  /** A document as a peer at another version would sign it: the envelope builder only writes Keyring's own. */
  const signedAs = (signer: ReturnType<typeof didKeySigner>, doc: Record<string, unknown>) =>
    signEnvelope(signer.agent, doc as never, signer.did)

  it('builds every envelope member: a urn:uuid id, whole-second issuedAt and the payload version', () => {
    const doc = chat()
    expect(doc.id).toMatch(/^urn:uuid:[0-9a-f-]{36}$/)
    expect(doc.issuedAt).toBe('2026-11-27T12:00:00Z')
    expect(doc.payload.version).toBe('1.0')
    expect(doc.recipient).toBe(agentSide.did)
  })

  it('signs as chatDid for assertionMethod with eddsa-jcs-2022, and the peer verifies it', async () => {
    const signed = await signEnvelope(keyring.agent, chat(), keyring.did)
    expect(signed.issuer).toBe(keyring.did)
    expect(signed.proof).toMatchObject({
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      proofPurpose: 'assertionMethod',
    })
    expect(String(signed.proof.verificationMethod).startsWith(`${keyring.did}#`)).toBe(true)
    expect((await verifyEnvelope(verifier, signed, expectation())).result).toBe('ok')
  })

  it('a resend keeps its id, and the receiver that has it calls it repeated', async () => {
    const first = await signEnvelope(keyring.agent, chat(), keyring.did)
    const resend = await signEnvelope(keyring.agent, chat({ id: first.id, now: at(30) }), keyring.did)
    expect(resend.id).toBe(first.id)
    const seen = new MemorySeenIdStore()
    expect((await verifyEnvelope(verifier, first, expectation({ seen }))).result).toBe('ok')
    expect((await verifyEnvelope(verifier, resend, expectation({ seen, now: at(30) }))).result).toBe('repeated')
  })

  it('re-signing a signed envelope replaces its proof and keeps its id', async () => {
    const first = await signEnvelope(keyring.agent, chat(), keyring.did)
    const again = await signEnvelope(keyring.agent, first, keyring.did)
    expect(again.id).toBe(first.id)
    expect((await verifyEnvelope(verifier, again, expectation())).result).toBe('ok')
  })

  it('refuses to sign a document naming another issuer, or one that is not an envelope', async () => {
    await expect(signEnvelope(keyring.agent, { ...chat(), issuer: agentSide.did }, keyring.did)).rejects.toThrow(
      /issuer/
    )
    await expect(signEnvelope(keyring.agent, { ...chat(), id: 'not-a-urn' }, keyring.did)).rejects.toThrow(/urn:uuid/)
  })

  it('a document signed by another key, or naming another issuer, is a proof refusal', async () => {
    const intruder = didKeySigner()
    const byIntruder = await signedAs(intruder, chat())
    expect((await verifyEnvelope(verifier, byIntruder, expectation())).result).toBe('proof')
    const claimed = { ...byIntruder, issuer: keyring.did }
    expect((await verifyEnvelope(verifier, claimed, expectation())).result).toBe('proof')
  })

  it('a proof made for authentication is a proof refusal', async () => {
    const signed = await signEnvelope(keyring.agent, chat(), keyring.did)
    const tampered = { ...signed, proof: { ...signed.proof, proofPurpose: 'authentication' } }
    expect((await verifyEnvelope(verifier, tampered, expectation())).result).toBe('proof')
  })

  describe('the version rule (§7.9)', () => {
    it('accepts a higher minor and ignores the members it does not know', async () => {
      const doc = { ...chat(), type: 'keyring/chat/1.3', payload: { ...chat().payload, version: '1.3', mood: 'x' } }
      const check = await verifyEnvelope(verifier, await signedAs(keyring, doc), expectation())
      expect(check.result).toBe('ok')
    })

    it('a higher minor that lacks a member Keyring needs is versionMismatch, and is not recorded', async () => {
      const payload: Record<string, unknown> = { ...chat().payload, version: '1.1' }
      delete payload.eventId
      const seen = new MemorySeenIdStore()
      const doc = await signedAs(keyring, { ...chat(), type: 'keyring/chat/1.1', payload })
      expect((await verifyEnvelope(verifier, doc, expectation({ seen }))).result).toBe('versionMismatch')
      expect(seen.ids.size).toBe(0)
    })

    it("at Keyring's own version, a missing member is malformed", async () => {
      const payload: Record<string, unknown> = { ...chat().payload }
      delete payload.eventId
      const doc = await signedAs(keyring, { ...chat(), payload })
      expect((await verifyEnvelope(verifier, doc, expectation())).result).toBe('malformed')
    })

    it.each([
      ['keyring/chat/2.0', '2.0'],
      ['keyring/chat/1.0', '2.0'],
      ['keyring/chat/2.0', '1.0'],
      ['keyring/chat/0.9', '0.9'],
    ])('another major (%s, payload %s) is versionMismatch and is never acted on', async (type, version) => {
      const doc = await signedAs(keyring, { ...chat(), type, payload: { ...chat().payload, version } })
      const act = jest.fn(async () => undefined)
      const { check } = await receiveEnvelope(verifier, doc, expectation(), act)
      expect(check.result).toBe('versionMismatch')
      expect(act).not.toHaveBeenCalled()
    })

    it('a forged document at another major is a proof refusal, never versionMismatch', async () => {
      const doc = await signedAs(didKeySigner(), { ...chat(), type: 'keyring/chat/2.0' })
      expect((await verifyEnvelope(verifier, doc, expectation())).result).toBe('proof')
    })

    it('a type of Keyring’s major that it does not know is unknownType', async () => {
      const doc = await signedAs(keyring, { ...chat(), type: 'keyring/agent/something-new/1.1' })
      expect((await verifyEnvelope(verifier, doc, expectation())).result).toBe('unknownType')
    })
  })

  describe('freshness (300 s ahead, 604 800 s behind)', () => {
    it.each([
      [300, 'ok'],
      [301, 'future'],
      [-604_800, 'ok'],
      [-604_801, 'stale'],
    ])('issued %i s from the receiver’s now is %s', async (offset, result) => {
      const doc = await signEnvelope(keyring.agent, chat({ now: at(offset) }), keyring.did)
      // `at` is 0.25 s past the second; the envelope's whole-second issuedAt is measured against the second itself.
      const now = new Date(Math.floor(NOW.getTime() / 1000) * 1000)
      expect((await verifyEnvelope(verifier, doc, expectation({ now }))).result).toBe(result)
    })
  })

  it('a recipient other than the receiver is refused', async () => {
    const doc = await signEnvelope(keyring.agent, chat({ recipient: didKeySigner().did }), keyring.did)
    expect((await verifyEnvelope(verifier, doc, expectation())).result).toBe('recipient')
  })

  it.each([
    ['not an object', 'text'],
    ['no id', { ...chat(), id: undefined }],
    ['no payload version', { ...chat(), payload: { profile: 'keyring.chat/1' } }],
    ['issuedAt not a date', { ...chat(), issuedAt: 'soon' }],
  ])('%s is malformed', async (_name, doc) => {
    expect((await verifyEnvelope(verifier, doc, expectation())).result).toBe('malformed')
  })

  describe('receiveEnvelope: the record before the act', () => {
    it('the id is recorded before the handler runs', async () => {
      const seen = new MemorySeenIdStore()
      const doc = await signEnvelope(keyring.agent, chat(), keyring.did)
      let seenWhenActing: boolean | undefined
      const { check, acted } = await receiveEnvelope(verifier, doc, expectation({ seen }), async (envelope) => {
        seenWhenActing = await seen.seen(agentSide.did, envelope.id, NOW)
        return 'done'
      })
      expect(check.result).toBe('ok')
      expect(acted).toBe('done')
      expect(seenWhenActing).toBe(true)
    })

    it('a handler that throws still leaves the id recorded: the document never acts twice', async () => {
      const seen = new MemorySeenIdStore()
      const doc = await signEnvelope(keyring.agent, chat(), keyring.did)
      await expect(
        receiveEnvelope(verifier, doc, expectation({ seen }), async () => {
          throw new Error('crashed while acting')
        })
      ).rejects.toThrow('crashed')
      const act = jest.fn(async () => undefined)
      expect((await receiveEnvelope(verifier, doc, expectation({ seen }), act)).check.result).toBe('repeated')
      expect(act).not.toHaveBeenCalled()
    })

    it('settings: once one is applied, one not newer is olderState, and a newer one applies', async () => {
      const seen = new MemorySeenIdStore()
      const settings = (seconds: number) =>
        signEnvelope(
          keyring.agent,
          buildEnvelope({
            type: ENVELOPE_TYPE.settings,
            recipient: agentSide.did,
            payload: { answersOthers: seconds > 0, locale: 'en' },
            now: at(seconds),
          }),
          keyring.did
        )
      const apply = async (doc: SignedEnvelope) =>
        (await receiveEnvelope(verifier, doc, expectation({ seen, now: at(120) }), async () => undefined)).check.result
      expect(await apply(await settings(0))).toBe('ok')
      expect(await seen.lastApplied(agentSide.did, 'keyring/agent/settings')).toBe('2026-11-27T12:00:00Z')
      expect(await apply(await settings(0))).toBe('olderState')
      expect(await apply(await settings(-60))).toBe('olderState')
      expect(await apply(await settings(60))).toBe('ok')
    })

    it('control: a chat message is not a state type, so an older one after a newer still applies', async () => {
      const seen = new MemorySeenIdStore()
      const act = async () => undefined
      const newer = await signEnvelope(keyring.agent, chat({ now: at(60) }), keyring.did)
      const older = await signEnvelope(keyring.agent, chat(), keyring.did)
      expect((await receiveEnvelope(verifier, newer, expectation({ seen, now: at(60) }), act)).check.result).toBe('ok')
      expect((await receiveEnvelope(verifier, older, expectation({ seen, now: at(60) }), act)).check.result).toBe('ok')
    })
  })
})
