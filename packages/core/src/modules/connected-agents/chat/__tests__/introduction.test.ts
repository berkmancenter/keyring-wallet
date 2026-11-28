/**
 * The introduction (§11 Q7, option 3): Keyring's first document to an agent, signed by the entry's granter. These
 * cases sign with a real Ed25519 did:key and verify with Keyring's own proof check, standalone. The cross-check
 * against the independently generated vectors (`vectors/introduction.json`) joins when that file lands.
 */
import { DidKey, TypedArrayEncoder } from '@credo-ts/core'
import { ed25519 } from '@noble/curves/ed25519.js'

import { verifyDocumentProof } from '../../../trust-tasks/documentProof'
import {
  INTRODUCTION_TYPE,
  buildIntroduction,
  granterOf,
  signIntroduction,
  type SignedIntroduction,
} from '../introduction'

import { fakeWhoami } from './fixtures/fakeWhoami'

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

const granter = didKeySigner()
const otherAdmin = didKeySigner()
const chat = didKeySigner()
const agentDid = didKeySigner().did
const verifier = didKeySigner().agent
const FIELDS = {
  ownerPersonaDid: 'did:webvh:QmPersona:example.org:alice',
  mediatorDid: 'did:web:mediator.example.org',
  vtaDid: 'did:webvh:QmVta:example.org:vta',
}
const NOW = new Date('2026-11-20T12:00:00.400Z')

const introduce = (by = granter) =>
  buildIntroduction({ granterDid: by.did, agentDid, chatDid: chat.did, ...FIELDS, now: NOW })

/** Valid only if signed for assertionMethod by `issuer`. */
const signedBy = (doc: SignedIntroduction, issuer: string) =>
  verifyDocumentProof(verifier, doc as never, issuer, { proofPurpose: 'assertionMethod' })

describe('building an introduction', () => {
  it('carries the envelope members and introduces chatDid, the persona, the mediator and the VTA', () => {
    const doc = introduce()
    expect(doc).toEqual({
      type: INTRODUCTION_TYPE,
      id: expect.stringMatching(/^urn:uuid:[0-9a-f-]{36}$/),
      issuer: granter.did,
      recipient: agentDid,
      issuedAt: '2026-11-20T12:00:00Z',
      payload: { version: '1.0', chatDid: chat.did, ...FIELDS },
    })
  })

  it('refuses to be issued by chatDid itself, or to leave out any member', () => {
    expect(() => buildIntroduction({ granterDid: chat.did, agentDid, chatDid: chat.did, ...FIELDS, now: NOW })).toThrow(
      /signed by the granter, not by chatDid/
    )
    for (const name of ['agentDid', 'chatDid', 'ownerPersonaDid', 'mediatorDid', 'vtaDid'] as const)
      expect(() =>
        buildIntroduction({ granterDid: granter.did, agentDid, chatDid: chat.did, ...FIELDS, [name]: ' ', now: NOW })
      ).toThrow(`an introduction needs ${name}`)
  })

  it('CONTROL: a resend keeps the first id', () => {
    const first = introduce()
    expect(
      buildIntroduction({ ...{ granterDid: granter.did, agentDid, chatDid: chat.did, ...FIELDS }, id: first.id }).id
    ).toBe(first.id)
  })
})

describe('signing it as the granter', () => {
  it('is signed by the granter for assertionMethod, and verifies against it', async () => {
    const signed = await signIntroduction(granter.agent, introduce(), granter.did)
    expect(signed.proof).toMatchObject({
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      proofPurpose: 'assertionMethod',
    })
    expect(await signedBy(signed, granter.did)).toBe(true)
  })

  it('CONTROL: it does not verify against any other DID, the chat identity included', async () => {
    const signed = await signIntroduction(granter.agent, introduce(), granter.did)
    expect(await signedBy(signed, otherAdmin.did)).toBe(false)
    expect(await signedBy(signed, chat.did)).toBe(false)
  })

  it('an altered payload no longer verifies', async () => {
    const signed = await signIntroduction(granter.agent, introduce(), granter.did)
    const altered = { ...signed, payload: { ...signed.payload, chatDid: otherAdmin.did } }
    expect(await signedBy(altered, granter.did)).toBe(false)
  })

  it('refuses a document whose issuer is not the signer, and a document of another type', async () => {
    await expect(signIntroduction(otherAdmin.agent, introduce(), otherAdmin.did)).rejects.toThrow(
      /names .* as its issuer, not the granter/
    )
    const other = { ...introduce(), type: 'keyring/chat/1.0' } as never
    await expect(signIntroduction(granter.agent, other, granter.did)).rejects.toThrow(/not an introduction/)
  })

  it('a resend is signed afresh and keeps its id', async () => {
    const first = await signIntroduction(granter.agent, introduce(), granter.did)
    const again = await signIntroduction(granter.agent, first, granter.did)
    expect(again.id).toBe(first.id)
    expect(await signedBy(again, granter.did)).toBe(true)
  })
})

describe('the granter, as the agent reads it from auth/whoami (a fake until a VTA serves it)', () => {
  it('is delegatedBy when the entry was written on a granter’s behalf, else createdBy', async () => {
    const delegated = await fakeWhoami({
      did: agentDid,
      createdBy: 'did:example:vta-service',
      delegatedBy: granter.did,
    })()
    expect(granterOf(delegated)).toBe(granter.did)
    const created = await fakeWhoami({ did: agentDid, createdBy: granter.did })()
    expect(granterOf(created)).toBe(granter.did)
  })

  it('CONTROL: an entry that names neither, or only blanks, has no granter', async () => {
    expect(granterOf(await fakeWhoami({ did: agentDid })())).toBeUndefined()
    expect(granterOf({ createdBy: ' ', delegatedBy: '' })).toBeUndefined()
  })

  it('end to end: the introduction verifies against the granter whoami names, and not against the one it does not', async () => {
    const whoami = fakeWhoami({ did: agentDid, createdBy: 'did:example:vta-service', delegatedBy: granter.did })
    const named = granterOf(await whoami()) as string
    const signed = await signIntroduction(granter.agent, introduce(), named)
    expect(signed.issuer).toBe(named)
    expect(await signedBy(signed, named)).toBe(true)
    // Control: createdBy is not the granter here, and the document does not verify against it.
    expect(await signedBy(signed, 'did:example:vta-service')).toBe(false)
  })
})
