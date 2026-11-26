/**
 * "Is private vetting in this build?" answered where an iPhone's report can
 * see it.
 *
 * The line `registerHiddenVettingModules` writes at module scope goes through
 * `releaseWarn` before the app's log buffer exists: Android's logcat keeps it,
 * iOS's report never had it. So the same line is said at Info through the
 * agent's logger, once per agent, from TabStack when it has one.
 */
import fs from 'fs'
import path from 'path'

import { logHiddenVettingSeams } from '../hiddenVettingModules'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const agentWith = () => {
  const info = jest.fn()
  return { agent: { config: { logger: { info } } }, info }
}

describe('the seams line, through the agent', () => {
  it('is said at Info, naming both seams as registered', () => {
    const { agent, info } = agentWith()
    logHiddenVettingSeams(agent)
    expect(info).toHaveBeenCalledWith('[hidden-vetting] seams: applicant=yes vetter=yes')
  })

  it('once per agent, and again for the agent an unlock builds anew', () => {
    const first = agentWith()
    logHiddenVettingSeams(first.agent)
    logHiddenVettingSeams(first.agent)
    expect(first.info).toHaveBeenCalledTimes(1)
    const next = agentWith()
    logHiddenVettingSeams(next.agent)
    expect(next.info).toHaveBeenCalledTimes(1)
  })

  it('does nothing before there is an agent', () => {
    expect(() => logHiddenVettingSeams(undefined)).not.toThrow()
  })

  it('TabStack says it whenever its agent changes', () => {
    const tabStack = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'navigators', 'TabStack.tsx'), 'utf8')
    expect(tabStack).toMatch(/useEffect\(\(\) => logHiddenVettingSeams\(agent\), \[agent\]\)/)
  })
})
