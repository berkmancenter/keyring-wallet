/**
 * The first contact's announcement (announceRelationshipDid, vrc-manager.ts) failing on every try: the flow ends as an
 * error, so the chat says the exchange didn't complete instead of "Sent N min ago… this continues when they open it"
 * for a message that never left this phone (a mailbox send refused, 2026-11-22). The handler is the real one on a
 * fake agent, as lateStepConnectionHold.test.ts drives it.
 */
import {
  DidCommConnectionEventTypes,
  DidCommDidExchangeState,
  DidCommEventTypes,
  DidCommOutOfBandRole,
} from '@credo-ts/didcomm'

import { lateStepStore, resetQueueStatus } from '../../../src/modules/vrc/lateStep'
import { setupVrcConnectionHandler } from '../../../src/modules/vrc/vrc-manager'
import { vrcFlowStore } from '../../../src/modules/vrc/witnessStatusStore'

jest.mock('../../../src/modules/trust-tasks/ceremony', () => ({
  resumeInterruptedExchanges: jest.fn(async () => undefined),
  maybeOpenRelationshipExchange: jest.fn(async () => undefined),
  deliverAfterAcceptance: jest.fn(),
}))
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

function fakeAgent(sendMessage: jest.Mock) {
  const handlers = new Map<string, Array<(e: unknown) => unknown>>()
  const metadata = new Map<string, unknown>()
  const connection = {
    id: 'conn-1',
    state: DidCommDidExchangeState.Completed,
    outOfBandId: 'oob-1',
    theirDid: 'did:peer:1zTheirConnection',
    theirLabel: 'Alex',
    didcommVersion: 'v2',
    metadata: {
      get: (k: string) => metadata.get(k) ?? null,
      set: (k: string, v: unknown) => void metadata.set(k, v),
      delete: (k: string) => void metadata.delete(k),
    },
  }
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
          getAll: jest.fn(async () => []),
          update: jest.fn(async () => undefined),
        },
        oob: {
          findById: jest.fn(async () => ({
            id: 'oob-1',
            role: DidCommOutOfBandRole.Receiver,
            outOfBandInvitation: { goalCode: 'relationship.credential.bidirectional' },
          })),
        },
      },
    },
  }
  const emit = async (type: string, payload: unknown) => {
    for (const fn of handlers.get(type) ?? []) await fn({ payload })
  }
  return { agent: agent as never, connection, emit }
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve))
}

/** Complete the connection and run the announcement through its retries (2 s and 4 s waits, under fake timers). */
async function connectWith(sendMessage: jest.Mock) {
  const f = fakeAgent(sendMessage)
  setupVrcConnectionHandler(f.agent)
  await settle()
  await f.emit(DidCommEventTypes.DidCommMessageProcessed, {
    message: { type: 'https://didcomm.org/messagepickup/2.0/status', oldestReceivedTime: new Date() },
  })
  const completing = f.emit(DidCommConnectionEventTypes.DidCommConnectionStateChanged, {
    connectionRecord: f.connection,
  })
  for (let i = 0; i < 4; i++) {
    await settle()
    await jest.advanceTimersByTimeAsync(4000)
  }
  await completing
  await settle()
  return f
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
  lateStepStore.reset()
  resetQueueStatus()
  vrcFlowStore.clearFlow('conn-1')
})
afterEach(() => {
  vrcFlowStore.clearFlow('conn-1')
  jest.useRealTimers()
})

describe('the first contact’s announcement', () => {
  it('failing on every try ends the flow as an error, so the chat never says it was sent', async () => {
    const sendMessage = jest.fn(async () => {
      throw new Error('[TrustTasks:WalletMailbox] no mailbox is open to send through')
    })
    await connectWith(sendMessage)
    expect(sendMessage).toHaveBeenCalledTimes(3)
    expect(vrcFlowStore.flowEndedWith('conn-1')).toBe('error')
    expect(vrcFlowStore.getStatus('conn-1')).toBe('idle')
  })

  it('CONTROL: sent, the flow stays connecting, waiting on the other phone', async () => {
    const sendMessage = jest.fn(async () => undefined)
    await connectWith(sendMessage)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(vrcFlowStore.getStatus('conn-1')).toBe('connecting')
    expect(vrcFlowStore.flowEndedWith('conn-1')).toBeUndefined()
  })

  it('CONTROL: a first try that fails and a second that succeeds is a send, not an error', async () => {
    const sendMessage = jest
      .fn(async () => undefined)
      .mockRejectedValueOnce(new Error('socket closed while the message was packed'))
    await connectWith(sendMessage)
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(vrcFlowStore.getStatus('conn-1')).toBe('connecting')
    expect(vrcFlowStore.flowEndedWith('conn-1')).toBeUndefined()
  })
})
