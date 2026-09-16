/**
 * Regression test for the duplicate v2 message-pickup loop: on every launch
 * after the first, `provisionV2MediationIfConfigured` re-ran
 * `startV2MessagePickup` on a v2 mediation record that `configureMessagePickup`
 * had already started pickup for earlier in the same setup — subscribing a
 * second Pickup 4.0 polling loop (startV2MessagePickup's PickUpV4 start has no
 * anti-stacking guard, unlike the patched v1/v2 start; see
 * src/utils/mediatorPickupStrategy.guard.test.ts).
 */
import Config from 'react-native-config'

import { provisionV2MediationIfConfigured } from './useBCAgentSetup'

const mockFindV2MediationRecord = jest.fn()
const mockProvisionV2Mediation = jest.fn()
const mockStartV2MessagePickup = jest.fn()

jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  findV2MediationRecord: (...args: unknown[]) => mockFindV2MediationRecord(...args),
  provisionV2Mediation: (...args: unknown[]) => mockProvisionV2Mediation(...args),
  startV2MessagePickup: (...args: unknown[]) => mockStartV2MessagePickup(...args),
}))

jest.mock('react-native-config', () => ({ MEDIATOR_V2_URL: undefined }))

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
    ;(Config as unknown as { MEDIATOR_V2_URL?: string }).MEDIATOR_V2_URL = 'https://mediator/?_oob=x'
    await provisionV2MediationIfConfigured(fakeAgent(), false)
    expect(mockProvisionV2Mediation).not.toHaveBeenCalled()
    expect(mockStartV2MessagePickup).not.toHaveBeenCalled()
  })

  it('does nothing when MEDIATOR_V2_URL is unset', async () => {
    ;(Config as unknown as { MEDIATOR_V2_URL?: string }).MEDIATOR_V2_URL = undefined
    await provisionV2MediationIfConfigured(fakeAgent(), true)
    expect(mockProvisionV2Mediation).not.toHaveBeenCalled()
    expect(mockStartV2MessagePickup).not.toHaveBeenCalled()
  })

  it('starts pickup once when newly provisioning a v2 mediation record', async () => {
    ;(Config as unknown as { MEDIATOR_V2_URL?: string }).MEDIATOR_V2_URL = 'https://mediator/?_oob=x'
    mockFindV2MediationRecord.mockResolvedValueOnce(undefined) // none yet
    mockProvisionV2Mediation.mockResolvedValueOnce({ id: 'm-v2' })

    await provisionV2MediationIfConfigured(fakeAgent(), true)

    expect(mockProvisionV2Mediation).toHaveBeenCalledTimes(1)
    expect(mockStartV2MessagePickup).toHaveBeenCalledTimes(1)
  })

  it('does NOT start a second pickup loop when the v2 record already existed (the bug)', async () => {
    ;(Config as unknown as { MEDIATOR_V2_URL?: string }).MEDIATOR_V2_URL = 'https://mediator/?_oob=x'
    mockFindV2MediationRecord.mockResolvedValueOnce({ id: 'm-v2' }) // already provisioned on a prior launch
    mockProvisionV2Mediation.mockResolvedValueOnce({ id: 'm-v2' }) // idempotent no-op, per provisionV2Mediation's own contract

    await provisionV2MediationIfConfigured(fakeAgent(), true)

    expect(mockProvisionV2Mediation).toHaveBeenCalledTimes(1)
    // configureMessagePickup (called earlier in agent setup, unconditionally)
    // already started pickup for this pre-existing record.
    expect(mockStartV2MessagePickup).not.toHaveBeenCalled()
  })

  it('logs and swallows a provisioning failure without starting pickup', async () => {
    ;(Config as unknown as { MEDIATOR_V2_URL?: string }).MEDIATOR_V2_URL = 'https://mediator/?_oob=x'
    mockFindV2MediationRecord.mockResolvedValueOnce(undefined)
    mockProvisionV2Mediation.mockRejectedValueOnce(new Error('mediator unreachable'))

    await expect(provisionV2MediationIfConfigured(fakeAgent(), true)).resolves.toBeUndefined()
    expect(mockStartV2MessagePickup).not.toHaveBeenCalled()
  })
})
