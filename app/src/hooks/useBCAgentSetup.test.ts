/**
 * Regression test for the duplicate v2 message-pickup loop: on every launch
 * after the first, `provisionV2MediationIfConfigured` re-ran
 * `startV2MessagePickup` on a v2 mediation record that `configureMessagePickup`
 * had already started pickup for earlier in the same setup — subscribing a
 * second Pickup 4.0 polling loop (startV2MessagePickup's PickUpV4 start has no
 * anti-stacking guard, unlike the patched v1/v2 start; see
 * src/utils/mediatorPickupStrategy.guard.test.ts).
 */
import { DidCommMediatorPickupStrategy } from '@credo-ts/didcomm'
import Config from 'react-native-config'

import {
  applyDidCommSwitches,
  provisionV2MediationIfConfigured,
  restartPickupOnReturn,
  v2MailboxOn,
} from './useBCAgentSetup'
import { initialState } from '../store'

const mockFindV2MediationRecord = jest.fn()
const mockProvisionV2Mediation = jest.fn()
const mockStartV2MessagePickup = jest.fn()
const mockSetTsp = jest.fn()
const mockSetV2 = jest.fn()
const mockSetV2Mailbox = jest.fn()

jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  findV2MediationRecord: (...args: unknown[]) => mockFindV2MediationRecord(...args),
  provisionV2Mediation: (...args: unknown[]) => mockProvisionV2Mediation(...args),
  startV2MessagePickup: (...args: unknown[]) => mockStartV2MessagePickup(...args),
  setTspCarriageEnabled: (on: boolean) => mockSetTsp(on),
  setDidCommV2Enabled: (on: boolean) => mockSetV2(on),
  setV2MediationEnabled: (on: boolean) => mockSetV2Mailbox(on),
}))

jest.mock('react-native-config', () => ({ MEDIATOR_V2_URL: undefined }))

// The mocked Config, typed so a case can set the URL. Cast once into a name:
// assigning through `(Config as ...)` at the start of a line needs a leading
// semicolon under prettier and forbids one under eslint's no-extra-semi, so
// the two tools reformat each other forever (2026-09-16).
const mockedConfig = Config as unknown as { MEDIATOR_V2_URL?: string }

function fakeAgent() {
  return {
    config: { logger: { info: jest.fn(), warn: jest.fn() } },
  } as never
}

describe('provisionV2MediationIfConfigured', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does nothing when the developer flag is off', async () => {
    mockedConfig.MEDIATOR_V2_URL = 'https://mediator/?_oob=x'
    await provisionV2MediationIfConfigured(fakeAgent(), false)
    expect(mockProvisionV2Mediation).not.toHaveBeenCalled()
    expect(mockStartV2MessagePickup).not.toHaveBeenCalled()
  })

  it('does nothing when MEDIATOR_V2_URL is unset', async () => {
    mockedConfig.MEDIATOR_V2_URL = undefined
    await provisionV2MediationIfConfigured(fakeAgent(), true)
    expect(mockProvisionV2Mediation).not.toHaveBeenCalled()
    expect(mockStartV2MessagePickup).not.toHaveBeenCalled()
  })

  it('starts pickup once when newly provisioning a v2 mediation record', async () => {
    mockedConfig.MEDIATOR_V2_URL = 'https://mediator/?_oob=x'
    mockFindV2MediationRecord.mockResolvedValueOnce(undefined) // none yet
    mockProvisionV2Mediation.mockResolvedValueOnce({ id: 'm-v2' })

    await provisionV2MediationIfConfigured(fakeAgent(), true)

    expect(mockProvisionV2Mediation).toHaveBeenCalledTimes(1)
    expect(mockStartV2MessagePickup).toHaveBeenCalledTimes(1)
  })

  it('does NOT start a second pickup loop when the v2 record already existed (the bug)', async () => {
    mockedConfig.MEDIATOR_V2_URL = 'https://mediator/?_oob=x'
    mockFindV2MediationRecord.mockResolvedValueOnce({ id: 'm-v2' }) // already provisioned on a prior launch
    mockProvisionV2Mediation.mockResolvedValueOnce({ id: 'm-v2' }) // idempotent no-op, per provisionV2Mediation's own contract

    await provisionV2MediationIfConfigured(fakeAgent(), true)

    expect(mockProvisionV2Mediation).toHaveBeenCalledTimes(1)
    // configureMessagePickup (called earlier in agent setup, unconditionally)
    // already started pickup for this pre-existing record.
    expect(mockStartV2MessagePickup).not.toHaveBeenCalled()
  })

  it('logs and swallows a provisioning failure without starting pickup', async () => {
    mockedConfig.MEDIATOR_V2_URL = 'https://mediator/?_oob=x'
    mockFindV2MediationRecord.mockResolvedValueOnce(undefined)
    mockProvisionV2Mediation.mockRejectedValueOnce(new Error('mediator unreachable'))

    await expect(provisionV2MediationIfConfigured(fakeAgent(), true)).resolves.toBeUndefined()
    expect(mockStartV2MessagePickup).not.toHaveBeenCalled()
  })
})

// The one restart on a return to the foreground, run by whichever handler owns the return (utils/livePickup.ts
// appRestartsPickupOnReturn). Polling here: the live switch is off by default.
describe('restartPickupOnReturn', () => {
  const pickupAgent = (stop: () => Promise<void> = async () => undefined) => {
    const calls: string[] = []
    const mediationRecipient = {
      stopMessagePickup: jest.fn(async () => {
        calls.push('stop')
        await stop()
      }),
      initiateMessagePickup: jest.fn(async (_record: unknown, strategy: string) => {
        calls.push(`initiate ${strategy}`)
      }),
    }
    return { agent: { modules: { didcomm: { mediationRecipient } } } as never, calls }
  }
  const logger = { info: jest.fn(), warn: jest.fn() }

  beforeEach(() => {
    jest.clearAllMocks()
    mockStartV2MessagePickup.mockResolvedValue(undefined)
  })

  it("stops, then starts the app's own pickup (PickUpV2 named explicitly), and says so", async () => {
    const { agent, calls } = pickupAgent()
    await restartPickupOnReturn(agent, logger)
    expect(calls).toEqual(['stop', 'stop', `initiate ${DidCommMediatorPickupStrategy.PickUpV2}`])
    expect(mockStartV2MessagePickup).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith('Message pickup restarted after returning to the foreground')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('never throws: a store closing under it is one warning, nothing else', async () => {
    const { agent, calls } = pickupAgent(async () => {
      throw new Error('Error executing query. Invalid store handle')
    })
    await expect(restartPickupOnReturn(agent, logger)).resolves.toBeUndefined()
    expect(calls).toEqual(['stop'])
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not restart message pickup on foreground: Error executing query. Invalid store handle'
    )
    expect(logger.info).not.toHaveBeenCalled()
  })
})

describe('applyDidCommSwitches: what bifold is told at every agent start', () => {
  beforeEach(() => {
    mockSetTsp.mockClear()
    mockSetV2.mockClear()
    mockSetV2Mailbox.mockClear()
  })

  test('as shipped (nothing saved): TSP on, DIDComm v2 on, the v2 mailbox off', () => {
    applyDidCommSwitches(initialState.developer)
    expect(mockSetTsp).toHaveBeenLastCalledWith(true)
    expect(mockSetV2).toHaveBeenLastCalledWith(true)
    expect(mockSetV2Mailbox).toHaveBeenLastCalledWith(false)
  })

  test('CONTROL: the opt-outs reach bifold as off', () => {
    applyDidCommSwitches({ enableTspCarriage: false, enableDidCommV2: false, enableV2Mailbox: false })
    expect(mockSetTsp).toHaveBeenLastCalledWith(false)
    expect(mockSetV2).toHaveBeenLastCalledWith(false)
    expect(mockSetV2Mailbox).toHaveBeenLastCalledWith(false)
  })

  test.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('v2 %s, mailbox switch %s → the v2 mailbox is used: %s (never without v2)', (v2, mailbox, expected) => {
    expect(v2MailboxOn({ enableDidCommV2: v2, enableV2Mailbox: mailbox })).toBe(expected)
    applyDidCommSwitches({ enableTspCarriage: true, enableDidCommV2: v2, enableV2Mailbox: mailbox })
    expect(mockSetV2Mailbox).toHaveBeenLastCalledWith(expected)
  })
})
