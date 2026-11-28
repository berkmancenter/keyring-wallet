import { agentActionLine, lineOfAction, type AgentActionCode } from '../actionLine'
import type { AgentActionLineKey, AgentActionName } from '../components/AgentActionNotice'

// ac's #1122 obligation 1: no agent action fails silently. Each (action, code) the actions return, read from
// actions.ts and keepConnected.ts on feat/agent-connect, gets the line agreed with the views' lane.
const RETURNS: Record<AgentActionName, AgentActionCode[]> = {
  extend: ['noRecord', 'notOffered', 'notListed', 'unreachable', 'notApplied', 'vdc'],
  restore: ['noRecord', 'notOffered', 'notListed', 'unreachable', 'notApplied', 'lastMemory'],
  retryPending: ['noRecord', 'notOffered', 'unreachable'],
  remove: ['noRecord', 'notOffered', 'unreachable', 'revokeUnavailable', 'revokeNotConfirmed', 'goneUnproven'],
  keepConnected: ['noRecord', 'notOffered', 'notListed', 'notSaved', 'unreachable', 'notApplied', 'notRecorded', 'vdc'],
  addMemory: ['noRecord', 'notOffered', 'notListed', 'unreachable', 'notApplied', 'lastMemory'],
  removeMemory: ['noRecord', 'notOffered', 'notListed', 'unreachable', 'notApplied', 'lastMemory'],
}

const SHARED: Partial<Record<AgentActionCode, AgentActionLineKey>> = {
  noRecord: 'ActionGone',
  notOffered: 'ActionNotOffered',
  notListed: 'ActionNotListed',
  unreachable: 'ActionNotConfirmed',
  notApplied: 'ActionNotApplied',
}
const OWN: Partial<Record<AgentActionName, Partial<Record<AgentActionCode, AgentActionLineKey | null>>>> = {
  extend: { vdc: 'ExtendNoCredential' },
  restore: { lastMemory: 'RestoreLastMemory' },
  retryPending: { unreachable: null },
  remove: {
    revokeUnavailable: 'RemoveNotAvailable',
    revokeNotConfirmed: 'RemoveNotConfirmed',
    goneUnproven: 'RemoveGoneUnproven',
  },
  keepConnected: { notSaved: 'KeepNotSaved', notRecorded: 'KeepNotRecorded', vdc: 'KeepNoCredential' },
  addMemory: { lastMemory: 'RestoreLastMemory' },
  removeMemory: { lastMemory: 'RestoreLastMemory' },
}

const ALL_CODES: AgentActionCode[] = [
  'noRecord',
  'notOffered',
  'notListed',
  'unreachable',
  'notApplied',
  'lastMemory',
  'vdc',
  'revokeUnavailable',
  'revokeNotConfirmed',
  'goneUnproven',
  'notSaved',
  'notRecorded',
]

describe('agentActionLine: every code an action returns has its agreed line', () => {
  for (const [action, codes] of Object.entries(RETURNS) as [AgentActionName, AgentActionCode[]][])
    for (const code of codes) {
      const own = OWN[action]
      const expected = own && code in own ? own[code] : SHARED[code]
      it(`${action} + ${code} → ${expected === null ? 'keeps the screen' : expected}`, () => {
        expect(expected).not.toBeUndefined()
        const line = agentActionLine(action, code, 'Laptop agent')
        expect(line === null ? null : line.key).toBe(expected)
      })
    }

  it('no action answers silently: every code gives a line, but for retryPending’s unreachable, which the plan settles', () => {
    for (const action of Object.keys(RETURNS) as AgentActionName[])
      for (const code of ALL_CODES) {
        const line = agentActionLine(action, code)
        if (action === 'retryPending' && code === 'unreachable') expect(line).toBeNull()
        else expect([action, code, line?.key]).toEqual([action, code, expect.any(String)])
      }
  })

  it('carries the agent’s name, and CONTROL: without one the line has none', () => {
    expect(agentActionLine('remove', 'revokeNotConfirmed', 'Laptop agent')).toEqual({
      key: 'RemoveNotConfirmed',
      name: 'Laptop agent',
    })
    expect(agentActionLine('remove', 'revokeNotConfirmed')).toEqual({ key: 'RemoveNotConfirmed' })
  })
})

describe('lineOfAction: the result a container awaits, as a line or none', () => {
  it('a success draws no line', async () => {
    expect(await lineOfAction('extend', Promise.resolve({ ok: true }))).toBeUndefined()
  })

  it('a failure draws its line', async () => {
    expect(await lineOfAction('extend', Promise.resolve({ ok: false, code: 'vdc' }), 'A')).toEqual({
      key: 'ExtendNoCredential',
      name: 'A',
    })
  })

  it('a retry that could not reach the VTA keeps the screen as it is', async () => {
    expect(await lineOfAction('retryPending', Promise.resolve({ ok: false, code: 'unreachable' }))).toBeUndefined()
  })

  it('a throw is told as not confirmed, never as nothing', async () => {
    expect(await lineOfAction('remove', Promise.reject(new Error('socket closed')))).toEqual({
      key: 'ActionNotConfirmed',
    })
  })
})
