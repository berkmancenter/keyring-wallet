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

async function onlineController() {
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
    }),
    identityStore: () => ({ setManager: async () => undefined, listPersonas: async () => [] }) as never,
    agentAddress: jest.fn(async () => 'found' as const),
  })
  await vta.restore({} as never)
  await settle()
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
