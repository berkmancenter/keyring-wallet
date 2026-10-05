/**
 * A vetter's ticket scanned with the camera (or opened from a link, or pasted)
 * lived only in the vetting screen: leaving the screen after "Start my
 * application" lost it, and Step 2 asked for it again (TestFlight 236). It is
 * now kept with the application until the vetter is asked.
 */
import { encodeTicketUri } from '@bifold/trust-tasks'

import { VtiApplicant, type VettingApplication, type VtiVettingStore } from '../module/vtiVetting'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  // Signing is not what is tested here.
  signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>) => ({ ...doc, proof: {} })),
}))
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: { send: jest.fn(async () => undefined), onInbound: () => () => undefined },
}))

const COMMUNITY = 'did:webvh:Qm:vtc.example:mine'
const VETTER = 'did:webvh:Qm:vta.example:vetter'
const PERSONA = {
  did: 'did:webvh:Qm:vta.example:me',
  communityDid: COMMUNITY,
  vtaKeyIds: { signing: 'did:webvh:Qm:vta.example:me#key-0', keyAgreement: 'did:webvh:Qm:vta.example:me#key-1' },
  kmsKeyIds: { signing: 's', keyAgreement: 'k' },
}
const ticket = encodeTicketUri({ community: COMMUNITY, vetter: VETTER, presentation: { code: { code: 'ABCD-EFGH' } } })
// No vetting criterion: the defaults apply (the requirements' shape is not what is tested here).
const manifest = { criteria: [] } as never

function memoryStore() {
  let application: VettingApplication | undefined
  const store = {
    getApplication: async () => application,
    saveApplication: async (a: VettingApplication) => void (application = { ...a }),
  } as unknown as VtiVettingStore
  return { store, held: () => application }
}

const applicantWith = (store: VtiVettingStore) => new VtiApplicant({} as never, PERSONA as never, store, {} as never)

describe("a vetter's ticket outlives the vetting screen", () => {
  it('"Start my application" keeps the ticket in hand with the application', async () => {
    const { store, held } = memoryStore()
    await applicantWith(store).start(manifest, { 'name.legal': 'Alberto L' }, { ticket })
    expect(held()?.pendingTicket).toBe(ticket)
  })

  it('a ticket that arrives once the application exists is kept too; with no application, nothing is', async () => {
    const empty = memoryStore()
    await applicantWith(empty.store).keepTicket(ticket)
    expect(empty.held()).toBeUndefined()

    const { store, held } = memoryStore()
    const applicant = applicantWith(store)
    await applicant.start(manifest, { 'name.legal': 'Alberto L' })
    expect(held()?.pendingTicket).toBeUndefined()
    await applicant.keepTicket(ticket)
    expect(held()?.pendingTicket).toBe(ticket)
  })

  it('asking the vetter with it lets it go', async () => {
    const { store, held } = memoryStore()
    const applicant = applicantWith(store)
    await applicant.start(manifest, { 'name.legal': 'Alberto L' }, { ticket })
    await applicant.requestVetter({ link: ticket })
    expect(held()?.requests).toHaveLength(1)
    expect(held()?.pendingTicket).toBeUndefined()
  })
})
