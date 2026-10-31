/**
 * The phones and other devices that run a person's agent (#10): listed from
 * the agent's device bindings joined to its access list, removed without
 * reaching for anything but the agent, and a phone registering itself.
 */
import {
  AGENT_DEVICE_TASK,
  clearThisDeviceWake,
  defaultDeviceName,
  listAgentDevices,
  listRegisteredDevices,
  liveSiblings,
  registerThisDevice,
  removeAgentDevice,
  renameThisDevice,
  setThisDeviceWake,
  type AgentDevicePort,
} from '../module/vtaDevices'
import { VtiRefusal } from '../module/vtiAgent'
import { forgetAllVersions } from '../module/taskVersions'

beforeEach(() => forgetAllVersions())

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

/**
 * What a vta-service v0.52.0 agent answers a version it does not serve
 * (trust_tasks/helpers.rs `method_not_found`): `unsupportedVersion`, naming the
 * full type URIs it does serve.
 */
const unsupported = (type: string, served: string) =>
  new VtiRefusal('unsupportedVersion', `unsupported version: ${type} — this VTA serves ${served}`, {
    requestedType: type,
    servedVersions: [served],
  })

/** An agent that answers the device and ACL tasks from the arrays above (acl/* at 0.1 only, as v0.52.0 does). */
function fakeAgent(overrides: Partial<Record<string, (payload: Record<string, unknown>) => unknown>> = {}) {
  const sent: { type: string; payload: Record<string, unknown> }[] = []
  const port: AgentDevicePort = {
    managerDid: ME,
    task: async <T>(type: string, payload: Record<string, unknown>) => {
      sent.push({ type, payload })
      const answer = overrides[type]
      if (answer) return answer(payload) as T
      // An agent before 0d3f268e: the 0.3 device tasks and acl/list/0.3 are refused, naming what it serves.
      if (type === AGENT_DEVICE_TASK.heartbeat03) throw unsupported(type, AGENT_DEVICE_TASK.heartbeat)
      if (type === AGENT_DEVICE_TASK.list03) throw unsupported(type, AGENT_DEVICE_TASK.list)
      if (type === AGENT_DEVICE_TASK.aclList03) throw unsupported(type, AGENT_DEVICE_TASK.aclList)
      if (type === AGENT_DEVICE_TASK.aclList02) throw unsupported(type, AGENT_DEVICE_TASK.aclList)
      if (type === AGENT_DEVICE_TASK.aclRevoke02) throw unsupported(type, AGENT_DEVICE_TASK.aclRevoke)
      if (type === AGENT_DEVICE_TASK.aclList) return { entries: acl, truncated: false } as T
      if (type === AGENT_DEVICE_TASK.list) return { devices: bindings } as T
      return {} as T
    },
  }
  return { port, sent }
}

describe('the devices that run your agent', () => {
  // IN-200b: My devices lists every key on the access list, not only admins;
  // a narrower role is marked limited.
  it('lists every access entry: registered devices with their binding, the rest from the list', async () => {
    const { port } = fakeAgent()
    const devices = await listAgentDevices(port)
    expect(devices.map((d) => [d.did, d.source, d.limitedAccess])).toEqual([
      [ME, 'registered', false],
      [OLD_PHONE, 'registered', false],
      [PLUGIN, 'aclOnly', false],
      ['did:key:z6MkCommunityApp', 'aclOnly', true],
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

  // VTI-ACL-053: a phone whose own access lapses adds devices only until then, so My devices says when.
  it("carries each entry's expiry, and none for an entry that never lapses", async () => {
    const until = '2026-10-22T13:00:00.000Z'
    const { port } = fakeAgent({
      [AGENT_DEVICE_TASK.aclList]: () => ({
        entries: [{ ...acl[0], expiresAt: until }, acl[1]],
        truncated: false,
      }),
    })
    const [me, old] = await listAgentDevices(port)
    expect(me.expiresAt).toBe(until)
    expect(old.expiresAt).toBeUndefined()
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
    const types = sent
      .map((s) => s.type)
      .filter((t) => t === AGENT_DEVICE_TASK.wipe || t === AGENT_DEVICE_TASK.aclRevoke)
    expect(types).toEqual([AGENT_DEVICE_TASK.wipe, AGENT_DEVICE_TASK.aclRevoke])
    const wipe = sent.find((s) => s.type === AGENT_DEVICE_TASK.wipe)
    expect(wipe?.payload).toMatchObject({ deviceId: 'dev-old', scope: 'cacheAndKeys' })
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

describe('waking this phone', () => {
  const GATEWAY = 'did:webvh:QmGateway:push.example.org:gateway'
  const AGENT = 'did:webvh:QmAgent:agent.example.org'

  it('gives the agent the gateway handle over set-wake 0.2, and never a push token', async () => {
    const { port, sent } = fakeAgent({
      [AGENT_DEVICE_TASK.setWake]: () => ({ pushCapable: true, triggerPolicy: { allowedTriggers: [AGENT] } }),
    })
    const channel = await setThisDeviceWake(port, { gateway: GATEWAY, handle: 'zHandle' }, { pushPlatform: 'fcm' })
    expect(AGENT_DEVICE_TASK.setWake).toBe('https://trusttasks.org/spec/device/set-wake/0.2')
    expect(sent).toEqual([
      {
        type: AGENT_DEVICE_TASK.setWake,
        payload: { wakeHandle: { gateway: GATEWAY, handle: 'zHandle' }, pushPlatform: 'fcm' },
      },
    ])
    expect(channel).toEqual({ pushCapable: true, allowedTriggers: [AGENT] })
  })

  it('suggests triggers only when there are some', async () => {
    const { port, sent } = fakeAgent()
    await setThisDeviceWake(port, { gateway: GATEWAY, handle: 'h' }, { suggestedTriggers: [] })
    await setThisDeviceWake(port, { gateway: GATEWAY, handle: 'h' }, { suggestedTriggers: ['did:web:mediator'] })
    expect(sent[0].payload).toEqual({ wakeHandle: { gateway: GATEWAY, handle: 'h' } })
    expect(sent[1].payload.suggestedTriggers).toEqual(['did:web:mediator'])
  })

  it('clears the channel with no handle, so a phone leaving its agent is not woken again', async () => {
    const { port, sent } = fakeAgent({ [AGENT_DEVICE_TASK.setWake]: () => ({ pushCapable: false }) })
    await expect(clearThisDeviceWake(port)).resolves.toEqual({ pushCapable: false, allowedTriggers: undefined })
    expect(sent).toEqual([{ type: AGENT_DEVICE_TASK.setWake, payload: {} }])
  })

  it('reads a malformed answer as not wakeable rather than trusting it', async () => {
    const { port } = fakeAgent({
      [AGENT_DEVICE_TASK.setWake]: () => ({ pushCapable: 'yes', triggerPolicy: { allowedTriggers: [AGENT, 7] } }),
    })
    await expect(setThisDeviceWake(port, { gateway: GATEWAY, handle: 'h' })).resolves.toEqual({
      pushCapable: false,
      allowedTriggers: [AGENT],
    })
  })

  it('passes the agent refusal through', async () => {
    const { port } = fakeAgent({
      [AGENT_DEVICE_TASK.setWake]: () => {
        throw new VtiRefusal('permissionDenied', 'device/set-wake: caller has no device binding')
      },
    })
    await expect(setThisDeviceWake(port, { gateway: GATEWAY, handle: 'h' })).rejects.toBeInstanceOf(VtiRefusal)
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

  it('a key with limited access, seen just now, is not another device acting as this agent', async () => {
    const recent = new Date(NOW.getTime() - 60_000).toISOString()
    const rows = [{ deviceId: 'dev-x', consumerDid: 'did:key:z6MkLimited', displayName: 'x', lastSeenAt: recent }]
    const { port } = fakeAgent({
      [AGENT_DEVICE_TASK.list]: () => ({ devices: rows }),
      [AGENT_DEVICE_TASK.aclList]: () => ({
        entries: [{ subject: 'did:key:z6MkLimited', role: 'application' }],
        truncated: false,
      }),
    })
    expect(liveSiblings(await listAgentDevices(port), NOW)).toEqual([])
  })
})

// VTI 2240aa7e deprecates device/{register,heartbeat,list,wipe}/0.1: "will be
// removed in a future release" (vta-sdk trust_tasks.rs). 0.2 is the same shape
// with camelCase enum values on the wire: wipe's scope is `cacheAndKeys`.
// acl/list and acl/revoke are not deprecated and stay at 0.1.
describe('the device tasks this phone speaks', () => {
  it('are the 0.2 versions with heartbeat and list at 0.3 too, the access-list tasks at 0.1 to 0.3', () => {
    expect(AGENT_DEVICE_TASK).toEqual({
      register: 'https://trusttasks.org/spec/device/register/0.2',
      heartbeat: 'https://trusttasks.org/spec/device/heartbeat/0.2',
      list: 'https://trusttasks.org/spec/device/list/0.2',
      heartbeat03: 'https://trusttasks.org/spec/device/heartbeat/0.3',
      list03: 'https://trusttasks.org/spec/device/list/0.3',
      wipe: 'https://trusttasks.org/spec/device/wipe/0.2',
      setWake: 'https://trusttasks.org/spec/device/set-wake/0.2',
      aclList: 'https://trusttasks.org/spec/acl/list/0.1',
      aclRevoke: 'https://trusttasks.org/spec/acl/revoke/0.1',
      aclList02: 'https://trusttasks.org/spec/acl/list/0.2',
      aclRevoke02: 'https://trusttasks.org/spec/acl/revoke/0.2',
      aclList03: 'https://trusttasks.org/spec/acl/list/0.3',
    })
  })
})

// Newest first (group 1b): v0.67.0 serves acl/list only at 0.3, agents before it only at 0.1. A refusal names only
// the agent's dispatch table, which can leave out versions it answers at its edge, so each older version is asked in
// turn: this 0.1 agent is asked 0.2, then 0.1, and 0.1 straight away after that (stepDownAgainstReleases.test.ts).
// (Over TSP a refused 0.2 once never reached the phone, al-phone 10-05 on v0.53/0.54: the case to watch.)
describe('the access-list tasks, asked in the version agents serve', () => {
  it('asks acl/list in 0.3 first, then 0.2, then 0.1, which it remembers', async () => {
    const { port, sent } = fakeAgent()
    await listAgentDevices(port)
    await listAgentDevices(port)
    const acl = sent.map((s) => s.type).filter((t) => t.includes('/acl/'))
    expect(acl).toEqual([
      AGENT_DEVICE_TASK.aclList03,
      AGENT_DEVICE_TASK.aclList02,
      AGENT_DEVICE_TASK.aclList,
      AGENT_DEVICE_TASK.aclList,
    ])
  })

  it('an agent that refuses 0.1 as unsupported is asked in 0.2, and removes with its explicit full removal', async () => {
    const { port, sent } = fakeAgent({
      [AGENT_DEVICE_TASK.aclList]: () => {
        throw unsupported(AGENT_DEVICE_TASK.aclList, AGENT_DEVICE_TASK.aclList02)
      },
      [AGENT_DEVICE_TASK.aclList02]: () => ({ entries: acl, truncated: false }),
      [AGENT_DEVICE_TASK.aclRevoke]: () => {
        throw unsupported(AGENT_DEVICE_TASK.aclRevoke, AGENT_DEVICE_TASK.aclRevoke02)
      },
      [AGENT_DEVICE_TASK.aclRevoke02]: () => ({ entry: null }),
    })
    const devices = await listAgentDevices(port)
    const plugin = devices.find((d) => d.did === PLUGIN)!
    await removeAgentDevice(port, plugin)
    expect(sent.find((s) => s.type === AGENT_DEVICE_TASK.aclRevoke02)?.payload).toEqual({
      subject: PLUGIN,
      revocation: { kind: 'entry' },
    })
  })

  it('asks nothing more once the agent refuses 0.1 for any other reason', async () => {
    const { port, sent } = fakeAgent({
      [AGENT_DEVICE_TASK.aclList]: () => {
        throw new VtiRefusal('permissionDenied', 'not allowed')
      },
    })
    await expect(listAgentDevices(port)).rejects.toThrow('not allowed')
    // 0.3 and 0.2 were refused as unsupported on the way down; 0.1's refusal is the answer, never retried.
    const acl = sent.map((s) => s.type).filter((t) => t.includes('/acl/list/'))
    expect(acl).toEqual([AGENT_DEVICE_TASK.aclList03, AGENT_DEVICE_TASK.aclList02, AGENT_DEVICE_TASK.aclList])
  })
})

describe('the registered devices alone (what the presence loop reads)', () => {
  it('lists the bindings from device/list and never asks the access list', async () => {
    const { port, sent } = fakeAgent({
      [AGENT_DEVICE_TASK.list]: () => ({
        devices: [
          ...bindings,
          { deviceId: 'dev-gone', consumerDid: PLUGIN, displayName: 'browser', disabledAt: '2026-09-01T00:00:00Z' },
          { deviceId: 'no-did' },
        ],
      }),
    })
    const devices = await listRegisteredDevices(port)

    expect(sent.map((s) => s.type).filter((t) => t.includes('/acl/'))).toEqual([])
    expect(devices.map((d) => d.did)).toEqual([ME, OLD_PHONE, PLUGIN]) // a row with no DID is dropped
    expect(devices[0]).toMatchObject({ source: 'registered', isThisPhone: true, kind: 'keyring', accessRevoked: false })
    expect(devices[1]).toMatchObject({ isThisPhone: false, platform: 'android', lastSeenAt: '2026-09-28T09:50:00Z' })
    expect(devices[2]).toMatchObject({ accessRevoked: true, wipePending: false })
    // The role is the access list's: unknown here, never guessed.
    for (const d of devices) expect(d.limitedAccess).toBeUndefined()
  })

  it('and the full listing still joins the access list (the control: it does ask acl/list)', async () => {
    const { port, sent } = fakeAgent()
    await listAgentDevices(port)
    expect(sent.map((s) => s.type)).toContain(AGENT_DEVICE_TASK.aclList)
  })
})
