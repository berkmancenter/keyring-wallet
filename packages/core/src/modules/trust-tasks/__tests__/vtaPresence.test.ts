/**
 * The phone telling its agent it is still here (#10, plan part F): register
 * once, a heartbeat every five minutes, and a word — once — when another
 * device starts acting as the same agent.
 */
import { AGENT_DEVICE_TASK, type AgentDevicePort } from '../module/vtaDevices'
import { forgetAllVersions } from '../module/taskVersions'

beforeEach(() => forgetAllVersions())
import { AgentPresence, isLinkOnline } from '../module/vtaPresence'
import { VtiRefusal } from '../module/vtiAgent'

const ME = 'did:peer:2.this-phone'
const OTHER = 'did:peer:2.other-phone'
const T0 = Date.parse('2026-09-28T10:00:00Z')

function world(opts: { otherSeenAt?: () => string | undefined; registered?: boolean } = {}) {
  let now = T0
  const sent: { type: string; payload: Record<string, unknown> }[] = []
  let registered = opts.registered ?? false
  const port: AgentDevicePort = {
    managerDid: ME,
    task: async <T>(type: string, payload: Record<string, unknown>) => {
      sent.push({ type, payload })
      if (type === AGENT_DEVICE_TASK.register) {
        // As the agent says it over a trust task: a generic conflict code, the reason in the words.
        if (registered)
          throw new VtiRefusal('conflict', 'device/register:alreadyRegistered — a DeviceBinding already exists')
        registered = true
        return {} as T
      }
      // An agent at v0.52.0: acl/* at 0.1 only, and the device tasks at 0.2 (0.3 refused, as before 0d3f268e).
      if (
        type === AGENT_DEVICE_TASK.heartbeat03 ||
        type === AGENT_DEVICE_TASK.list03 ||
        type === AGENT_DEVICE_TASK.aclList03
      )
        throw new VtiRefusal('unsupportedVersion', 'unsupported version', {
          servedVersions: [
            (
              {
                [AGENT_DEVICE_TASK.heartbeat03]: AGENT_DEVICE_TASK.heartbeat,
                [AGENT_DEVICE_TASK.list03]: AGENT_DEVICE_TASK.list,
              } as Record<string, string>
            )[type] ?? AGENT_DEVICE_TASK.aclList,
          ],
        })
      if (type === AGENT_DEVICE_TASK.aclList02)
        throw new VtiRefusal('unsupportedVersion', 'unsupported version', {
          servedVersions: [AGENT_DEVICE_TASK.aclList],
        })
      if (type === AGENT_DEVICE_TASK.aclList)
        return {
          entries: [
            { subject: ME, role: 'admin' },
            { subject: OTHER, role: 'admin' },
          ],
        } as T
      if (type === AGENT_DEVICE_TASK.list)
        return {
          devices: [
            { deviceId: 'me', consumerDid: ME, displayName: 'me', lastSeenAt: new Date(now).toISOString() },
            { deviceId: 'other', consumerDid: OTHER, displayName: 'Other phone', lastSeenAt: opts.otherSeenAt?.() },
          ],
        } as T
      return {} as T
    },
  }
  const seen: string[] = []
  let linked = true
  const presence = new AgentPresence({
    port: async () => (linked ? port : undefined),
    platform: 'ios',
    now: () => new Date(now),
    onSiblingSeen: (d) => seen.push(d.did),
  })
  return {
    presence,
    sent,
    seen,
    advance: (ms: number) => (now += ms),
    unlink: () => (linked = false),
    count: (type: string) => sent.filter((s) => s.type === type).length,
  }
}

describe('telling the agent this phone is here', () => {
  it('registers once, with the default name, and beats on every tick', async () => {
    const w = world()
    await w.presence.tick()
    await w.presence.tick()
    expect(w.count(AGENT_DEVICE_TASK.register)).toBe(1)
    expect(w.sent.find((s) => s.type === AGENT_DEVICE_TASK.register)?.payload.displayName).toBe('iPhone · added 28 Sep')
    expect(w.count(AGENT_DEVICE_TASK.heartbeat)).toBe(2)
  })

  it('beats even when the agent refuses the claim for another reason', async () => {
    const sent: string[] = []
    const presence = new AgentPresence({
      port: async () => ({
        managerDid: ME,
        task: async <T>(type: string) => {
          sent.push(type)
          if (type === AGENT_DEVICE_TASK.register) throw new VtiRefusal('invalid', 'displayName too long')
          if (
            type === AGENT_DEVICE_TASK.aclList02 ||
            type === AGENT_DEVICE_TASK.aclList03 ||
            type === AGENT_DEVICE_TASK.list03 ||
            type === AGENT_DEVICE_TASK.heartbeat03
          )
            throw new VtiRefusal('unsupportedVersion', 'unsupported version')
          if (type === AGENT_DEVICE_TASK.aclList) return { entries: [] } as T
          if (type === AGENT_DEVICE_TASK.list) return { devices: [] } as T
          return {} as T
        },
      }),
      platform: 'ios',
      now: () => new Date(T0),
      onSiblingSeen: () => undefined,
    })
    await presence.tick()
    expect(sent).toContain(AGENT_DEVICE_TASK.heartbeat)
  })

  it('never renames a phone that is already registered', async () => {
    const w = world({ registered: true })
    await w.presence.tick()
    expect(w.sent.filter((s) => s.type === AGENT_DEVICE_TASK.heartbeat).every((s) => !('ext' in s.payload))).toBe(true)
  })

  it('does nothing while the phone is not linked', async () => {
    const w = world()
    w.unlink()
    await w.presence.tick()
    expect(w.sent).toEqual([])
  })

  it('does not throw when the agent cannot be reached; the next tick tries again', async () => {
    const presence = new AgentPresence({
      port: async () => {
        throw new Error('unreachable')
      },
      platform: 'android',
      now: () => new Date(T0),
      onSiblingSeen: () => undefined,
    })
    await expect(presence.tick()).resolves.toBeUndefined()
  })
})

describe('a phone its agent no longer knows', () => {
  // The agent answers a removed phone's heartbeat with a signed permissionDenied
  // "DID not in ACL: …" (vta-service messaging/auth.rs:125, trust_tasks/mod.rs:1056-1066).
  function refusedWith(error: Error) {
    const failures: unknown[] = []
    const presence = new AgentPresence({
      port: async () => ({
        managerDid: ME,
        task: async <T>(type: string) => {
          if (type === AGENT_DEVICE_TASK.register) return {} as T
          throw error
        },
      }),
      platform: 'android',
      now: () => new Date(T0),
      onSiblingSeen: () => undefined,
      onFailed: (e) => failures.push(e),
    })
    return { presence, failures }
  }

  it('hands the refusal of its heartbeat on, so the phone can say it was removed', async () => {
    const refusal = new VtiRefusal('permissionDenied', `DID not in ACL: ${ME}`)
    const w = refusedWith(refusal)
    await expect(w.presence.tick()).resolves.toBeUndefined()
    expect(w.failures).toEqual([refusal])
  })

  it("hands on a heartbeat nobody answered too; what it means is the controller's call", async () => {
    const w = refusedWith(new Error('[TrustTasks:VtaClient] the VTA did not answer device/heartbeat/0.2'))
    await w.presence.tick()
    expect(w.failures).toHaveLength(1)
  })
})

describe('another device acting as the same agent', () => {
  it('is announced once while it stays live, and again if it goes quiet and comes back', async () => {
    let otherSeen: number | undefined = T0
    const w = world({ otherSeenAt: () => (otherSeen === undefined ? undefined : new Date(otherSeen).toISOString()) })
    await w.presence.tick()
    w.advance(5 * 60_000)
    otherSeen = T0 + 5 * 60_000
    await w.presence.tick()
    expect(w.seen).toEqual([OTHER])
    // Quiet for longer than the liveness window, then back.
    w.advance(20 * 60_000)
    await w.presence.tick()
    otherSeen = T0 + 25 * 60_000
    await w.presence.tick()
    expect(w.seen).toEqual([OTHER, OTHER])
  })
})

describe('when presence runs', () => {
  const agent = { vtaDid: 'did:webvh:QmAgent:agent.example', label: 'agent' }
  it('only while the link is up', () => {
    expect(isLinkOnline({ kind: 'notLinked' })).toBe(false)
    expect(
      isLinkOnline({ kind: 'linked', ...agent, linkedAt: 't', connection: { kind: 'offline', since: 1 } } as never)
    ).toBe(false)
    expect(isLinkOnline({ kind: 'linked', ...agent, linkedAt: 't', connection: { kind: 'online' } } as never)).toBe(
      true
    )
    expect(isLinkOnline({ kind: 'revoked', ...agent, reason: 'x', cause: 'notInAcl' } as never)).toBe(false)
  })
})

describe('the access list and the presence tick', () => {
  const ACL_TYPES: readonly string[] = [
    AGENT_DEVICE_TASK.aclList03,
    AGENT_DEVICE_TASK.aclList02,
    AGENT_DEVICE_TASK.aclList,
  ]

  it('never asks acl/list, at any version, tick after tick', async () => {
    const w = world({ otherSeenAt: () => new Date(T0 - 60_000).toISOString() })
    await w.presence.tick()
    w.advance(5 * 60_000)
    await w.presence.tick()

    expect(w.sent.filter((s) => ACL_TYPES.includes(s.type))).toEqual([])
    expect(w.count(AGENT_DEVICE_TASK.heartbeat)).toBe(2)
    expect(w.seen).toEqual([OTHER]) // siblings still come from device/list
  })

  // A tester's run (10-29): the agent never answered acl/list, and the agent client sends one task at a time, so
  // the tick's ask held every other ask (the rooms read among them) for its whole timeout.
  it('finishes, and names a live sibling, while acl/list would never be answered', async () => {
    const sent: string[] = []
    const port: AgentDevicePort = {
      managerDid: ME,
      task: async <T>(type: string) => {
        sent.push(type)
        if (ACL_TYPES.includes(type)) return new Promise<T>(() => undefined)
        if (type === AGENT_DEVICE_TASK.list03 || type === AGENT_DEVICE_TASK.list)
          return {
            devices: [
              { deviceId: 'me', consumerDid: ME, lastSeenAt: new Date(T0).toISOString() },
              { deviceId: 'other', consumerDid: OTHER, platform: 'ios', lastSeenAt: new Date(T0).toISOString() },
              {
                deviceId: 'gone',
                consumerDid: 'did:peer:2.wiped',
                wipedAt: '2026-09-01T00:00:00Z',
                lastSeenAt: new Date(T0).toISOString(),
              },
            ],
          } as T
        return {} as T
      },
    }
    const seen: string[] = []
    const presence = new AgentPresence({
      port: async () => port,
      platform: 'ios',
      now: () => new Date(T0),
      onSiblingSeen: (d) => seen.push(d.did),
    })

    const outcome = await Promise.race([
      presence.tick().then(() => 'finished'),
      new Promise((resolve) => setTimeout(() => resolve('held'), 500)),
    ])

    expect(outcome).toBe('finished')
    expect(seen).toEqual([OTHER]) // not this phone, not the wiped one
    expect(sent.filter((t) => ACL_TYPES.includes(t))).toEqual([])
  })
})
