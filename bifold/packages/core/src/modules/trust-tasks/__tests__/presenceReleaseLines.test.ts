/**
 * IN-350, build 267: a phone removed while its app stayed open never showed it, and the run could not say why —
 * the heartbeat logged only failures, through a logger Release builds do not show, so a tick that never ran read
 * the same as a tick the agent never refused. Every tick now says its outcome in Release, with its reason class and
 * the link, and the loop says when it starts and stops.
 */
import { renderHook } from '@testing-library/react-native'

import { AGENT_DEVICE_TASK, HEARTBEAT_INTERVAL_MS, type AgentDevicePort } from '../module/vtaDevices'
import { forgetAllVersions } from '../module/taskVersions'
import type { VtaLinkState } from '../module/vtaLinkMachine'
import { AgentPresence, linkSummary, PRESENCE_OK_EVERY, useAgentPresence } from '../module/vtaPresence'
import { VtiRefusal } from '../module/vtiAgent'

const ME = 'did:peer:2.this-phone'
const online = {
  kind: 'linked',
  vtaDid: 'did:webvh:vta',
  linkedAt: '2026-10-22T17:00:00Z',
  connection: { kind: 'online' },
} as unknown as VtaLinkState

/** An agent that answers every device task, or fails the heartbeat the way `failWith` says. */
function portFailing(failWith?: () => Error): AgentDevicePort {
  return {
    managerDid: ME,
    task: async <T>(type: string) => {
      if (type === AGENT_DEVICE_TASK.heartbeat && failWith) throw failWith()
      if (type === AGENT_DEVICE_TASK.aclList02 || type === AGENT_DEVICE_TASK.aclList)
        return { entries: [{ subject: ME, role: 'admin' }] } as T
      if (type === AGENT_DEVICE_TASK.list) return { devices: [] } as T
      return {} as T
    },
  }
}

let warn: jest.SpyInstance
beforeEach(() => {
  forgetAllVersions()
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => warn.mockRestore())
const said = () => warn.mock.calls.map(([line]) => String(line))

const tickWith = async (port: AgentDevicePort | undefined, link: VtaLinkState = online) => {
  const onFailed = jest.fn()
  await new AgentPresence({
    port: async () => port,
    platform: 'android',
    onSiblingSeen: jest.fn(),
    onFailed,
    link: () => link,
  }).tick()
  return onFailed
}

describe('every heartbeat tick says what happened, in Release', () => {
  it('ok, with the link', async () => {
    await tickWith(portFailing())
    expect(said()).toContain('[VTA] presence tick: ok (linked/online)')
  })

  it('refused because the phone was removed: failed, accessRevoked — and still handed on', async () => {
    const onFailed = await tickWith(
      portFailing(() => new VtiRefusal('permissionDenied', `forbidden: DID not in ACL: ${ME}`))
    )
    expect(said()).toContain('[VTA] presence tick: failed, accessRevoked (linked/online)')
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  it('not answered: failed, noAnswer — not the same line as a removal', async () => {
    await tickWith(portFailing(() => new Error('the VTA did not answer device/heartbeat in time')))
    expect(said()).toContain('[VTA] presence tick: failed, noAnswer (linked/online)')
    expect(said().join('\n')).not.toMatch(/accessRevoked/)
  })

  it('no signed-in agent: skipped, with the link as it is', async () => {
    const reconnecting = { ...online, connection: { kind: 'reconnecting' } } as unknown as VtaLinkState
    await tickWith(undefined, reconnecting)
    expect(said()).toContain('[VTA] presence tick: skipped, no signed-in agent (linked/reconnecting)')
  })

  it('the link in one or two words', () => {
    expect(linkSummary(online)).toBe('linked/online')
    expect(linkSummary({ kind: 'notLinked' })).toBe('notLinked')
    expect(linkSummary(undefined)).toBe('unknown')
  })
})

// 7a on #474: an "ok" on every five-minute tick is 288 lines a phone a day in a channel kept for the few that matter.
describe('a healthy tick is said when it changes, and hourly; a failure always', () => {
  const okLines = () => said().filter((l) => l.startsWith('[VTA] presence tick: ok'))
  const presenceOver = (port: () => AgentDevicePort | undefined, link: () => VtaLinkState = () => online) =>
    new AgentPresence({ port: async () => port(), platform: 'android', onSiblingSeen: jest.fn(), link })

  it('three healthy ticks in a row: one "ok"', async () => {
    const p = presenceOver(() => portFailing())
    for (let i = 0; i < 3; i++) await p.tick()
    expect(okLines()).toEqual(['[VTA] presence tick: ok (linked/online)'])
  })

  it('after a failure, the next healthy tick is said again; every failure is said', async () => {
    let failing = false
    const p = presenceOver(() => portFailing(failing ? () => new Error('the VTA did not answer in time') : undefined))
    await p.tick()
    failing = true
    await p.tick()
    await p.tick()
    failing = false
    await p.tick()
    expect(said()).toEqual([
      '[VTA] presence tick: ok (linked/online)',
      '[VTA] presence tick: failed, noAnswer (linked/online)',
      '[VTA] presence tick: failed, noAnswer (linked/online)',
      '[VTA] presence tick: ok (linked/online)',
    ])
  })

  it('a new link state is said at once', async () => {
    let link: VtaLinkState = online
    const p = presenceOver(
      () => portFailing(),
      () => link
    )
    await p.tick()
    link = { ...online, connection: { kind: 'connecting' } } as unknown as VtaLinkState
    await p.tick()
    expect(okLines()).toEqual([
      '[VTA] presence tick: ok (linked/online)',
      '[VTA] presence tick: ok (linked/connecting)',
    ])
  })

  it(`still healthy: said again every ${PRESENCE_OK_EVERY} ticks, so a log shows the loop alive`, async () => {
    const p = presenceOver(() => portFailing())
    for (let i = 0; i < PRESENCE_OK_EVERY * 2 + 1; i++) await p.tick()
    expect(okLines()).toEqual([
      '[VTA] presence tick: ok (linked/online)',
      `[VTA] presence tick: ok (linked/online), ${PRESENCE_OK_EVERY} in a row`,
      `[VTA] presence tick: ok (linked/online), ${PRESENCE_OK_EVERY} in a row`,
    ])
  })

  it('skipped, the same way: once until it changes', async () => {
    const p = presenceOver(() => undefined)
    for (let i = 0; i < 3; i++) await p.tick()
    expect(said().filter((l) => l.includes('skipped'))).toHaveLength(1)
  })
})

describe('the loop says when it starts and stops', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('started when the link comes online, stopped when it leaves, with the link then', () => {
    let link: VtaLinkState = online
    const port = async () => portFailing()
    const { rerender, unmount } = renderHook(
      ({ p }: { p?: () => Promise<AgentDevicePort | undefined> }) =>
        useAgentPresence(p, undefined, undefined, () => link),
      { initialProps: { p: port as (() => Promise<AgentDevicePort | undefined>) | undefined } }
    )
    expect(said()).toContain(`[VTA] presence: started, every ${HEARTBEAT_INTERVAL_MS / 1000} s (linked/online)`)
    // The connection drops: TabStack takes the port away, and the loop stops.
    link = { ...online, connection: { kind: 'offline' } } as unknown as VtaLinkState
    rerender({ p: undefined })
    expect(said()).toContain('[VTA] presence: stopped (linked/offline)')
    // Not online: nothing starts.
    expect(said().filter((l) => l.startsWith('[VTA] presence: started'))).toHaveLength(1)
    unmount()
  })

  // 7a on #474: the link getter was an effect dependency, so an inline arrow restarted the heartbeat every render.
  it('an inline link getter does not restart the loop on a re-render', () => {
    const port = async () => portFailing()
    const { rerender, unmount } = renderHook(() => useAgentPresence(port, undefined, undefined, () => online))
    rerender({})
    rerender({})
    expect(said().filter((l) => l.startsWith('[VTA] presence: started'))).toHaveLength(1)
    expect(said().filter((l) => l.startsWith('[VTA] presence: stopped'))).toHaveLength(0)
    unmount()
  })
})
