/**
 * The phones and other devices that run a person's agent (#10): listed from
 * the agent's device bindings joined to its access list, removed without
 * reaching for anything but the agent, and a phone registering itself.
 */
import {
  AGENT_DEVICE_TASK,
  defaultDeviceName,
  listAgentDevices,
  liveSiblings,
  registerThisDevice,
  removeAgentDevice,
  renameThisDevice,
  type AgentDevicePort,
} from '../module/vtaDevices'
import { VtiRefusal } from '../module/vtiAgent'

const ME = 'did:peer:2.this-phone'
const OLD_PHONE = 'did:peer:2.old-phone'
const PLUGIN = 'did:key:z6MkBrowserPlugin'
const NOW = new Date('2026-09-28T10:00:00Z')

const acl = [
  { subject: ME, role: 'admin', label: 'Keyring', createdAt: '2026-09-28T09:00:00Z' },
  { subject: OLD_PHONE, role: 'admin', label: 'Keyring', createdAt: '2026-06-01T09:00:00Z' },
  { subject: PLUGIN, role: 'admin', label: 'browser', createdAt: '2026-07-01T09:00:00Z' },
  { subject: 'did:key:z6MkCommunityApp', role: 'application', createdAt: '2026-07-02T09:00:00Z' },
]
const bindings = [
  {
    deviceId: 'dev-me',
    consumerDid: ME,
    displayName: 'iPhone · added 28 Sep',
    platform: 'ios',
    registeredAt: '2026-09-28T09:00:05Z',
    lastSeenAt: '2026-09-28T09:59:00Z',
  },
  {
    deviceId: 'dev-old',
    consumerDid: OLD_PHONE,
    displayName: 'Android phone · added 1 Jun',
    platform: 'android',
    registeredAt: '2026-06-01T09:00:05Z',
    lastSeenAt: '2026-09-28T09:50:00Z',
  },
]

/** An agent that answers the device and ACL tasks from the arrays above. */
function fakeAgent(overrides: Partial<Record<string, (payload: Record<string, unknown>) => unknown>> = {}) {
  const sent: { type: string; payload: Record<string, unknown> }[] = []
  const port: AgentDevicePort = {
    managerDid: ME,
    task: async <T>(type: string, payload: Record<string, unknown>) => {
      sent.push({ type, payload })
      const answer = overrides[type]
      if (answer) return answer(payload) as T
      if (type === AGENT_DEVICE_TASK.aclList) return { entries: acl, truncated: false } as T
      if (type === AGENT_DEVICE_TASK.list) return { devices: bindings } as T
      return {} as T
    },
  }
  return { port, sent }
}

describe('the devices that run your agent', () => {
  it('lists every admin: registered devices with their binding, the rest from the access list', async () => {
    const { port } = fakeAgent()
    const devices = await listAgentDevices(port)
    expect(devices.map((d) => [d.did, d.source])).toEqual([
      [ME, 'registered'],
      [OLD_PHONE, 'registered'],
      [PLUGIN, 'aclOnly'],
    ])
    const me = devices[0]
    expect(me).toMatchObject({
      isThisPhone: true,
      deviceId: 'dev-me',
      displayName: 'iPhone · added 28 Sep',
      platform: 'ios',
      kind: 'keyring',
      accessRevoked: false,
      wipePending: false,
    })
    expect(devices[2]).toMatchObject({ isThisPhone: false, label: 'browser', createdAt: '2026-07-01T09:00:00Z' })
    expect(devices[2].deviceId).toBeUndefined()
  })

  it('keeps a wiped device listed, with its access gone and the wipe pending', async () => {
    const wiped = [bindings[0], { ...bindings[1], wipedAt: '2026-09-28T09:55:00Z' }]
    // As the agent does (vta-service operations/device.rs:239-244): a wiped or
    // disabled binding is left out unless the request asks for it.
    const { port } = fakeAgent({
      [AGENT_DEVICE_TASK.list]: (payload) => ({
        devices: wiped.filter((b) => payload.includeWiped === true || !('wipedAt' in b)),
      }),
    })
    const old = (await listAgentDevices(port)).find((d) => d.did === OLD_PHONE)
    expect(old).toMatchObject({ accessRevoked: true, wipePending: true, wipedAt: '2026-09-28T09:55:00Z' })
  })
})

describe('removing one', () => {
  it('wipes a registered device, then revokes it, since the agent checks a wipe only at REST sign-in', async () => {
    const { port, sent } = fakeAgent()
    const [, old] = await listAgentDevices(port)
    await expect(removeAgentDevice(port, old)).resolves.toEqual({ mode: 'wiped' })
    const types = sent.map((s) => s.type).filter((t) => t === AGENT_DEVICE_TASK.wipe || t === AGENT_DEVICE_TASK.aclRevoke)
    expect(types).toEqual([AGENT_DEVICE_TASK.wipe, AGENT_DEVICE_TASK.aclRevoke])
    const wipe = sent.find((s) => s.type === AGENT_DEVICE_TASK.wipe)
    expect(wipe?.payload).toMatchObject({ deviceId: 'dev-old', scope: 'cache-and-keys' })
    expect(typeof wipe?.payload.reason).toBe('string')
    expect(sent.find((s) => s.type === AGENT_DEVICE_TASK.aclRevoke)?.payload).toEqual({ subject: OLD_PHONE })
  })

  it('still revokes when the agent refuses the wipe', async () => {
    const { port, sent } = fakeAgent({
      [AGENT_DEVICE_TASK.wipe]: () => {
        throw new Error('wipe refused')
      },
    })
    const [, old] = await listAgentDevices(port)
    await expect(removeAgentDevice(port, old)).resolves.toEqual({ mode: 'revoked' })
    expect(sent.find((s) => s.type === AGENT_DEVICE_TASK.aclRevoke)?.payload).toEqual({ subject: OLD_PHONE })
  })

  it('revokes a device that never registered, which leaves the list', async () => {
    const { port, sent } = fakeAgent()
    const plugin = (await listAgentDevices(port)).find((d) => d.did === PLUGIN)!
    await expect(removeAgentDevice(port, plugin)).resolves.toEqual({ mode: 'revoked' })
    expect(sent.find((s) => s.type === AGENT_DEVICE_TASK.aclRevoke)?.payload).toEqual({ subject: PLUGIN })
  })

  it('never removes this phone', async () => {
    const { port, sent } = fakeAgent()
    const [me] = await listAgentDevices(port)
    await expect(removeAgentDevice(port, me)).rejects.toThrow(/this phone/)
    expect(sent.some((s) => s.type === AGENT_DEVICE_TASK.wipe || s.type === AGENT_DEVICE_TASK.aclRevoke)).toBe(false)
  })
})

describe('this phone', () => {
  it('registers as a mobile companion with its name and platform', async () => {
    const { port, sent } = fakeAgent()
    await registerThisDevice(port, { displayName: 'iPhone · added 28 Sep', platform: 'ios' })
    expect(sent.find((s) => s.type === AGENT_DEVICE_TASK.register)?.payload).toEqual({
      consumerKind: { kind: 'companion', formFactor: 'mobile' },
      displayName: 'iPhone · added 28 Sep',
      platform: 'ios',
    })
  })

  it('takes "already registered" as registered, since the agent refuses a second claim', async () => {
    const { port } = fakeAgent({
      [AGENT_DEVICE_TASK.register]: () => {
        throw new VtiRefusal('conflict', 'device/register:alreadyRegistered — a DeviceBinding already exists')
      },
    })
    await expect(registerThisDevice(port, { displayName: 'x', platform: 'ios' })).resolves.toBe('alreadyRegistered')
  })

  it('is renamed on a heartbeat, the only place a binding name can change', async () => {
    const { port, sent } = fakeAgent()
    await renameThisDevice(port, 'Sam’s iPhone')
    expect(sent.find((s) => s.type === AGENT_DEVICE_TASK.heartbeat)?.payload).toEqual({
      ext: { 'org.openvtc.device-name': { displayName: 'Sam’s iPhone' } },
    })
  })

  it('gets a short, dated default name rather than a model string', () => {
    expect(defaultDeviceName('ios', NOW, 'en-GB')).toBe('iPhone · added 28 Sep')
    expect(defaultDeviceName('android', NOW, 'en-GB')).toBe('Android phone · added 28 Sep')
  })
})

describe('another phone acting as the same agent', () => {
  it('counts a device seen in the last 15 minutes, never this phone, a removed one or one never seen', async () => {
    const recent = new Date(NOW.getTime() - 14 * 60_000).toISOString()
    const stale = new Date(NOW.getTime() - 16 * 60_000).toISOString()
    const rows = [
      { ...bindings[0], lastSeenAt: recent },
      { ...bindings[1], lastSeenAt: recent },
      { deviceId: 'dev-3', consumerDid: 'did:peer:2.third', displayName: 'three', lastSeenAt: stale },
      { deviceId: 'dev-4', consumerDid: 'did:peer:2.fourth', displayName: 'four', lastSeenAt: recent, wipedAt: recent },
      { deviceId: 'dev-5', consumerDid: 'did:peer:2.fifth', displayName: 'five' },
    ]
    const { port } = fakeAgent({
      [AGENT_DEVICE_TASK.list]: () => ({ devices: rows }),
      [AGENT_DEVICE_TASK.aclList]: () => ({
        entries: rows.map((r) => ({ subject: r.consumerDid, role: 'admin' })),
        truncated: false,
      }),
    })
    const live = liveSiblings(await listAgentDevices(port), NOW)
    expect(live.map((d) => d.did)).toEqual([OLD_PHONE])
  })
})
