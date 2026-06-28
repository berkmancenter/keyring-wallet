import { Agent } from '@credo-ts/core'
import { startPeriodicTrustPing } from '@utils/mediator'

jest.useFakeTimers({ legacyFakeTimers: true })

const createMockAgent = () =>
  ({
    mediationRecipient: {
      findDefaultMediator: jest.fn().mockResolvedValue({ connectionId: 'mock-mediator-conn-id' }),
    },
    connections: {
      sendPing: jest.fn().mockResolvedValue(undefined),
    },
    config: {
      logger: {
        debug: jest.fn(),
        error: jest.fn(),
      },
    },
  } as unknown as Agent)

describe('startPeriodicTrustPing', () => {
  let mockAgent: Agent

  beforeEach(() => {
    jest.clearAllTimers()
    jest.clearAllMocks()
    mockAgent = createMockAgent()
  })

  it('does not send a ping immediately on start', () => {
    startPeriodicTrustPing(mockAgent, 15000)

    expect(mockAgent.connections.sendPing).not.toHaveBeenCalled()
  })

  it('sends a trust ping after one interval', async () => {
    startPeriodicTrustPing(mockAgent, 15000)

    jest.advanceTimersByTime(15000)
    await Promise.resolve()

    expect(mockAgent.connections.sendPing).toHaveBeenCalledTimes(1)
    expect(mockAgent.connections.sendPing).toHaveBeenCalledWith('mock-mediator-conn-id', {
      responseRequested: false,
      withReturnRouting: true,
    })
  })

  it('pings repeatedly on each interval', async () => {
    startPeriodicTrustPing(mockAgent, 15000)

    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(15000)
      await Promise.resolve()
    }

    expect(mockAgent.connections.sendPing).toHaveBeenCalledTimes(3)
  })

  it('stops pinging after cleanup', async () => {
    const cleanup = startPeriodicTrustPing(mockAgent, 15000)

    jest.advanceTimersByTime(15000)
    await Promise.resolve()
    expect(mockAgent.connections.sendPing).toHaveBeenCalledTimes(1)

    cleanup()

    jest.advanceTimersByTime(30000)
    await Promise.resolve()
    expect(mockAgent.connections.sendPing).toHaveBeenCalledTimes(1)
  })

  it('survives errors and keeps pinging', async () => {
    jest.mocked(mockAgent.connections.sendPing).mockRejectedValueOnce(new Error('WebSocket dead'))

    startPeriodicTrustPing(mockAgent, 15000)

    jest.advanceTimersByTime(15000)
    await Promise.resolve()
    expect(mockAgent.connections.sendPing).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(15000)
    await Promise.resolve()
    expect(mockAgent.connections.sendPing).toHaveBeenCalledTimes(2)
  })

  it('skips ping if no default mediator is found', async () => {
    jest.mocked(mockAgent.mediationRecipient.findDefaultMediator).mockResolvedValue(null)

    startPeriodicTrustPing(mockAgent, 15000)

    jest.advanceTimersByTime(15000)
    await Promise.resolve()

    expect(mockAgent.connections.sendPing).not.toHaveBeenCalled()
  })
})
