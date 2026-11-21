/**
 * A community named the agent itself as a member (an admin console's wallet invite sent to the agent's DID, and its
 * cards issued to it). Bring back took that DID on as one of the phone's identities and signed in to the mediator as
 * the agent: the mediator keeps one live connection per DID, so what the phone sent its agent came back to the phone,
 * and a sign-in to the community's admin console ended "agentUnreachable" after 30 s (276.10). The agent's own DID is
 * now never taken on or signed in as, and only an identity's keys are borrowed.
 */
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  tsp: { CODEC_FORMS_RELATIONSHIPS: true, peekRevision: () => ({ minor: 0 }) },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../module/VtiMediatorTransport', () => ({
  advertisedMediatorDid: jest.fn(async () => undefined),
  advertisedTspMediatorDid: jest.fn(async () => undefined),
  createVtiClientDid: jest.fn(async () => 'did:peer:client'),
  resolveVtiMediator: jest.fn(async (_a: unknown, did: string) => ({ did, wsEndpoint: `wss://${did}` })),
  resolveDidDocumentRetrying: jest.fn(),
  vtiClientIdentityFromDid: jest.fn(async (_a: unknown, did: string) => ({ did })),
  vtiClientIdentityFromPersona: jest.fn(async (_a: unknown, did: string) => ({ did })),
  VtiMediatorSession: class {
    private open = false
    get isOpen() {
      return this.open
    }
    async start() {
      this.open = true
    }
    async stop() {
      this.open = false
    }
  },
}))
jest.mock('../module/vtiTsp', () => ({
  getPeerLegCarriage: () => 'didcomm',
  LOG_PREFIX: '[tsp]',
  tspSessionForPersona: jest.fn(async () => ({ identity: {}, resolver: {} })),
}))

import { COMMUNITY, membershipCard, PERSONA_DID } from '../../../../__tests__/helpers/cardVault'
import { adoptAgentIdentities } from '../module/vtiAdoptIdentities'
import { vtiAgent } from '../module/vtiAgent'
import { VtaClient, type VtaMintedDid } from '../module/VtaClient'
import type { VtiIdentityStore, VtiPersona } from '../module/VtiIdentityStore'

const VTA = 'did:webvh:QmVta:dids.example:keyring-admin-vta'
const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }
const agent = { config: { logger } } as never

function identities() {
  const kept = new Map<string, VtiPersona>()
  return {
    kept,
    getPersona: async (communityDid: string, vtaDid?: string) => kept.get(`${vtaDid ?? VTA}|${communityDid}`),
    setPersona: jest.fn(async (p: VtiPersona) => void kept.set(`${p.vtaDid}|${p.communityDid}`, p)),
    listPersonas: async () => [...kept.values()],
  }
}
type Identities = ReturnType<typeof identities>

const minted = (did: string) =>
  ({ did, contextId: 'keyring', scid: 'Qm', serverId: 'serverless' }) as unknown as VtaMintedDid
/** The community's membership card, issued to the agent's own DID. */
const agentsCard = {
  ...membershipCard,
  id: 'urn:uuid:agents-card',
  credentialSubject: { ...(membershipCard.credentialSubject as Record<string, unknown>), id: VTA },
}

const adopt = (store: Identities, extra: Partial<Parameters<typeof adoptAgentIdentities>[0]> = {}) =>
  adoptAgentIdentities({
    identities: store as unknown as VtiIdentityStore,
    vtaDid: VTA,
    cards: [{ id: String(agentsCard.id), credential: agentsCard }],
    check: async () => undefined,
    // dids/list answers the agent's own DID among its identities.
    listDids: async () => [minted(VTA)],
    keyIdsOf: async (did) => ({ signing: `${did}#key-0`, keyAgreement: `${did}#key-1` }),
    held: [],
    ...extra,
  })

/** What Bring back recorded for it before 276.12, keys borrowed. */
const agentAsPersona: VtiPersona = {
  communityDid: COMMUNITY,
  vtaDid: VTA,
  did: VTA,
  contextId: 'keyring',
  vtaKeyIds: { signing: `${VTA}#key-0`, keyAgreement: `${VTA}#key-1` },
  kmsKeyIds: { signing: 'kms-sig', keyAgreement: 'kms-ka' },
  createdAt: '2026-10-31T00:52:25Z',
}

afterEach(async () => {
  await vtiAgent.disconnect()
})

describe("Bring back and a community card issued to the agent's own DID", () => {
  it('takes nothing on, borrows nothing, and counts the card as the agent’s', async () => {
    const store = identities()
    const holdKeys = jest.fn(async () => true)
    const report = await adopt(store, { holdKeys })
    expect(report.adopted).toEqual([])
    expect(report).toMatchObject({ otherIdentities: 0, cardsForOthers: 0, cardsForAgent: 1 })
    expect(store.setPersona).not.toHaveBeenCalled()
    await new Promise((resolve) => setImmediate(resolve))
    expect(holdKeys).not.toHaveBeenCalled()
  })

  it("still takes on the agent's other identities beside it", async () => {
    const store = identities()
    const report = await adopt(store, {
      cards: [
        { id: String(agentsCard.id), credential: agentsCard },
        { id: String(membershipCard.id), credential: membershipCard },
      ],
      listDids: async () => [minted(VTA), minted(PERSONA_DID)],
    })
    expect(report.adopted.map((p) => p.did)).toEqual([PERSONA_DID])
    expect(report).toMatchObject({ otherIdentities: 1, cardsForAgent: 1 })
  })
})

describe("the agent's own DID, recorded as an identity by an earlier build", () => {
  it('is never signed in as on the mediator: no socket, and the session is not the agent', async () => {
    await expect(vtiAgent.connect(agent, 'did:peer:mediator', { persona: agentAsPersona })).rejects.toThrow(
      "its agent's own DID"
    )
    expect(vtiAgent.isConnected).toBe(false)
    expect(vtiAgent.getState().signingInAs).not.toBe(VTA)
  })

  it('has no keys borrowed for it', async () => {
    const store = identities()
    const client = new VtaClient({} as never, VTA, store as never)
    jest.spyOn(client, 'connect').mockResolvedValue(undefined)
    const borrow = jest.spyOn(client, 'borrowKey')
    const unborrowed = { ...agentAsPersona, kmsKeyIds: undefined }
    store.kept.set(`${VTA}|${COMMUNITY}`, unborrowed)
    await expect(client.holdPersonaKeys(unborrowed)).resolves.toBe(false)
    expect(borrow).not.toHaveBeenCalled()
  })
})

describe('which keys are borrowed', () => {
  it("not the agent's own, in either key", async () => {
    const client = new VtaClient({} as never, VTA, identities() as never)
    const task = jest.spyOn(client, 'task').mockResolvedValue({} as never)
    await expect(client.borrowKey(`${VTA}#key-1`)).rejects.toThrow("the key is the agent's own")
    await expect(client.borrowKey(`${VTA}#key-0`)).rejects.toThrow("the key is the agent's own")
    expect(task).not.toHaveBeenCalled()
  })

  it("an identity's key is still asked for", async () => {
    const client = new VtaClient({} as never, VTA, identities() as never)
    const task = jest.spyOn(client, 'task').mockRejectedValue(new Error('asked'))
    await expect(client.borrowKey(`${PERSONA_DID}#key-1`)).rejects.toThrow('asked')
    expect(task).toHaveBeenCalledWith(expect.stringContaining('keys/export-secret'), { keyId: `${PERSONA_DID}#key-1` })
  })
})
