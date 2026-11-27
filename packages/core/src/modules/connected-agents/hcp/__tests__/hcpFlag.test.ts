/**
 * The HCP flag is off by default, and the HCP demo runs only with both it and agent connect on. Each test reads a
 * fresh pair of modules (`jest.isolateModules`), so no other suite's setter call can leak in.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

type HcpFlagModule = typeof import('../hcpFlag')
type AgentConnectFlagModule = typeof import('../../agentConnectFlag')

function fresh(): { hcp: HcpFlagModule; agentConnect: AgentConnectFlagModule } {
  let hcp: HcpFlagModule | undefined
  let agentConnect: AgentConnectFlagModule | undefined
  jest.isolateModules(() => {
    agentConnect = require('../../agentConnectFlag') as AgentConnectFlagModule
    hcp = require('../hcpFlag') as HcpFlagModule
  })
  if (!hcp || !agentConnect) throw new Error('modules not loaded')
  return { hcp, agentConnect }
}

describe('the HCP developer flag', () => {
  it('is off on a fresh import, alone and together with agent connect', () => {
    const { hcp } = fresh()
    expect(hcp.isHcpFlagOn()).toBe(false)
    expect(hcp.isHcpEnabled()).toBe(false)
  })

  it.each([
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [true, true, true],
  ])('with agent connect %s and hcp %s, isHcpEnabled() is %s', (agentConnectOn, hcpOn, enabled) => {
    const { hcp, agentConnect } = fresh()
    agentConnect.setAgentConnectEnabled(agentConnectOn)
    hcp.setHcpEnabled(hcpOn)
    expect(hcp.isHcpFlagOn()).toBe(hcpOn)
    expect(hcp.isHcpEnabled()).toBe(enabled)
  })

  it('starts from the literal false in its source', () => {
    const source = readFileSync(join(__dirname, '..', 'hcpFlag.ts'), 'utf8')
    expect(source).toMatch(/^let hcpEnabled = false$/m)
  })

  it('control: the setter turns it on, and a fresh import is off again', () => {
    const { hcp } = fresh()
    hcp.setHcpEnabled(true)
    expect(hcp.isHcpFlagOn()).toBe(true)
    expect(fresh().hcp.isHcpFlagOn()).toBe(false)
  })
})
