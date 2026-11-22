// A Vetting Card an openvtc vetter accepts (2026-09-24, a maintainer's run: the
// vetter's TUI stayed "waiting for their card" through five sends). The vetter
// recomputes the identity commitment with the VTI SDK
// (vta-sdk `vetting::card::identity_commitment`, at VTI a96fe02f) over
// `{ salt, claims: [{ type, value }] }`, required types in code point order,
// and refuses a card valid for longer than `MAX_CARD_VALIDITY` (15 minutes).
// The expected values below were computed outside this codebase — RFC 8785
// canonical JSON, a sha-256 multihash, base58btc — so they check the spec,
// not Keyring's own implementation of it.

const mockSend = jest.fn(async () => undefined)
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>) => ({ ...doc, proof: {} })),
}))
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: { send: (...a: unknown[]) => (mockSend as jest.Mock)(...a), onInbound: () => () => undefined },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// eslint-disable-next-line import/order
import { MAX_CARD_VALIDITY_MS, VtiApplicant, identityCommitment, type VtiVettingStore } from '../module/vtiVetting'

describe('the identity commitment', () => {
  it('matches the spec for one claim, whatever else the claim carries', () => {
    const expected = 'zQmcEM7ehgZC1MK9LVPhJx5ZTm9EK2egBq7eJ1fTtDQ2Jyx'
    expect(identityCommitment('salt-1', [{ type: 'name.legal', value: 'Ada Lovelace' }])).toBe(expected)
    const withProvenance = [{ type: 'name.legal', value: 'Ada Lovelace', provenance: 'selfAsserted' }]
    expect(identityCommitment('salt-1', withProvenance)).toBe(expected)
    // What Keyring used to send, and every openvtc vetter refused:
    expect(expected).not.toBe('zQmcKStiHJqCyasvCR9awhvQZGS3EeZtZphgrTVoP1651fK')
  })

  it('orders claim types by code point, not by locale', () => {
    // Code point order puts "Z…" before "a…"; localeCompare does not.
    const claims = [
      { type: 'a.lower', value: 'y' },
      { type: 'Z.upper', value: 'x' },
    ]
    expect(identityCommitment('salt-2', claims)).toBe('zQmTfPztYn6bC5zGbC8mvbWprddLmUcwcSvHGo5PpBYiZMu')
  })

  it('counts a type once, as the SDK selects the first claim of each type', () => {
    const once = identityCommitment('salt-1', [{ type: 'name.legal', value: 'Ada Lovelace' }])
    const twice = identityCommitment('salt-1', [
      { type: 'name.legal', value: 'Ada Lovelace' },
      { type: 'name.legal', value: 'Someone Else' },
    ])
    expect(twice).toBe(once)
  })
})

describe('the card Keyring sends', () => {
  const COMMUNITY = 'did:webvh:Qm:dids.example:firstperson-vtc'
  const VETTER = 'did:webvh:Qm:dids.example:brush-say'
  const JOIN = 'did:webvh:Qm:dids.example:page-myth'

  function applicantWithSession(sessionMinutes: number) {
    const application = {
      communityDid: COMMUNITY,
      joinDid: JOIN,
      minStatements: 1,
      requiredClaims: ['name.legal'],
      acceptedMethods: ['inPerson'],
      commitmentSalt: 'salt-1',
      claims: { 'name.legal': 'Ada Lovelace' },
      startedAt: 't',
      requests: [
        {
          vetterDid: VETTER,
          status: 'sessionOpen',
          session: {
            documentId: 'urn:uuid:session-1',
            requiredClaims: ['name.legal'],
            challenge: 'challenge-1',
            domain: 'vetting.example',
            // `new Date()`, not `Date.now()`: the test setup pins the latter.
            expiresAt: new Date(new Date().getTime() + sessionMinutes * 60000).toISOString(),
          },
        },
      ],
    }
    const store = {
      getApplication: async () => application,
      saveApplication: jest.fn(async () => undefined),
    } as unknown as VtiVettingStore
    const persona = {
      did: JOIN,
      communityDid: COMMUNITY,
      vtaKeyIds: { signing: `${JOIN}#key-0`, keyAgreement: `${JOIN}#key-1` },
      kmsKeyIds: { signing: 'sig', keyAgreement: 'ka' },
    }
    return new VtiApplicant({} as never, persona as never, store, {} as never)
  }

  beforeEach(() => mockSend.mockClear())

  it("carries the spec's commitment, in a session response threaded on the session", async () => {
    const card = await applicantWithSession(10).sendCard(VETTER)
    expect(card.identityCommitment).toBe('zQmcEM7ehgZC1MK9LVPhJx5ZTm9EK2egBq7eJ1fTtDQ2Jyx')
    expect(card.audience).toBe(VETTER)
    const [to, type, , options] = mockSend.mock.calls[0] as unknown as [string, string, unknown, { thid?: string }]
    expect(to).toBe(VETTER)
    expect(type).toBe('https://trusttasks.org/spec/vetting/session/0.1#response')
    expect(options.thid).toBe('urn:uuid:session-1')
  })

  it('is valid for at most 15 minutes, however long the session', async () => {
    const card = await applicantWithSession(60).sendCard(VETTER)
    const validity = Date.parse(card.expiresAt as string) - Date.parse(card.issuedAt as string)
    expect(validity).toBeLessThanOrEqual(MAX_CARD_VALIDITY_MS)
    expect(MAX_CARD_VALIDITY_MS).toBe(15 * 60 * 1000)
  })
})
