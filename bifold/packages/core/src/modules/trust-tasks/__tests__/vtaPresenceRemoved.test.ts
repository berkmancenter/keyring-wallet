/**
 * A phone removed from its agent by another device says so while it runs
 * (227 two-phone gate, 09-30): the agent refuses its next heartbeat as not on
 * its access list, and that refusal moves the link to "removed", as a refused
 * sign-in or owner act already did. Before, the presence loop dropped the
 * refusal and the phone stayed "Online" until its next sign-in.
 *
 * A heartbeat nobody answered — the network, a slow agent — is not a
 * removal, and never moves the link.
 */
import { VtiRefusal } from '../module/vtiAgent'
import { VtaAgentController } from '../module/vtaAgent'

const LINKED_AT = '2026-09-30T06:00:00.000Z'

// The controller, on the same mocks as agentGone.
const mockClient = {
  connect: jest.fn(async () => undefined),
  disconnect: jest.fn(async () => undefined),
  whoAmI: jest.fn(async () => ({ roles: ['admin'] })),
  agentLabel: jest.fn(async () => undefined),
  managerDid: 'did:peer:2.permanent',
  isConnected: false,
  holdPersonaKeys: jest.fn(async () => false),
  borrowKey: jest.fn(async () => ({ keyId: 'k', curve: 'Ed25519' as const, publicKeyMultibase: 'z' })),
}
jest.mock('../module/VtaClient', () => ({
  VTA_TASK: jest.requireActual('../module/VtaClient').VTA_TASK,
  refusedAsNotOnAcl: jest.requireActual('../module/VtaClient').refusedAsNotOnAcl,
  TspReplyBreaker: jest.requireActual('../module/VtaClient').TspReplyBreaker,
  ManagerKeyUnresolved: jest.requireActual('../module/VtaClient').ManagerKeyUnresolved,
  SwapDoneSignInFailed: jest.requireActual('../module/VtaClient').SwapDoneSignInFailed,
  consentPendingOf: jest.requireActual('../module/VtaClient').consentPendingOf,
  VtaClient: jest.fn(() => mockClient),
  resolveVtaMediator: jest.fn(async () => ({ did: 'did:peer:2.mediator' })),
}))
jest.mock('../module/VtiMediatorTransport', () => ({
  createVtiClientDid: jest.fn(async () => 'did:peer:2.temporary'),
  createVtiTemporaryDidKey: jest.fn(async () => 'did:key:z6Mktemporary'),
}))

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve))
}

const logger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() }
const appAgent = { config: { logger } }

async function onlineController(
  options: { personas?: unknown[]; links?: unknown[]; keyClient?: unknown; expect?: 'online' | 'revoked' } = {}
) {
  let record: Record<string, unknown> | undefined = { vtaDid: 'did:webvh:bob', label: 'bob', linkedAt: LINKED_AT }
  const vta = new VtaAgentController()
  vta.configure({
    now: () => Date.parse(LINKED_AT) + 60_000,
    linkStore: () => ({
      get: async () => record as never,
      set: async (link) => {
        record = link as never
      },
      clear: async () => {
        record = undefined
      },
      list: async () => (options.links ?? (record ? [record] : [])) as never,
    }),
    identityStore: () =>
      ({ setManager: async () => undefined, listPersonas: async () => options.personas ?? [] }) as never,
    agentAddress: jest.fn(async () => 'found' as const),
    keyFetchWaitMs: 50,
    ...(options.keyClient ? { keyClient: () => options.keyClient as never } : {}),
  })
  await vta.restore(appAgent as never)
  await settle()
  if ((options.expect ?? 'online') === 'online')
    expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })
  return vta
}

describe('a heartbeat the agent refused', () => {
  beforeAll(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] }))
  afterAll(() => jest.useRealTimers())
  beforeEach(() => jest.clearAllMocks())

  it('as not on its access list: the phone was removed, and says so', async () => {
    const vta = await onlineController()
    vta.presenceFailed(new VtiRefusal('permissionDenied', 'DID not in ACL: did:peer:2.permanent'))
    expect(vta.getState().link).toMatchObject({ kind: 'revoked', vtaDid: 'did:webvh:bob', cause: 'notInAcl' })
  })

  it('with an expired entry: the same', async () => {
    const vta = await onlineController()
    vta.presenceFailed(new VtiRefusal('permissionDenied', 'ACL entry expired: did:peer:2.permanent'))
    expect(vta.getState().link).toMatchObject({ kind: 'revoked' })
  })

  it('that nobody answered (offline, a slow agent): still linked', async () => {
    const vta = await onlineController()
    vta.presenceFailed(
      new Error('[TrustTasks:VtaClient] the VTA did not answer https://trusttasks.org/spec/device/heartbeat/0.2')
    )
    vta.presenceFailed(new Error('Network request failed'))
    expect(vta.getState().link).toMatchObject({ kind: 'linked' })
  })

  it('for another reason (a bad name, a policy ask): still linked', async () => {
    const vta = await onlineController()
    vta.presenceFailed(new VtiRefusal('invalid', 'displayName too long'))
    vta.presenceFailed(new VtiRefusal('permissionDenied', 'auth:stepUpRequired'))
    expect(vta.getState().link).toMatchObject({ kind: 'linked' })
  })
})

// IN-350: an agent that no longer had this phone's key on its ACL refused it everywhere, yet the phone said its agent
// "didn't answer". The link is removed wherever this phone's own agent says so, and the report says it happened.
const NOT_ON_ACL = () =>
  new VtiRefusal('permissionDenied', 'permission denied: forbidden: DID not in ACL: did:peer:2.permanent')

describe('this phone refused by its own agent, outside a heartbeat', () => {
  beforeAll(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] }))
  afterAll(() => jest.useRealTimers())
  beforeEach(() => {
    jest.clearAllMocks()
    mockClient.whoAmI.mockImplementation(async () => ({ roles: ['admin'] }))
    mockClient.holdPersonaKeys.mockImplementation(async () => false)
  })

  it("at the connect's hello: the link is removed at once, and the device log says so", async () => {
    mockClient.whoAmI.mockRejectedValue(NOT_ON_ACL())
    const vta = await onlineController({ expect: 'revoked' })
    expect(vta.getState().link).toMatchObject({ kind: 'revoked', vtaDid: 'did:webvh:bob', cause: 'notInAcl' })
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/no longer accepts this phone; the link is removed/))
  })

  it('a hello nobody answered, or refused by a policy that says nothing of the ACL: still linked', async () => {
    mockClient.whoAmI.mockRejectedValue(new Error('[TrustTasks:VtaClient] the VTA did not answer whoami'))
    await onlineController()
    mockClient.whoAmI.mockRejectedValue(new VtiRefusal('permissionDenied', 'forbidden: auth:consent_required'))
    await onlineController()
  })

  it("an identity's key the current agent refuses: the link is removed", async () => {
    mockClient.holdPersonaKeys.mockRejectedValue(NOT_ON_ACL())
    const persona = { did: 'did:webvh:persona', vtaDid: 'did:webvh:bob', kmsKeyIds: { signing: 'mem:k' } }
    const vta = await onlineController({ personas: [persona], expect: 'revoked' })
    expect(vta.getState().link).toMatchObject({ kind: 'revoked' })
  })

  it('a key refetch the current agent refuses: removed, and the caller still hears the refusal to word it', async () => {
    const persona = { did: 'did:webvh:persona', vtaDid: 'did:webvh:bob', kmsKeyIds: { keyAgreement: 'mem:ka' } }
    const vta = await onlineController({ personas: [persona] })
    mockClient.holdPersonaKeys.mockRejectedValue(NOT_ON_ACL())
    await expect(vta.refetchPersonaKeys(appAgent as never, persona as never)).rejects.toThrow(/DID not in ACL/)
    expect(vta.getState().link).toMatchObject({ kind: 'revoked' })
  })

  it("another linked agent refusing an identity's key says nothing about this phone's link", async () => {
    const elsewhere = { did: 'did:webvh:elsewhere', vtaDid: 'did:webvh:alice', kmsKeyIds: { keyAgreement: 'mem:ke' } }
    const other = {
      holdPersonaKeys: jest.fn(async () => Promise.reject(NOT_ON_ACL())),
      disconnect: jest.fn(async () => undefined),
    }
    const vta = await onlineController({
      personas: [elsewhere],
      links: [
        { vtaDid: 'did:webvh:bob', label: 'bob', linkedAt: LINKED_AT },
        { vtaDid: 'did:webvh:alice', label: 'alice', linkedAt: LINKED_AT },
      ],
      keyClient: other,
    })
    await expect(vta.refetchPersonaKeys(appAgent as never, elsewhere as never)).rejects.toThrow(/DID not in ACL/)
    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: 'did:webvh:bob' })
  })
})

// 7a on #454: the removal must not depend on which caller connects, nor on the refusal's other words, and must never
// end a link still being set up.
describe('the removal, whoever connects and however the agent words it', () => {
  beforeAll(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] }))
  afterAll(() => jest.useRealTimers())
  beforeEach(() => {
    jest.clearAllMocks()
    mockClient.whoAmI.mockImplementation(async () => ({ roles: ['admin'] }))
    mockClient.holdPersonaKeys.mockImplementation(async () => false)
  })

  it("a connect whose caller drops the throw (My Agent's own): the link is removed all the same", async () => {
    const vta = await onlineController()
    mockClient.isConnected = false
    mockClient.whoAmI.mockRejectedValue(NOT_ON_ACL())
    await vta.connect(appAgent as never, 'did:webvh:bob').catch(() => undefined)
    expect(vta.getState().link).toMatchObject({ kind: 'revoked' })
  })

  it('a bare "ACL entry expired", with no "forbidden" in it, is a removal on the connect path too', async () => {
    mockClient.whoAmI.mockRejectedValue(new VtiRefusal('permissionDenied', 'ACL entry expired: did:peer:2.permanent'))
    const vta = await onlineController({ expect: 'revoked' })
    expect(vta.getState().link).toMatchObject({ kind: 'revoked' })
  })

  it('a link still being set up is never ended by its key not being on the ACL yet', async () => {
    const vta = await onlineController()
    const shown = { kind: 'showingKey', vtaDid: 'did:webvh:bob', label: 'bob', did: 'did:key:z6Mktemporary' }
    ;(vta as unknown as { set(next: Record<string, unknown>): void }).set({ link: shown })
    vta.presenceFailed(NOT_ON_ACL())
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey' })
  })
})
