/**
 * The real connection handler (setupVrcConnectionHandler) on a fake agent: a VRC connection that completes from a
 * request the mediator held for LATE_STEP_MS or more sends nothing until both people are here (IN-448: the
 * inviter picked up an acceptance 49 min late and the exchange ran on by itself). One picked up at once goes on as
 * before; a hold kept across a restart is held again.
 */
import {
  DidCommConnectionEventTypes,
  DidCommDidExchangeState,
  DidCommEventTypes,
  DidCommOutOfBandRole,
} from '@credo-ts/didcomm'

import { LATE_HOLD_METADATA_KEY, lateStepStore, releaseHold, resetQueueStatus } from '../../../src/modules/vrc/lateStep'
import { setupVrcConnectionHandler } from '../../../src/modules/vrc/vrc-manager'

jest.mock('../../../src/modules/trust-tasks/ceremony', () => ({
  resumeInterruptedExchanges: jest.fn(async () => undefined),
  maybeOpenRelationshipExchange: jest.fn(async () => undefined),
  deliverAfterAcceptance: jest.fn(),
}))
// The Trust Task service is the ceremony's, mocked above; its runtime is not what this suite is about.
jest.mock('../../../src/modules/trust-tasks/services/TrustTasksService', () => ({
  TrustTasksService: class {},
  KEYRING_CONSUME_CHECKS: {},
  respondWith: jest.fn(),
  rejectWith: jest.fn(),
  extendedCode: jest.fn(),
}))
jest.mock('../../../src/modules/vrc/vrc-hardware-signing', () => ({
  prepareHardwareKeyForSigning: jest.fn(async () => undefined),
}))

const MINUTE = 60_000

function fakeAgent(kept?: Record<string, unknown>) {
  const handlers = new Map<string, Array<(e: unknown) => unknown>>()
  const metadata = new Map<string, unknown>(kept ? [[LATE_HOLD_METADATA_KEY, kept]] : [])
  const connection = {
    id: 'conn-1',
    state: DidCommDidExchangeState.Completed,
    outOfBandId: 'oob-1',
    theirDid: 'did:peer:1zTheirConnection',
    theirLabel: 'Alex',
    didcommVersion: 'v1',
    metadata: {
      get: (k: string) => metadata.get(k) ?? null,
      set: (k: string, v: unknown) => void metadata.set(k, v),
      delete: (k: string) => void metadata.delete(k),
    },
  }
  const sendMessage = jest.fn(async () => undefined)
  const agent = {
    config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
    events: {
      on: (type: string, fn: (e: unknown) => unknown) => handlers.set(type, [...(handlers.get(type) ?? []), fn]),
      off: jest.fn(),
    },
    context: {},
    dependencyManager: {
      resolve: () => ({ findByConnectionDid: async () => ({ myRelationshipDid: 'did:peer:0zMine' }) }),
    },
    modules: {
      didcomm: {
        basicMessages: { sendMessage },
        connections: {
          getById: jest.fn(async () => connection),
          findById: jest.fn(async () => connection),
          getAll: jest.fn(async () => (kept ? [connection] : [])),
          update: jest.fn(async () => undefined),
        },
        oob: {
          findById: jest.fn(async () => ({
            id: 'oob-1',
            role: DidCommOutOfBandRole.Sender,
            outOfBandInvitation: { goalCode: 'relationship.credential.bidirectional' },
          })),
        },
      },
    },
  }
  const emit = async (type: string, payload: unknown) => {
    for (const fn of handlers.get(type) ?? []) await fn({ payload })
  }
  return { agent: agent as never, connection, sendMessage, metadata, emit }
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve))
}
const announcements = (sendMessage: jest.Mock) =>
  sendMessage.mock.calls.filter(([, content]) => String(content).includes('vrc:relationshipDid:'))

beforeEach(() => {
  lateStepStore.reset()
  resetQueueStatus()
})

async function completeAfter(waitedMs: number, kept?: Record<string, unknown>) {
  const f = fakeAgent(kept)
  setupVrcConnectionHandler(f.agent)
  await settle()
  await f.emit(DidCommEventTypes.DidCommMessageProcessed, {
    message: {
      type: 'https://didcomm.org/messagepickup/2.0/status',
      oldestReceivedTime: new Date(Date.now() - waitedMs),
    },
  })
  await f.emit(DidCommConnectionEventTypes.DidCommConnectionStateChanged, { connectionRecord: f.connection })
  await settle()
  return f
}

describe('a VRC connection that completes', () => {
  it('from a request held 49 min: nothing is sent, the hold is kept, and both people are asked', async () => {
    const f = await completeAfter(49 * MINUTE)
    expect(announcements(f.sendMessage)).toHaveLength(0)
    expect(lateStepStore.get('conn-1')).toMatchObject({ reason: 'connected', phase: 'held' })
    expect(lateStepStore.get('conn-1')?.waitedMs).toBeGreaterThanOrEqual(49 * MINUTE)
    expect(f.metadata.get(LATE_HOLD_METADATA_KEY)).toMatchObject({ waitedMs: expect.any(Number) })

    // Both people are here: the relationship DID goes out, once.
    await releaseHold(f.agent, 'conn-1')
    expect(announcements(f.sendMessage)).toHaveLength(1)
    expect(f.metadata.get(LATE_HOLD_METADATA_KEY)).toMatchObject({ releasedAt: expect.any(Number) })
  })

  // Control: the same completion picked up at once goes on as before.
  it('from a request picked up at once: the relationship DID goes out, nothing is held', async () => {
    const f = await completeAfter(5_000)
    expect(announcements(f.sendMessage)).toHaveLength(1)
    expect(lateStepStore.isHeld('conn-1')).toBe(false)
  })

  it('just under 10 min goes on; 10 min is held', async () => {
    const under = await completeAfter(9 * MINUTE + 50_000)
    expect(announcements(under.sendMessage)).toHaveLength(1)
    lateStepStore.reset()
    resetQueueStatus()
    const at = await completeAfter(10 * MINUTE)
    expect(announcements(at.sendMessage)).toHaveLength(0)
    expect(lateStepStore.isHeld('conn-1')).toBe(true)
  })
})

describe('a hold kept across a restart', () => {
  it('is held again at setup, with the relationship DID still to send', async () => {
    const f = fakeAgent({ waitedMs: 49 * MINUTE, heldAt: Date.now() - MINUTE, reason: 'connected' })
    setupVrcConnectionHandler(f.agent)
    await settle()
    expect(lateStepStore.get('conn-1')).toMatchObject({ reason: 'connected', waitedMs: 49 * MINUTE })
    expect(announcements(f.sendMessage)).toHaveLength(0)
    await releaseHold(f.agent, 'conn-1')
    expect(announcements(f.sendMessage)).toHaveLength(1)
  })

  it('a released one is not held again', async () => {
    const f = fakeAgent({ waitedMs: 49 * MINUTE, heldAt: Date.now() - 2 * MINUTE, releasedAt: Date.now() - MINUTE })
    setupVrcConnectionHandler(f.agent)
    await settle()
    expect(lateStepStore.isHeld('conn-1')).toBe(false)
  })
})
