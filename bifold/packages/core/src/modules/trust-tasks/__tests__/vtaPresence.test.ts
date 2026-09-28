/**
 * The phone telling its agent it is still here (#10, plan part F): register
 * once, a heartbeat every five minutes, and a word — once — when another
 * device starts acting as the same agent.
 */
import { AGENT_DEVICE_TASK, type AgentDevicePort } from '../module/vtaDevices'
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
        if (registered) throw new VtiRefusal('device/register:alreadyRegistered', 'already registered')
        registered = true
        return {} as T
      }
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
    expect(isLinkOnline({ kind: 'linked', ...agent, linkedAt: 't', connection: { kind: 'offline', since: 1 } } as never)).toBe(false)
    expect(isLinkOnline({ kind: 'linked', ...agent, linkedAt: 't', connection: { kind: 'online' } } as never)).toBe(true)
    expect(isLinkOnline({ kind: 'revoked', ...agent, reason: 'x', cause: 'notInAcl' } as never)).toBe(false)
  })
})
