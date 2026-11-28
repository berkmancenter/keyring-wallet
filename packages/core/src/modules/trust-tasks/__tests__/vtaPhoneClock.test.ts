/**
 * A phone whose date and time are wrong has every signed ask refused by its own
 * agent: `issuedAt` more than 60 s ahead, or older than the agent's 10 min
 * window plus 60 s, and a proof `created` more than 60 s ahead (phoneClock.ts
 * has the upstream lines). Before, a sign-in's hello refused that way was
 * dropped, so the agent showed online and each screen failed with its own
 * generic words, or with the agent's code.
 *
 * Read from the agent's refusal (its code and its words together), never from
 * the phone's clock, and only ever said: the link, the keys and the session
 * stay as they are, and nothing is retried for it. A refusal worded any other
 * way is what it was before.
 */
import { phoneClockRefusal } from '../module/phoneClock'
import { VtaAgentController } from '../module/vtaAgent'
import { deviceRefusalOf } from '../module/vtaOwner'
import { VtiRefusal } from '../module/vtiAgent'

// The refusals as they reach the phone: the code, and the wire message trust-tasks-rs 0.39.0 / affinidi-data-integrity
// 0.8.7 give it (VTI 97fda9813's Cargo.lock).
const AHEAD = () =>
  new VtiRefusal(
    'malformedRequest',
    "malformed request: issuedAt is in the future beyond the consumer's skew tolerance (SPEC §4.2)"
  )
const BEHIND = () => new VtiRefusal('expired', "document is outside the consumer's acceptance window (SPEC §7.2)")
const PROOF_AHEAD = () =>
  new VtiRefusal(
    'proofInvalid',
    'document proof does not verify: Created date is in the future (beyond the 60s clock-skew allowance)'
  )

describe('phoneClockRefusal reads the agent refusal, by its code and its words together', () => {
  it.each([
    ['issuedAt ahead', AHEAD, 'malformedRequest'],
    ['issuedAt behind the window', BEHIND, 'expired'],
    ['proof created ahead', PROOF_AHEAD, 'proofInvalid'],
  ])('%s', (_, refusal, code) => {
    expect(phoneClockRefusal(refusal())).toBe(code)
  })

  it.each([
    // The same codes with other words: not the clock.
    ['malformed, another reason', new VtiRefusal('malformedRequest', 'malformed request: payload: missing `key`')],
    // A reached `expiresAt` is the document's own stated end, worded differently.
    ['expired at its own expiresAt', new VtiRefusal('expired', 'document expired at 2026-11-26T10:00:00Z')],
    ['proof invalid, a bad signature', new VtiRefusal('proofInvalid', 'document proof does not verify: signature')],
    // The right words under another code, or not from the agent at all.
    ['the words under another code', new VtiRefusal('taskFailed', AHEAD().message)],
    ['the words in a plain error', new Error(AHEAD().message)],
    ['not on the access list', new VtiRefusal('permissionDenied', 'forbidden: DID not in ACL: did:peer:2.x')],
    ['not an error', AHEAD().message],
  ])('%s: not the clock', (_, error) => {
    expect(phoneClockRefusal(error)).toBeUndefined()
  })
})

describe('a device act refused for the clock says so', () => {
  it('in its own words, not as the agent refusal with its code', () => {
    expect(deviceRefusalOf(AHEAD())).toMatchObject({ reason: 'phoneClock' })
    expect(deviceRefusalOf(BEHIND())).toMatchObject({ reason: 'phoneClock' })
  })

  it('control: the same code with other words is still the agent refusal', () => {
    const other = deviceRefusalOf(new VtiRefusal('expired', 'document expired at 2026-11-26T10:00:00Z'))
    expect(other.reason).not.toBe('phoneClock')
  })
})

// The controller, on the same mocks as vtaPresenceRemoved.
const LINKED_AT = '2026-11-26T06:00:00.000Z'
const mockClient = {
  connect: jest.fn(async () => undefined),
  disconnect: jest.fn(async () => undefined),
  whoAmI: jest.fn(async (): Promise<unknown> => ({ roles: ['admin'] })),
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

async function signedIn() {
  const link = { vtaDid: 'did:webvh:bob', label: 'bob', linkedAt: LINKED_AT }
  let record: Record<string, unknown> | undefined = link
  const writes = { link: 0, cleared: 0, manager: 0 }
  const vta = new VtaAgentController()
  vta.configure({
    now: () => Date.parse(LINKED_AT) + 60_000,
    linkStore: () => ({
      get: async () => record as never,
      set: async (next) => {
        writes.link += 1
        record = next as never
      },
      clear: async () => {
        writes.cleared += 1
        record = undefined
      },
      list: async () => (record ? [record] : []) as never,
    }),
    identityStore: () =>
      ({
        setManager: async () => {
          writes.manager += 1
        },
        listPersonas: async () => [],
      }) as never,
    agentAddress: jest.fn(async () => 'found' as const),
    keyFetchWaitMs: 50,
  })
  await vta.restore(appAgent as never)
  await settle()
  return { vta, writes, record: () => record }
}

describe("a sign-in whose hello the agent refused for the phone's clock", () => {
  let warn: jest.SpyInstance
  beforeAll(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] }))
  afterAll(() => jest.useRealTimers())
  beforeEach(() => {
    jest.clearAllMocks()
    mockClient.whoAmI.mockImplementation(async () => ({ roles: ['admin'] }))
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())

  it('is said, with the code in the log, and the link, the keys and the session stay as they are', async () => {
    mockClient.whoAmI.mockImplementation(async () => {
      throw AHEAD()
    })
    const { vta, writes, record } = await signedIn()
    expect(vta.getState().phoneClockRefused).toMatchObject({ code: 'malformedRequest' })
    // Not revoked, not offline, not retrying: the session is up and the link is the same link.
    expect(vta.getState().link).toMatchObject({
      kind: 'linked',
      vtaDid: 'did:webvh:bob',
      connection: { kind: 'online' },
    })
    expect(writes.cleared).toBe(0)
    expect(writes.manager).toBe(0)
    expect(record()).toMatchObject({ vtaDid: 'did:webvh:bob' })
    expect(mockClient.disconnect).not.toHaveBeenCalled()
    expect(warn.mock.calls.flat().join('\n')).toMatch(
      /refused what this phone signed for the phone's date and time: malformedRequest/
    )
    // Nothing is retried for it: no reconnect is scheduled, so time passing asks nothing more.
    const asked = mockClient.connect.mock.calls.length
    jest.advanceTimersByTime(120_000)
    await settle()
    expect(mockClient.connect.mock.calls.length).toBe(asked)
  })

  it('control: a hello refused with other words is not said, as before', async () => {
    mockClient.whoAmI.mockImplementation(async () => {
      throw new VtiRefusal('malformedRequest', 'malformed request: payload: missing `key`')
    })
    const { vta } = await signedIn()
    expect(vta.getState().phoneClockRefused).toBeUndefined()
    expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })
  })

  it('control: a hello that answers says nothing', async () => {
    const { vta } = await signedIn()
    expect(vta.getState().phoneClockRefused).toBeUndefined()
  })

  it('back in the foreground, one hello: an answer clears it, a refusal or no answer keeps it', async () => {
    mockClient.whoAmI.mockImplementation(async () => {
      throw BEHIND()
    })
    const { vta } = await signedIn()
    expect(vta.getState().phoneClockRefused).toMatchObject({ code: 'expired' })

    mockClient.whoAmI.mockImplementation(async () => {
      throw new Error('the VTA did not answer within 20 s')
    })
    await vta.ensureOnline(appAgent as never)
    await settle()
    expect(vta.getState().phoneClockRefused).toMatchObject({ code: 'expired' })

    mockClient.whoAmI.mockImplementation(async () => {
      throw BEHIND()
    })
    await vta.ensureOnline(appAgent as never)
    await settle()
    expect(vta.getState().phoneClockRefused).toMatchObject({ code: 'expired' })

    // The person put the clock right in Settings and came back.
    mockClient.whoAmI.mockImplementation(async () => ({ roles: ['admin'] }))
    const asked = mockClient.whoAmI.mock.calls.length
    await vta.ensureOnline(appAgent as never)
    await settle()
    expect(mockClient.whoAmI.mock.calls.length).toBe(asked + 1)
    expect(vta.getState().phoneClockRefused).toBeUndefined()
    expect(warn.mock.calls.flat().join('\n')).toMatch(/accepts this phone's clock again \(was refused: expired\)/)

    // With nothing said, a foreground asks nothing more than before.
    const after = mockClient.whoAmI.mock.calls.length
    await vta.ensureOnline(appAgent as never)
    await settle()
    expect(mockClient.whoAmI.mock.calls.length).toBe(after)
  })
})
