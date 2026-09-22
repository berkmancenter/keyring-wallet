/**
 * A ticket outstanding when the vetter's grant dies.
 *
 * Refusing to SIGN is not enough on its own: the vetter has already handed out
 * a ticket, and redeeming it runs the whole ceremony — codes matched, card
 * sent, statement issued — before the applicant discovers that none of it
 * counted. The vetter's desk can refuse to cut a NEW ticket, but it cannot
 * reach one already in the wild; only this layer can, and the party it must
 * tell is the applicant, who is a stranger to the problem.
 *
 * Measured on keyring-test, 2026-09-22: a vetter re-granted four times signed
 * under a revoked grant while a live one sat beside it.
 */
const sent: { to: string; type: string; body: unknown }[] = []

jest.mock('../module/vtiAgent', () => ({
  vtiAgent: {
    onInbound: () => () => undefined,
    send: jest.fn(async (to: string, type: string, body: unknown) => {
      sent.push({ to, type, body })
    }),
  },
  joinRequestRefusal: () => undefined,
  openJoinRequestOf: () => undefined,
  VtiRefusal: class extends Error {},
}))
jest.mock('@bifold/trust-tasks', () => {
  const actual = jest.requireActual('@bifold/trust-tasks')
  return { ...actual, signDocumentProof: jest.fn(async (_a: unknown, doc: unknown) => doc) }
})

import { VtiVetterDesk, type VettingTicket } from '../module/vtiVetting'
import { vetterNotEligibleReason } from '../module/vtiGrantState'

const COMMUNITY = 'did:webvh:community'
const APPLICANT = 'did:webvh:applicant'
const agent = { config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } } } as never
const persona = {
  did: 'did:webvh:vetter',
  communityDid: COMMUNITY,
  kmsKeyIds: { signing: 'sig' },
  vtaKeyIds: { signing: 'did:webvh:vetter#key-0' },
} as never

const ticket: VettingTicket = {
  ticketId: 'vt-outstanding',
  code: 'AAAA-BBBB',
  secret: 'shhh',
  communityDid: COMMUNITY,
  usesLeft: 1,
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  createdAt: new Date().toISOString(),
}

const store = {
  listTickets: async () => [ticket],
  saveTicket: jest.fn(async () => undefined),
  saveDesk: jest.fn(async () => undefined),
  listDesk: async () => [],
  getApplication: async () => undefined,
} as never

/** A held grant whose window is over: no network needed to call it dead. */
const deadGrant = {
  kind: 'vetter-grant',
  communityDid: COMMUNITY,
  subjectDid: 'did:webvh:vetter',
  receivedAt: '2026-09-01T00:00:00Z',
  credential: { issuer: COMMUNITY, validFrom: '2026-08-01T00:00:00Z', validUntil: '2026-08-02T00:00:00Z' },
}

const communityStore = (grants: unknown[]) =>
  ({ listHeldCredentials: async () => grants, getMembership: async () => undefined }) as never

const request = {
  id: 'urn:uuid:req',
  type: 'https://trusttasks.org/spec/vetting/request/0.1',
  from: APPLICANT,
  body: {
    type: 'https://trusttasks.org/spec/vetting/request/0.1',
    issuer: APPLICANT,
    payload: { community: COMMUNITY, joinDid: APPLICANT, ticket: { code: 'AAAA-BBBB' } },
  },
}

beforeEach(() => {
  sent.length = 0
  jest.clearAllMocks()
})

describe('a ticket redeemed after the grant died', () => {
  it('is refused to the applicant, naming the vetter as ineligible', async () => {
    const desk = new VtiVetterDesk(agent, persona, store, communityStore([deadGrant]))
    // Straight at the handler: the listener swallows errors by design, which
    // would hide a failure in this path behind an empty assertion.
    await (desk as unknown as { takeRequest: (m: unknown) => Promise<void> }).takeRequest(request)

    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe(APPLICANT)
    expect(sent[0].type).toContain('trust-task-error')
    const code = (sent[0].body as { payload?: { code?: string } }).payload?.code ?? ''
    // The reason says the vetter cannot vet, not that the applicant's ticket
    // was bad — blaming the ticket would send them hunting for the wrong thing.
    expect(code).toContain('vetterNotEligible')
    expect(code).not.toContain('invalidTicket')
    // The ticket is NOT spent, and the order is deliberate: the refusal happens
    // BEFORE `usesLeft -= 1`. The first draft of this fix refused after the
    // decrement, which burned a stranger's single-use ticket on a failure that
    // was not theirs — they would have had to ask the vetter for another one to
    // recover from the vetter's own problem. Moving the refusal below the
    // decrement looks tidier and is wrong; this assertion is what says so.
    expect(store.saveTicket).not.toHaveBeenCalled()
  })

  it('carries the reason, so the applicant is told which kind of dead', async () => {
    const desk = new VtiVetterDesk(agent, persona, store, communityStore([deadGrant]))
    await (desk as unknown as { takeRequest: (m: unknown) => Promise<void> }).takeRequest(request)
    // Against the function that BUILDS the reason, not a copy of its format:
    // a test that rebuilds the string would keep passing while the two layers
    // that read it drifted apart, which is the failure it exists to catch.
    expect((sent[0].body as { payload?: { code?: string } }).payload?.code).toBe(
      vetterNotEligibleReason('expired')
    )
  })

  it('holds no opinion when there is no grant at all — still refuses', async () => {
    const desk = new VtiVetterDesk(agent, persona, store, communityStore([]))
    await (desk as unknown as { takeRequest: (m: unknown) => Promise<void> }).takeRequest(request)
    expect((sent[0].body as { payload?: { code?: string } }).payload?.code).toContain('vetterNotEligible')
  })
})
