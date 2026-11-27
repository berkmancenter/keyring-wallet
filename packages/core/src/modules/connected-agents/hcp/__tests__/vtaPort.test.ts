/**
 * The HCP port reaches the VTA through the session exactly as `vtaPorts` does, never waiting for a consent this
 * phone would give, and sends nothing with the flags off. `callHcp` turns what is thrown into a value.
 */
import type { Agent } from '@credo-ts/core'

import type { VtaClient } from '../../../trust-tasks/module/VtaClient'
import { setAgentConnectEnabled } from '../../agentConnectFlag'
import type { VtaSession } from '../../services'
import { setHcpEnabled } from '../hcpFlag'
import { HCP_GRANTS_REVOKE } from '../types'
import { callHcp, HCP_TASK_TIMEOUT_MS, HcpOffError, hcpVtaPort, type HcpVtaPort } from '../vtaPort'

const AGENT = { id: 'agent' } as unknown as Agent
const VTA = 'did:web:vta.example.org'
const GRANT = 'urn:uuid:3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b'

function fakeSession(answer: () => Promise<unknown>) {
  const task = jest.fn(answer)
  const withAgentSession = jest.fn((_agent: Agent, _vtaDid: string, use: (client: VtaClient) => Promise<unknown>) =>
    use({ task } as unknown as VtaClient)
  )
  const session = { withAgentSession } as unknown as Pick<VtaSession, 'withAgentSession'>
  return { session, task, withAgentSession }
}

const portThrowing = (error: unknown): HcpVtaPort => ({ task: () => Promise.reject(error) })

describe('hcpVtaPort', () => {
  afterEach(() => {
    setHcpEnabled(false)
    setAgentConnectEnabled(false)
  })

  it('sends the task through the session, with waitForConsent false', async () => {
    setAgentConnectEnabled(true)
    setHcpEnabled(true)
    const { session, task, withAgentSession } = fakeSession(async () => ({}))
    await expect(hcpVtaPort(AGENT, VTA, session).task(HCP_GRANTS_REVOKE, { grantId: GRANT })).resolves.toEqual({})
    expect(withAgentSession).toHaveBeenCalledTimes(1)
    expect(withAgentSession.mock.calls[0][0]).toBe(AGENT)
    expect(withAgentSession.mock.calls[0][1]).toBe(VTA)
    expect(task).toHaveBeenCalledTimes(1)
    expect(task.mock.calls[0]).toEqual([
      HCP_GRANTS_REVOKE,
      { grantId: GRANT },
      HCP_TASK_TIMEOUT_MS,
      {},
      undefined,
      { waitForConsent: false },
    ])
  })

  it.each([
    [false, false],
    [true, false],
    [false, true],
  ])('control: with agent connect %s and hcp %s, sends nothing and rejects', async (agentConnectOn, hcpOn) => {
    setAgentConnectEnabled(agentConnectOn)
    setHcpEnabled(hcpOn)
    const { session, withAgentSession } = fakeSession(async () => ({}))
    await expect(hcpVtaPort(AGENT, VTA, session).task(HCP_GRANTS_REVOKE, { grantId: GRANT })).rejects.toBeInstanceOf(
      HcpOffError
    )
    expect(withAgentSession).not.toHaveBeenCalled()
  })

  it('with the flags off, callHcp gives off, not unreachable', async () => {
    const { session, withAgentSession } = fakeSession(async () => ({}))
    await expect(callHcp(hcpVtaPort(AGENT, VTA, session), HCP_GRANTS_REVOKE, { grantId: GRANT })).resolves.toEqual({
      ok: false,
      off: true,
    })
    expect(withAgentSession).not.toHaveBeenCalled()
  })
})

describe('callHcp', () => {
  it('gives the value of a task that succeeds', async () => {
    const port: HcpVtaPort = { task: async () => ({ entry: { id: 'x' } }) }
    await expect(callHcp(port, HCP_GRANTS_REVOKE, { grantId: GRANT })).resolves.toEqual({
      ok: true,
      value: { entry: { id: 'x' } },
    })
  })

  it('gives refused with the code of a VtiRefusal', async () => {
    await expect(
      callHcp(portThrowing({ name: 'VtiRefusal', code: 'permissionDenied' }), HCP_GRANTS_REVOKE, { grantId: GRANT })
    ).resolves.toEqual({ ok: false, refused: 'permissionDenied' })
    const refusal = Object.assign(new Error('refused'), { name: 'VtiRefusal', code: 'notFound' })
    await expect(callHcp(portThrowing(refusal), HCP_GRANTS_REVOKE, { grantId: GRANT })).resolves.toEqual({
      ok: false,
      refused: 'notFound',
    })
  })

  it('gives refused "unknown" for a VtiRefusal without a code', async () => {
    await expect(callHcp(portThrowing({ name: 'VtiRefusal' }), HCP_GRANTS_REVOKE, {})).resolves.toEqual({
      ok: false,
      refused: 'unknown',
    })
  })

  it.each([
    ['an Error', new Error('socket closed')],
    ['a timeout', Object.assign(new Error('timed out'), { name: 'TimeoutError' })],
    ['a code without the refusal name', { name: 'Error', code: 'permissionDenied' }],
    ['a string', 'boom'],
    ['undefined', undefined],
    ['an Error only named like the off error', Object.assign(new Error('HCP is off'), { name: 'HcpOffError' })],
  ])('control: %s thrown gives unreachable', async (_name, thrown) => {
    await expect(callHcp(portThrowing(thrown), HCP_GRANTS_REVOKE, { grantId: GRANT })).resolves.toEqual({
      ok: false,
      unreachable: true,
    })
  })
})
