/**
 * An identity Bring back takes on from the agent is recorded with the agent's key ids and no copies on the phone,
 * so the phone could not sign in to its community as it ("the persona has no borrowed key-agreement key"): on
 * 2026-10-28 a member brought back on a simulator saw their sealed room by its id only, "Community not known yet",
 * and their open room not at all, while the community listed both rooms as joined. Its copies are now borrowed
 * once it is recorded, and at the next session for one taken on before this.
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

const VTA = 'did:webvh:QmVta:dids.example:keyring-al-vta'
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

const listed = { did: PERSONA_DID, contextId: 'keyring', scid: 'Qm', serverId: 'serverless' } as unknown as VtaMintedDid

const adopt = (store: Identities, extra: Partial<Parameters<typeof adoptAgentIdentities>[0]> = {}) =>
  adoptAgentIdentities({
    identities: store as unknown as VtiIdentityStore,
    vtaDid: VTA,
    cards: [{ id: String(membershipCard.id), credential: membershipCard }],
    check: async () => undefined,
    listDids: async () => [listed],
    keyIdsOf: async (did) => ({ signing: `${did}#key-0`, keyAgreement: `${did}#key-1` }),
    held: [],
    ...extra,
  })

/** The phone's client of the identity's agent, its keys borrowed as `keyId` for the agent's key id. */
function agentClient(store: Identities, vtaDid = VTA) {
  const client = new VtaClient({} as never, vtaDid, store as never)
  jest.spyOn(client, 'connect').mockResolvedValue(undefined)
  const borrow = jest
    .spyOn(client, 'borrowKey')
    .mockImplementation(async (id) => ({ keyId: `kms:${id}`, curve: 'Ed25519', publicKeyMultibase: 'z' }))
  const mint = jest.spyOn(client, 'mintPersona')
  return { client, borrow, mint }
}

const signIn = (persona: VtiPersona) => vtiAgent.connect(agent, 'did:peer:mediator', { persona })

afterEach(async () => {
  await vtiAgent.disconnect()
})

describe('an identity Bring back takes on from the agent', () => {
  it('is recorded without key copies, and cannot sign in to its community as it is', async () => {
    const store = identities()
    const { adopted } = await adopt(store)
    expect(adopted.map((p) => p.did)).toEqual([PERSONA_DID])
    expect(adopted[0].kmsKeyIds).toBeUndefined()
    await expect(signIn(adopted[0])).rejects.toThrow('the persona has no borrowed key-agreement key')
  })

  it('has both keys borrowed and recorded on it, and then signs in', async () => {
    const store = identities()
    const { adopted } = await adopt(store)
    const { client, borrow, mint } = agentClient(store)

    await expect(client.holdPersonaKeys(adopted[0])).resolves.toBe(true)

    expect(borrow.mock.calls.map(([id]) => id)).toEqual([`${PERSONA_DID}#key-1`, `${PERSONA_DID}#key-0`])
    expect(mint).not.toHaveBeenCalled()
    const recorded = await store.getPersona(COMMUNITY, VTA)
    expect(recorded?.kmsKeyIds).toEqual({
      keyAgreement: `kms:${PERSONA_DID}#key-1`,
      signing: `kms:${PERSONA_DID}#key-0`,
    })
    expect(recorded?.vtaKeyIds).toEqual(adopted[0].vtaKeyIds)
    await expect(signIn(recorded as VtiPersona)).resolves.toBeUndefined()
    expect(vtiAgent.getState().did).toBe(PERSONA_DID)
  })

  it('is borrowed once when asked twice at the same time', async () => {
    const store = identities()
    const { adopted } = await adopt(store)
    const { client, borrow } = agentClient(store)
    await Promise.all([client.holdPersonaKeys(adopted[0]), client.holdPersonaKeys(adopted[0])])
    expect(borrow).toHaveBeenCalledTimes(2)
  })

  it('stays recorded when its agent refuses the keys, and is asked once more per request, never in a loop', async () => {
    const store = identities()
    const { adopted } = await adopt(store)
    const { client, borrow } = agentClient(store)
    borrow.mockRejectedValue(new Error('not on the ACL for keys/export-secret'))

    await expect(client.holdPersonaKeys(adopted[0])).rejects.toThrow('keys/export-secret')
    expect(borrow).toHaveBeenCalledTimes(1)
    expect((await store.getPersona(COMMUNITY, VTA))?.did).toBe(PERSONA_DID)
    expect((await store.getPersona(COMMUNITY, VTA))?.kmsKeyIds).toBeUndefined()

    await expect(client.holdPersonaKeys(adopted[0])).rejects.toThrow()
    expect(borrow).toHaveBeenCalledTimes(2)
  })

  it('is not written back over an identity a join recorded for the community meanwhile', async () => {
    const store = identities()
    const { adopted } = await adopt(store)
    const joined: VtiPersona = {
      ...adopted[0],
      did: 'did:webvh:QmJoined:dids.example:joined',
      kmsKeyIds: { keyAgreement: 'kms-ka-joined', signing: 'kms-sig-joined' },
    }
    await store.setPersona(joined)
    const { client, borrow } = agentClient(store)

    await expect(client.holdPersonaKeys(adopted[0])).resolves.toBe(false)
    expect(borrow).not.toHaveBeenCalled()
    expect(await store.getPersona(COMMUNITY, VTA)).toEqual(joined)
  })

  it("waits for a join running for the same community, keeps the join's identity, and borrows nothing for itself", async () => {
    const store = identities()
    const { client, borrow } = agentClient(store)
    jest.spyOn(client, 'listContexts').mockResolvedValue([{ id: 'vta' }] as never)
    jest.spyOn(client, 'listServers').mockResolvedValue([{ id: 'dids.example' }] as never)
    let minted: (did: VtaMintedDid) => void = () => undefined
    const JOINED = 'did:webvh:QmJoined:dids.example:joined'
    jest.spyOn(client, 'mintPersona').mockImplementation(() => new Promise((resolve) => (minted = resolve)))

    // The join starts before Bring back has recorded anything, so it mints; Bring back then records its identity.
    const join = client.ensurePersona({ communityDid: COMMUNITY, label: 'joined' })
    const { adopted } = await adopt(store)
    const held = client.holdPersonaKeys(adopted[0])
    minted({ did: JOINED, signingKeyId: `${JOINED}#key-0`, kaKeyId: `${JOINED}#key-1` } as VtaMintedDid)

    await expect(join).resolves.toMatchObject({ did: JOINED })
    await expect(held).resolves.toBe(false)
    expect(borrow.mock.calls.map(([id]) => id)).toEqual([`${JOINED}#key-1`, `${JOINED}#key-0`])
    expect((await store.getPersona(COMMUNITY, VTA))?.did).toBe(JOINED)
  })

  it("is not borrowed through another agent's client, and nothing is minted there", async () => {
    const store = identities()
    const { adopted } = await adopt(store)
    const { client, borrow, mint } = agentClient(store, 'did:webvh:QmOther:dids.example:other-vta')
    await expect(client.holdPersonaKeys(adopted[0])).resolves.toBe(false)
    expect(borrow).not.toHaveBeenCalled()
    expect(mint).not.toHaveBeenCalled()
  })
})

describe('Bring back and a join for the same community at once', () => {
  it('keeps the identity the join recorded while Bring back was reading, and takes nothing on over it', async () => {
    const store = identities()
    const joined: VtiPersona = {
      communityDid: COMMUNITY,
      vtaDid: VTA,
      did: 'did:webvh:QmJoined:dids.example:joined',
      contextId: 'vta',
      vtaKeyIds: { signing: 'joined#key-0', keyAgreement: 'joined#key-1' },
      kmsKeyIds: { keyAgreement: 'kms-ka-joined', signing: 'kms-sig-joined' },
      createdAt: '2026-10-28T21:00:00Z',
    }
    const report = await adopt(store, {
      // The join lands while Bring back reads the identity's DID document.
      keyIdsOf: async (did) => {
        await store.setPersona(joined)
        return { signing: `${did}#key-0`, keyAgreement: `${did}#key-1` }
      },
    })
    expect(report.adopted).toEqual([])
    expect(await store.getPersona(COMMUNITY, VTA)).toEqual(joined)
  })
})

describe('Bring back borrows the keys of what it takes on', () => {
  it('after the report, without waiting for the borrow', async () => {
    const store = identities()
    let release: () => void = () => undefined
    const holdKeys = jest.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const report = await adopt(store, { holdKeys })
    // The report is back while the borrow is still out.
    expect(report.adopted).toHaveLength(1)
    await Promise.resolve()
    expect(holdKeys).toHaveBeenCalledWith(report.adopted[0])
    release()
  })

  it('keeps the identity and says so when the borrow fails', async () => {
    const store = identities()
    const failed = new Error('the agent did not answer')
    const onKeysFailed = jest.fn()
    const report = await adopt(store, { holdKeys: async () => Promise.reject(failed), onKeysFailed })
    await new Promise((resolve) => setImmediate(resolve))
    expect(onKeysFailed).toHaveBeenCalledWith(report.adopted[0], 'the agent did not answer')
    expect((await store.getPersona(COMMUNITY, VTA))?.did).toBe(PERSONA_DID)
  })
})
