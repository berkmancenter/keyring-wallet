/**
 * The local interop rung (plan WP13, local half): the scanner's session and
 * TSP carriage against a scripted fake inviter, over real TSP 1.0 frames
 * with real keys and the real codec. Proofs and credential signing are
 * stubbed (they need a KMS); everything else, relationship forming first, the
 * envelope, the identity rule and the six documents, is the real path. The
 * live run against a counterpart's relay is separate and needs one reachable.
 */
import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { tsp } from '@bifold/trust-tasks'
import * as issue from '@openvtc/trust-tasks/vrc/relationships/issue/0.1/payload'
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'

import { digestMultibase } from '../documentProof'
import { SharedConnectSession, type SharedConnectDeps } from '../module/sharedConnect'
import { createTspEncounterCarriage, type EncounterRelaySession } from '../module/sharedConnectCarriage'
import type { EncounterRecord } from '../module/sharedConnectEncounter'
import { packTrustTaskForPeer, unpackTrustTaskFromPeer, type TspSessionIdentity } from '../module/vtiTsp'

import { ENCOUNTER_ID, NOW } from './fixtures/sharedConnectFixtures'

jest.mock('@bifold/credo-tsp-adapter', () => ({
  keyAgreementFromAskarKey: jest.fn(),
  signingKeyFromEd25519Key: jest.fn(),
}))
jest.mock('../../vrc/witnessStatusStore', () => ({
  vrcFlowStore: { setDialect: jest.fn(), setStatus: jest.fn(), clearFlow: jest.fn() },
}))
jest.mock('../../vrc/vrc-manager', () => ({ getOrCreateRelationshipDid: jest.fn() }))
jest.mock('../services/TrustTaskDocumentRepository', () => ({ TrustTaskDocumentRepository: class {} }))

const party = (vid: string) => {
  const signSk = ed25519.utils.randomSecretKey()
  const encSk = x25519.utils.randomSecretKey()
  return {
    vid,
    keys: { signingPublicKey: ed25519.getPublicKey(signSk), encryptionPublicKey: x25519.getPublicKey(encSk) },
    identity: {
      signingKey: { publicKey: ed25519.getPublicKey(signSk), sign: async (m: Uint8Array) => ed25519.sign(m, signSk) },
      keyAgreement: {
        publicKey: x25519.getPublicKey(encSk),
        agree: async (p: Uint8Array) => x25519.getSharedSecret(encSk, p),
      },
    } as tsp.TspIdentity,
  }
}
const MINE = party('did:peer:2.scanner')
const THEIRS = party('did:peer:2.inviter')
const resolver: tsp.VidResolver = {
  async resolve(vid) {
    const p = [MINE, THEIRS].find((x) => x.vid === vid)
    if (!p) throw new Error(`unknown vid ${vid}`)
    return p.keys
  },
}
const sessionOf = (p: typeof MINE): TspSessionIdentity => ({
  identity: p.identity,
  resolver,
  codec: tsp.createTspCodec(),
})

const THEIR_REL = 'did:peer:0inviterRel'
const MY_REL = 'did:peer:0scannerRel'

it('completes the six documents over real TSP frames, forming the relationship first', async () => {
  const agent = { config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() } } } as never
  const encounter: EncounterRecord = {
    enactment: ENCOUNTER_ID,
    myVid: MINE.vid,
    theirVid: THEIRS.vid,
    carriage: 'tsp',
    relay: 'did:peer:2.mediator',
    exp: NOW + 600,
    state: 'confirmed',
    createdAt: new Date(NOW * 1000).toISOString(),
  }

  const frames: { kind: 'control' | 'document'; type?: string }[] = []
  const inviterReceived: Record<string, unknown>[] = []
  let deliverToScanner!: (bytes: Uint8Array) => Promise<void>
  const live = {} as { session: SharedConnectSession }

  const inviterSays = async (document: Record<string, unknown>) => {
    const packed = await packTrustTaskForPeer(sessionOf(THEIRS), THEIRS.vid, MINE.vid, document, 'v1')
    await deliverToScanner(packed.bytes)
  }
  const base = (type: string, step: number, threadId: string, payload: unknown, id: string) => ({
    id,
    type,
    threadId,
    issuer: THEIRS.vid,
    recipient: MINE.vid,
    issuedAt: '2026-11-05T00:00:00Z',
    ceremony: { enactment: ENCOUNTER_ID, step, definition: 'https://trusttasks.org/ceremony/shared-connect/0.1' },
    payload,
    proof: { signer: THEIRS.vid },
  })
  const theirVc = { issuer: THEIR_REL, credentialSubject: { id: MY_REL }, proof: { cryptosuite: 'eddsa-jcs-2022' } }

  // The fake inviter: what the relay delivers to it.
  const inviterInbox = async (bytes: Uint8Array) => {
    const opened = await unpackTrustTaskFromPeer(sessionOf(THEIRS), bytes, THEIRS.vid)
    if (!opened) return void frames.push({ kind: 'control' })
    const doc = opened.plaintext.body as Record<string, any>
    frames.push({ kind: 'document', type: doc.type })
    inviterReceived.push(doc)
    expect(doc.issuer).toBe(MINE.vid)
    if (doc.type === propose.TYPE_URI) {
      await inviterSays(
        base(`${propose.TYPE_URI}#response`, 2, doc.id, { accept: true, relationshipDid: THEIR_REL }, 'r1')
      )
      await inviterSays(
        base(issue.TYPE_URI, 3, doc.id, { vrc: theirVc, vrcDigestMultibase: digestMultibase(theirVc) }, 'i1')
      )
    } else if (doc.type === issue.TYPE_URI) {
      await inviterSays(
        base(
          `${issue.TYPE_URI}#response`,
          6,
          doc.threadId,
          { vrcDigestMultibase: digestMultibase(doc.payload.vrc) },
          'rc1'
        )
      )
    }
  }

  const relay: EncounterRelaySession = {
    start: async () => undefined,
    stop: async () => undefined,
    sendTspFrame: async (bytes) => inviterInbox(bytes),
    sendTo: async () => undefined,
  }
  const carriage = createTspEncounterCarriage({
    agent,
    encounter,
    mediator: { did: 'did:peer:2.mediator' } as never,
    onDocument: (d) => live.session.handle(d),
    openSession: async (h) => ((deliverToScanner = h.onTspFrame), relay),
    tspIdentity: async () => sessionOf(MINE),
  })

  const stored: unknown[] = []
  const deps: SharedConnectDeps = {
    now: () => NOW * 1000,
    randomBytes: () => new Uint8Array(16).fill(5),
    setTimer: () => ({}),
    clearTimer: () => undefined,
    relationshipDidFor: async () => MY_REL,
    recordTheirRelationshipDid: async () => undefined,
    issueVrc: async (mine, theirs) => ({
      issuer: mine,
      credentialSubject: { id: theirs },
      proof: { cryptosuite: 'eddsa-jcs-2022' },
    }),
    verifyVrc: async () => true,
    verifyProof: async (d, signers) => signers.includes((d.proof as { signer: string }).signer),
    storeVrc: async (vc) => void stored.push(vc) === undefined,
    sign: async (d) => ({ ...d, proof: { signer: String(d.issuer) } }),
    validate: async () => true,
    retain: async () => undefined,
    persist: async () => undefined,
  }
  const session = new SharedConnectSession(agent, encounter, carriage, deps)
  live.session = session

  await carriage.start()
  await session.start()
  await expect(session.finished).resolves.toBe('completed')

  // Relationship forming came first, then propose, the receipt and our issue.
  expect(
    frames.map((f) =>
      f.kind === 'control' ? 'XRFI' : f.type!.split('/').slice(-2).join('/') + (f.type!.endsWith('#response') ? '' : '')
    )
  ).toEqual(['XRFI', 'propose/0.1', 'issue/0.1#response', 'issue/0.1'])
  expect(stored).toEqual([theirVc])
})
