/**
 * The steps of an agent host's setup, as a person reads them: what is done,
 * what is happening now and for how long, and which sign-in try it is.
 */
import type { TFunction } from 'i18next'

import { elapsedClock, hostSetupRows } from '../screens/HostSetupSteps'

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}(${values.attempt}/${values.of})` : key) as unknown as TFunction

describe('the steps of a hosted agent’s setup', () => {
  it('says nothing until the phone knows where the host has got to', () => {
    expect(hostSetupRows(undefined, 0, t)).toEqual([])
  })

  it('while the host creates the agent: that step, timed, and connecting still to come', () => {
    expect(hostSetupRows({ step: 'creating', since: 1_000 }, 43_000, t)).toEqual([
      { key: 'creating', label: 'VtaLink.Host.Steps.Creating', state: 'current', elapsed: '0:42' },
      { key: 'connecting', label: 'VtaLink.Host.Steps.Connecting', state: 'pending' },
    ])
  })

  it('once the agent is ready: creating done, this phone connecting, timed from then', () => {
    expect(hostSetupRows({ step: 'connecting', since: 100_000 }, 105_000, t)).toEqual([
      { key: 'creating', label: 'VtaLink.Host.Steps.Creating', state: 'done' },
      { key: 'connecting', label: 'VtaLink.Host.Steps.Connecting', state: 'current', elapsed: '0:05' },
    ])
  })

  it('a sign-in tried again says which try it is', () => {
    const [, connecting] = hostSetupRows({ step: 'signingIn', since: 0, attempt: 3, of: 24 }, 185_000, t)
    expect(connecting).toEqual({
      key: 'connecting',
      label: 'VtaLink.Host.Steps.SigningIn(3/24)',
      state: 'current',
      elapsed: '3:05',
    })
  })

  it('times as m:ss, never negative', () => {
    expect(elapsedClock(0)).toBe('0:00')
    expect(elapsedClock(59_999)).toBe('0:59')
    expect(elapsedClock(600_000)).toBe('10:00')
    expect(elapsedClock(-5_000)).toBe('0:00')
  })
})
