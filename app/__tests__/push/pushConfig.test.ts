/**
 * Keyring's `enablePushNotifications` for bifold's push framework (push
 * notifications plan §4.1, steps 1.4 and 1.6): absent in a build that names no
 * gateway, which is every tester's build, and otherwise the permission and the
 * wake channel behind the Settings switch.
 */
import type { Agent } from '@credo-ts/core'

import { pushNotificationsConfig, type PushConfigDeps } from '@/push/pushConfig'
import { onPushWake, wakeHints } from '@/push/pushHandlers'

const agent = {} as Agent

function deps(overrides: Partial<PushConfigDeps> = {}) {
  const d = {
    gatewayUrl: 'https://push.example.org',
    permissionStatus: jest.fn(async () => 'unknown' as const),
    requestPermission: jest.fn(async () => 'granted' as const),
    enableWake: jest.fn(async () => ({ status: 'off' as const })),
    clearWake: jest.fn(async () => ({ pushCapable: false })),
    stopPlatformPush: jest.fn(async () => undefined),
    log: jest.fn(),
    ...overrides,
  }
  return d
}

describe("a tester's build, which names no push gateway", () => {
  it('has no push configuration, so bifold shows no prompt and no switch, and nothing registers', () => {
    for (const gatewayUrl of [undefined, '', '  ']) {
      const d = deps({ gatewayUrl })
      expect(pushNotificationsConfig(d)).toBeUndefined()
      expect(d.permissionStatus).not.toHaveBeenCalled()
      expect(d.requestPermission).not.toHaveBeenCalled()
      expect(d.enableWake).not.toHaveBeenCalled()
      expect(d.clearWake).not.toHaveBeenCalled()
      expect(d.stopPlatformPush).not.toHaveBeenCalled()
    }
  })
})

describe('a build that names a push gateway', () => {
  it('reads and asks for the notification permission', async () => {
    const d = deps()
    const config = pushNotificationsConfig(d)!
    await expect(config.status()).resolves.toBe('unknown')
    await expect(config.setup()).resolves.toBe('granted')
    expect(d.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('makes the phone wakeable when the switch is turned on', async () => {
    const d = deps({ enableWake: jest.fn(async () => ({ status: 'notLinked' as const })) })
    await pushNotificationsConfig(d)!.toggle(true, agent)
    expect(d.enableWake).toHaveBeenCalledWith(agent)
    expect(d.clearWake).not.toHaveBeenCalled()
    expect(d.stopPlatformPush).not.toHaveBeenCalled()
    expect(d.log).toHaveBeenCalledWith('push wake: enable', { status: 'notLinked' })
  })

  it('clears the wake channel when the switch is turned off', async () => {
    const d = deps()
    await pushNotificationsConfig(d)!.toggle(false, agent)
    expect(d.clearWake).toHaveBeenCalledWith(agent)
    expect(d.enableWake).not.toHaveBeenCalled()
  })

  it('withdraws the platform token when the switch is turned off, even if the agent cannot be told', async () => {
    const d = deps({
      clearWake: jest.fn(async () => {
        throw new Error('agent unreachable')
      }),
    })
    await expect(pushNotificationsConfig(d)!.toggle(false, agent)).resolves.toBeUndefined()
    expect(d.stopPlatformPush).toHaveBeenCalledTimes(1)
    expect(d.log).toHaveBeenCalledWith('push wake: failed', { enable: false, error: 'agent unreachable' })
  })

  it('keeps the platform token when an approval rule holds the change, since the agent kept the wake channel', async () => {
    const d = deps({
      clearWake: jest.fn(async () => {
        throw Object.assign(new Error('Your agent is waiting for someone else to approve this.'), {
          reason: 'awaitingApproval',
        })
      }),
    })
    await expect(pushNotificationsConfig(d)!.toggle(false, agent)).resolves.toBeUndefined()
    expect(d.stopPlatformPush).not.toHaveBeenCalled()
  })

  it('logs a failure to withdraw the platform token instead of throwing into Settings', async () => {
    const d = deps({
      stopPlatformPush: jest.fn(async () => {
        throw new Error('no network')
      }),
    })
    await expect(pushNotificationsConfig(d)!.toggle(false, agent)).resolves.toBeUndefined()
    expect(d.log).toHaveBeenCalledWith('push platform: stop failed', { error: 'no network' })
  })

  it('logs a refusal from the gateway or the agent instead of throwing into Settings', async () => {
    const d = deps({
      enableWake: jest.fn(async () => {
        throw new Error('permissionDenied')
      }),
    })
    await expect(pushNotificationsConfig(d)!.toggle(true, agent)).resolves.toBeUndefined()
    expect(d.log).toHaveBeenCalledWith('push wake: failed', { enable: true, error: 'permissionDenied' })
  })
})

describe('a wake-up arriving', () => {
  it('is logged with only its known hints, and nothing else is done', () => {
    const log = jest.fn()
    onPushWake(
      'background',
      { data: { v: '1', mediator: 'did:peer:2.mediator', urgency: 'interactive', token: 'x', extra: { a: 1 } } },
      log
    )
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('push wake received (background)', {
      v: '1',
      mediator: 'did:peer:2.mediator',
      urgency: 'interactive',
    })
  })

  it('reads no hints from a message without data', () => {
    expect(wakeHints({})).toEqual({})
  })
})
