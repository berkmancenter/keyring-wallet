import { installedDemoProfiles, selectDemoProfiles } from '@/demo-profiles'
import approverProfile from '@/demo-profiles/approver/ApproverProfile'
import tradingCardProfile from '@/demo-profiles/trading-card/TradingCardProfile'

describe('selectDemoProfiles', () => {
  it('registers none when unset: a shipped build is a plain Keyring build', () => {
    expect(selectDemoProfiles(undefined)).toEqual([])
    expect(selectDemoProfiles('')).toEqual([])
  })

  it('registers every installed profile for "all", the demo-day setting', () => {
    expect(selectDemoProfiles('all')).toEqual(installedDemoProfiles)
  })

  it('narrows to a single profile by id', () => {
    expect(selectDemoProfiles('trading-card')).toEqual([tradingCardProfile])
    expect(selectDemoProfiles('approver')).toEqual([approverProfile])
  })

  it('registers none for an id that matches nothing', () => {
    // A typo'd or removed id must never switch demo code on in a build.
    expect(selectDemoProfiles('not-a-real-profile')).toEqual([])
  })

  it('excludes every profile for the "none" sentinel', () => {
    expect(selectDemoProfiles('none')).toEqual([])
  })
})
