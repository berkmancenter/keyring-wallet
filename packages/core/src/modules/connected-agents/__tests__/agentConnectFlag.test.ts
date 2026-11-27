/**
 * "Off by default" as a property the suite holds, not a line someone must notice (#1060 findings 15 and 19: with the
 * flag on, an agent can show Connected before §3.4's acceptance, and before Revoke exists). Each test reads a fresh
 * module, so no other suite's setter call can leak in.
 */

type FlagModule = typeof import('../agentConnectFlag')

function freshFlag(): FlagModule {
  let mod: FlagModule | undefined
  jest.isolateModules(() => {
    mod = require('../agentConnectFlag') as FlagModule
  })
  if (!mod) throw new Error('module not loaded')
  return mod
}

describe('the agent-connect developer flag', () => {
  it('is off on a fresh import, before anything calls the setter', () => {
    expect(freshFlag().isAgentConnectEnabled()).toBe(false)
  })

  it('control: the setter turns it on, and a fresh import is off again', () => {
    const flag = freshFlag()
    flag.setAgentConnectEnabled(true)
    expect(flag.isAgentConnectEnabled()).toBe(true)
    expect(freshFlag().isAgentConnectEnabled()).toBe(false)
  })
})
