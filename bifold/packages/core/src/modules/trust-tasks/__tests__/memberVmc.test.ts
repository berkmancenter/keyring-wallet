/**
 * The member's half of the membership pair (vtc/members/vmc/0.1, 241).
 *
 * Before: a community admitted a Keyring member, issued its grant, and never
 * received the member's acknowledgement — Keyring sent none, so every Keyring
 * member's edge stayed half formed (`member_vmc_received_at` unset,
 * `credentialsDelivered` false).
 *
 * Golden parity: `fixtures/member-vmc-golden.json` is what dtg-credentials
 * 0.13.0 — the library VTI 49f5f1be verifies member acknowledgements with —
 * mints for a fixed grant (`fixtures/member-vmc-golden.rs.txt`). Keyring's
 * builder must produce the same credential, and the same digest, byte for byte.
 */
const mockApply = jest.fn()
const mockSend = jest.fn()
const PERSONA = 'did:webvh:QmPersona:dids.example:column-hobby'
const COMMUNITY = 'did:webvh:QmCommunity:vtc.example:test-vtc'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  // The persona's signature: a proof naming its key, over the document as given.
  signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>, did: string) => ({
    ...doc,
    proof: {
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-2022',
      proofPurpose: 'assertionMethod',
      verificationMethod: `${did}#key-0`,
    },
  })),
  verifyDocumentProof: jest.fn(async () => true),
}))
jest.mock('../module/vtaAgent', () => ({
  vtaAgent: {
    client: () => ({
      ensurePersona: async () => ({
        did: PERSONA,
        communityDid: COMMUNITY,
        kmsKeyIds: { keyAgreement: 'ka', signing: 'sig' },
        vtaKeyIds: { keyAgreement: 'vka', signing: `${PERSONA}#key-0` },
      }),
    }),
  },
}))
jest.mock('../module/vtiTsp', () => ({ GenericRecordsTspPeerRevisionStore: class {} }))
jest.mock('../module/vtiDeliveredCheck', () => ({
  ...jest.requireActual('../module/vtiDeliveredCheck'),
  checkDeliveredCard: async () => undefined,
}))
jest.mock('../module/vtiAgent', () => {
  const actual = jest.requireActual('../module/vtiAgent')
  return {
    ...actual,
    vtiAgent: {
      did: PERSONA,
      connect: async () => undefined,
      onInbound: () => () => undefined,
      fetchManifest: async () => ({ wire: '0.3', criteria: [] }),
      apply: (...args: unknown[]) => mockApply(...args),
      sendMemberVmc: (...args: unknown[]) => mockSend(...args),
    },
  }
})

import { VtiRefusal } from '../module/vtiAgent'
import { joinCommunity } from '../module/vtiJoin'
import {
  buildMemberVmc,
  grantDigest,
  MemberVmcNotPossible,
  reciprocateMembership,
  REQUEST_VMC,
} from '../module/vtiMemberVmc'
import { receiveRequestVmc, reciprocateIfOwed } from '../module/vtiReciprocate'

import golden from './fixtures/member-vmc-golden.json'

const grant = golden.grant as Record<string, unknown>
const persona = {
  did: PERSONA,
  kmsKeyIds: { keyAgreement: 'ka', signing: 'sig' },
  vtaKeyIds: { keyAgreement: 'vka', signing: `${PERSONA}#key-0` },
}
const agent = { config: { logger: { warn: jest.fn(), info: jest.fn() } } } as never

function store(initial: Record<string, unknown> = {}) {
  let membership: Record<string, unknown> | undefined = initial.membership as never
  let submission: Record<string, unknown> | undefined = initial.submission as never
  return {
    getMembership: jest.fn(async () => membership),
    saveMembership: jest.fn(async (m: Record<string, unknown>) => {
      membership = m
    }),
    saveInvitation: jest.fn(async () => undefined),
    getSubmission: jest.fn(async () => submission),
    saveSubmission: jest.fn(async (s: Record<string, unknown>) => {
      submission = s
    }),
    current: () => membership,
  }
}
const membershipOf = (over: Record<string, unknown> = {}) => ({
  communityDid: COMMUNITY,
  personaDid: PERSONA,
  role: 'member',
  vmc: grant,
  grantedAt: '2026-10-11T17:00:00Z',
  via: 'approval',
  ...over,
})
const stored = { memberDid: PERSONA, vmcId: 'x', status: 'stored' }
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(() => {
  mockSend.mockReset().mockImplementation(async (_c: string, vc: { id: string }) => ({ ...stored, vmcId: vc.id }))
  mockApply.mockReset()
})

describe('golden parity with dtg-credentials 0.13 (what VTI verifies against)', () => {
  it('builds the same acknowledgement, field for field', () => {
    const ack = buildMemberVmc(grant, PERSONA, { now: new Date('2026-10-11T18:00:00Z'), id: 'urn:uuid:ack-1' })
    expect(ack).toEqual(golden.acknowledgement)
  })

  it('digests the grant as the library does: JCS sha-256 without its proof, keeping its status', () => {
    expect(grantDigest(grant)).toBe(golden.digestMultibase)
    // The proof is excluded: re-signing the grant does not change what is acknowledged.
    expect(grantDigest({ ...grant, proof: { proofValue: 'zOther' } })).toBe(golden.digestMultibase)
    // Its status is kept: a different status entry is a different grant.
    expect(grantDigest({ ...grant, credentialStatus: {} })).not.toBe(golden.digestMultibase)
  })
})

describe('what cannot be acknowledged (dtg-credentials refusals)', () => {
  const refused = (g: Record<string, unknown>, did = PERSONA) => {
    try {
      buildMemberVmc(g, did, { now: new Date('2026-10-11T18:00:00Z') })
    } catch (e) {
      return (e as MemberVmcNotPossible).reason
    }
    return undefined
  }
  it('refuses anything but a public membership grant about this persona, still current', () => {
    expect(refused({ ...grant, type: ['VerifiableCredential'] })).toBe('notAMembershipGrant')
    expect(refused({ ...grant, credentialSubject: { id: PERSONA, digestMultibase: 'z' } })).toBe(
      'alreadyAnAcknowledgement'
    )
    expect(refused(grant, 'did:webvh:someone:else')).toBe('notTheGrantSubject')
    expect(refused({ ...grant, issuerScope: 'directed' })).toBe('grantScope')
    expect(refused({ ...grant, validUntil: '2026-10-11T17:59:59Z' })).toBe('grantExpired')
  })
})

describe('sending it', () => {
  it('signs it as the persona for assertionMethod, keeps it, sends it once, and records the receipt', async () => {
    const s = store({ membership: membershipOf() })
    await expect(
      reciprocateMembership({
        agent,
        store: s as never,
        persona,
        communityDid: COMMUNITY,
        send: mockSend,
        requestId: 'r7',
      })
    ).resolves.toBe('acknowledged')
    expect(mockSend).toHaveBeenCalledTimes(1)
    const [community, vc, requestId] = mockSend.mock.calls[0]
    expect(community).toBe(COMMUNITY)
    expect(requestId).toBe('r7')
    expect(vc).toMatchObject({
      issuer: PERSONA,
      credentialSubject: { id: COMMUNITY, digestMultibase: golden.digestMultibase },
      proof: { proofPurpose: 'assertionMethod', verificationMethod: `${PERSONA}#key-0` },
    })
    expect(s.current()).toMatchObject({ memberVmc: vc, memberVmcAckedAt: expect.any(String) })

    // Already acknowledged: nothing more is sent.
    await expect(
      reciprocateMembership({ agent, store: s as never, persona, communityDid: COMMUNITY, send: mockSend })
    ).resolves.toBe('alreadyAcknowledged')
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('a lost answer: the same credential (same id) goes again, never a second one', async () => {
    const s = store({ membership: membershipOf() })
    mockSend.mockRejectedValueOnce(new Error('no answer'))
    await expect(
      reciprocateMembership({ agent, store: s as never, persona, communityDid: COMMUNITY, send: mockSend })
    ).rejects.toThrow('no answer')
    const kept = s.current()?.memberVmc as { id: string }
    expect(kept?.id).toMatch(/^urn:uuid:/)
    await reciprocateMembership({ agent, store: s as never, persona, communityDid: COMMUNITY, send: mockSend })
    expect(mockSend.mock.calls[1][1].id).toBe(kept.id)
  })

  it('a renewed grant gets a new acknowledgement', async () => {
    const s = store({ membership: membershipOf() })
    await reciprocateMembership({ agent, store: s as never, persona, communityDid: COMMUNITY, send: mockSend })
    const first = mockSend.mock.calls[0][1]
    const renewed = { ...grant, id: 'urn:uuid:grant-2', validFrom: '2026-11-11T17:00:00Z' }
    await s.saveMembership({ ...(s.current() as object), vmc: renewed })
    await reciprocateMembership({ agent, store: s as never, persona, communityDid: COMMUNITY, send: mockSend })
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend.mock.calls[1][1].id).not.toBe(first.id)
    expect(mockSend.mock.calls[1][1].credentialSubject.digestMultibase).toBe(grantDigest(renewed))
  })

  it('nothing for a membership the community ended', async () => {
    const s = store({ membership: membershipOf({ removal: { code: 'adminRemoved' } }) })
    await expect(
      reciprocateMembership({ agent, store: s as never, persona, communityDid: COMMUNITY, send: mockSend })
    ).resolves.toBe('notOwed')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('a requestId the community no longer holds open does not stop the credential', async () => {
    const s = store({ membership: membershipOf(), submission: { requestId: 'stale' } })
    mockSend.mockRejectedValueOnce(new VtiRefusal('vtc/members/vmc:requestNotApproved', 'not approved'))
    await expect(reciprocateIfOwed(agent, s as never, persona, COMMUNITY)).resolves.toBe('acknowledged')
    expect(mockSend.mock.calls.map((c) => c[2])).toEqual(['stale', undefined])
  })

  it('only over the persona’s own session: it must be signed by the persona', async () => {
    const s = store({ membership: membershipOf() })
    await expect(
      reciprocateIfOwed(agent, s as never, persona, COMMUNITY, { sessionDid: () => 'did:webvh:another:persona' })
    ).resolves.toBe('notSignedIn')
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('reproduction: a join the community allows sends exactly one acknowledgement', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('one vtc/members/vmc/0.1 document, closing the request, even when the delivery inbox sees the card too', async () => {
    mockApply.mockResolvedValue({ requestId: 'r7', effect: 'allow', with: { vmc: grant } })
    const s = store()
    const deps = {
      agent,
      identityStore: {},
      communityStore: s,
      vtaDid: 'did:webvh:vta',
      mediatorDid: 'did:peer:lab',
      communityDid: COMMUNITY,
    } as never
    await joinCommunity(deps)
    // The community's delivery of the same card reaches the inbox at the same time.
    await reciprocateIfOwed(agent, s as never, persona, COMMUNITY)
    await settle()
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend.mock.calls[0][0]).toBe(COMMUNITY)
    expect(mockSend.mock.calls[0][2]).toBe('r7')
    expect(s.current()).toMatchObject({ memberVmcAckedAt: expect.any(String) })
  })
})

describe('the community asking again (vtc/members/request-vmc/0.1)', () => {
  const asked = (over: Record<string, unknown> = {}) => ({
    type: REQUEST_VMC,
    from: COMMUNITY,
    body: {
      id: 'urn:uuid:ask-1',
      type: REQUEST_VMC,
      issuer: COMMUNITY,
      recipient: PERSONA,
      // The setup pins Date.now(); the freshness check reads it.
      issuedAt: new Date(Date.now()).toISOString(),
      payload: { communityDid: COMMUNITY, reason: 'edge incomplete' },
      ...over,
    },
  })

  it('answers with the acknowledgement this membership already has', async () => {
    const s = store({ membership: membershipOf() })
    await reciprocateMembership({ agent, store: s as never, persona, communityDid: COMMUNITY, send: mockSend })
    await expect(receiveRequestVmc(agent, s as never, persona, asked())).resolves.toBe('acknowledged')
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend.mock.calls[1][1].id).toBe(mockSend.mock.calls[0][1].id)
  })

  it('ignores one that is not the community’s own, for this persona, current and signed', async () => {
    const s = store({ membership: membershipOf() })
    await expect(receiveRequestVmc(agent, s as never, persona, asked({ recipient: 'did:other' }))).resolves.toBe(
      'ignored'
    )
    await expect(receiveRequestVmc(agent, s as never, persona, asked({ issuer: 'did:other' }))).resolves.toBe('ignored')
    await expect(
      receiveRequestVmc(agent, s as never, persona, asked({ issuedAt: '2026-01-01T00:00:00Z' }))
    ).resolves.toBe('ignored')
    await expect(
      receiveRequestVmc(agent, s as never, persona, asked({ payload: { communityDid: 'did:other' } }))
    ).resolves.toBe('ignored')
    await expect(receiveRequestVmc(agent, s as never, persona, asked(), { verify: async () => false })).resolves.toBe(
      'ignored'
    )
    expect(mockSend).not.toHaveBeenCalled()
  })
})
