/**
 * RFC 0734 set-device-info to the mediator (peer message notifications plan
 * §3, step 5): the wire shape didcomm-mediator-credo reads, and where it goes.
 */
import { DidCommMessageSender, DidCommOutboundMessageContext } from '@credo-ts/didcomm'

import { SetDeviceInfoMessage, devicePlatformOf, setMediatorDeviceInfo } from '@/push/mediatorDeviceInfo'

const TYPE = 'https://didcomm.org/push-notifications-fcm/1.0/set-device-info'

describe('set-device-info', () => {
  it('goes on the wire with the names the mediator reads', () => {
    const json = new SetDeviceInfoMessage('zHandle', 'ios').toJSON() as Record<string, unknown>
    expect(json['@type']).toBe(TYPE)
    expect(typeof json['@id']).toBe('string')
    expect(json.device_token).toBe('zHandle')
    expect(json.device_platform).toBe('ios')
  })

  it('withdraws the device with a null pair', () => {
    const json = new SetDeviceInfoMessage(null, null).toJSON() as Record<string, unknown>
    expect(json.device_token).toBeNull()
    expect(json.device_platform).toBeNull()
  })

  it('names the platform the way the RFC does', () => {
    expect(devicePlatformOf('apns')).toBe('ios')
    expect(devicePlatformOf('fcm')).toBe('android')
  })
})

describe('sending it to the mediator', () => {
  function agentWith(connection: unknown) {
    const sendMessage = jest.fn(async () => undefined)
    const agent = {
      context: { contextCorrelationId: 'default' },
      modules: { didcomm: { mediationRecipient: { findDefaultMediatorConnection: async () => connection } } },
      dependencyManager: {
        resolve: (token: unknown) => {
          if (token !== DidCommMessageSender) throw new Error('unexpected resolve')
          return { sendMessage }
        },
      },
    }
    return { agent: agent as never, sendMessage }
  }

  it('sends the handle over the default mediator connection', async () => {
    const connection = { id: 'mediator-connection' }
    const { agent, sendMessage } = agentWith(connection)
    await setMediatorDeviceInfo(agent, { handle: 'zHandle', platform: 'fcm' })
    expect(sendMessage).toHaveBeenCalledTimes(1)
    const [context] = sendMessage.mock.calls[0] as unknown as [DidCommOutboundMessageContext]
    expect(context.connection).toBe(connection)
    expect(context.message).toBeInstanceOf(SetDeviceInfoMessage)
    expect((context.message as SetDeviceInfoMessage).device_token).toBe('zHandle')
    expect((context.message as SetDeviceInfoMessage).device_platform).toBe('android')
  })

  it('sends a null pair to withdraw', async () => {
    const { agent, sendMessage } = agentWith({ id: 'm' })
    await setMediatorDeviceInfo(agent, null)
    const [context] = sendMessage.mock.calls[0] as unknown as [DidCommOutboundMessageContext]
    expect((context.message as SetDeviceInfoMessage).device_token).toBeNull()
  })

  it('throws, sending nothing, when there is no mediator connection', async () => {
    const { agent, sendMessage } = agentWith(null)
    await expect(setMediatorDeviceInfo(agent, { handle: 'h', platform: 'apns' })).rejects.toThrow(
      'no mediator connection'
    )
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
