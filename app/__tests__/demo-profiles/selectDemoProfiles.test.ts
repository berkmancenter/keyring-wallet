import { installedDemoProfiles, selectDemoProfiles } from '@/demo-profiles'
import approverProfile from '@/demo-profiles/approver/ApproverProfile'
import tradingCardProfile from '@/demo-profiles/trading-card/TradingCardProfile'

describe('selectDemoProfiles', () => {
  it('registers every installed profile when unset', () => {
    expect(selectDemoProfiles(undefined)).toEqual(installedDemoProfiles)
  })

  it('narrows to a single profile by id', () => {
    expect(selectDemoProfiles('trading-card')).toEqual([tradingCardProfile])
    expect(selectDemoProfiles('approver')).toEqual([approverProfile])
  })

  it('falls back to every installed profile for an id that matches nothing', () => {
    // A typo'd or removed profile id is a config mistake, not a request for
    // zero profiles — the "none" sentinel below is the only way to get [].
    expect(selectDemoProfiles('not-a-real-profile')).toEqual(installedDemoProfiles)
  })

  it('excludes every profile for the "none" sentinel', () => {
    expect(selectDemoProfiles('none')).toEqual([])
  })
})
