import { DidCommMediatorPickupStrategy } from '@credo-ts/didcomm'

import { defaultMessagePickupLifecycle } from '../messagePickupLifecycle'

const makeAgent = () => {
  const calls: string[] = []
  const mediationRecipient = {
    stopMessagePickup: jest.fn(async () => {
      calls.push('stop')
    }),
    initiateMessagePickup: jest.fn(async () => {
      calls.push('initiate')
    }),
  }
  return { agent: { modules: { didcomm: { mediationRecipient } } } as any, mediationRecipient, calls }
}

describe('defaultMessagePickupLifecycle', () => {
  it('stops pickup when the app goes to the background', async () => {
    const { agent, mediationRecipient, calls } = makeAgent()
    await defaultMessagePickupLifecycle.onBackground(agent)
    expect(calls).toEqual(['stop'])
    expect(mediationRecipient.initiateMessagePickup).not.toHaveBeenCalled()
  })

  it('on return stops, then starts PickUpV2 polling with the strategy named', async () => {
    const { agent, mediationRecipient, calls } = makeAgent()
    await defaultMessagePickupLifecycle.onForeground(agent)
    expect(calls).toEqual(['stop', 'initiate'])
    expect(mediationRecipient.initiateMessagePickup).toHaveBeenCalledWith(
      undefined,
      DidCommMediatorPickupStrategy.PickUpV2
    )
  })
})
