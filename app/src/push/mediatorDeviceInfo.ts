/**
 * Telling the mediator how to ring this phone when a message waits for it
 * (peer message notifications plan §3, step 5).
 *
 * The Keyring mediator (didcomm-mediator-credo) keeps one "device token" per
 * connection, set with Aries RFC 0734 `set-device-info`, and posts it to its
 * push webhook for every message it queues while the phone is away. The
 * webhook is the push gateway, so the "token" this phone sends is its opaque
 * wake **handle**, never the platform push token: the mediator learns nothing
 * it could push to on its own. The gateway rings the handle only if the agent
 * allowlisted the gateway (pushWake.ts sends it as a suggested trigger).
 */
import type { Agent } from '@credo-ts/core'
import {
  DidCommMessage,
  DidCommMessageSender,
  DidCommOutboundMessageContext,
  parseMessageType,
} from '@credo-ts/didcomm'

import type { PushRegistration } from './pushGateway'

/**
 * RFC 0734 `set-device-info`. The fields are named as they go on the wire, so
 * the class needs no serialisation decorators; a null pair withdraws the
 * device. https://github.com/hyperledger/aries-rfcs/tree/main/features/0734-push-notifications-fcm
 */
export class SetDeviceInfoMessage extends DidCommMessage {
  public static readonly type = parseMessageType('https://didcomm.org/push-notifications-fcm/1.0/set-device-info')
  public readonly type = SetDeviceInfoMessage.type.messageTypeUri

  public device_token: string | null
  public device_platform: string | null

  public constructor(deviceToken: string | null, devicePlatform: string | null) {
    super()
    this.id = this.generateId()
    this.device_token = deviceToken
    this.device_platform = devicePlatform
  }
}

/** The RFC's platform word for a registration's push service. */
export function devicePlatformOf(platform: PushRegistration['platform']): string {
  return platform === 'apns' ? 'ios' : 'android'
}

/**
 * Send the handle (or null, to withdraw it) to this phone's default mediator.
 * Throws when there is no mediator connection or the send fails; the callers
 * log it, since a phone that cannot be rung for messages still works.
 */
export async function setMediatorDeviceInfo(
  agent: Agent,
  info: { handle: string; platform: PushRegistration['platform'] } | null
): Promise<void> {
  const connection = await agent.modules.didcomm.mediationRecipient.findDefaultMediatorConnection()
  if (!connection) throw new Error('no mediator connection to set device info on')
  const message = info
    ? new SetDeviceInfoMessage(info.handle, devicePlatformOf(info.platform))
    : new SetDeviceInfoMessage(null, null)
  const sender = agent.dependencyManager.resolve(DidCommMessageSender)
  await sender.sendMessage(new DidCommOutboundMessageContext(message, { agentContext: agent.context, connection }))
}
