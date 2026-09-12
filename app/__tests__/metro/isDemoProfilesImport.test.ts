// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isDemoProfilesBarrelImport } = require('../../metro/isDemoProfilesImport')

describe('isDemoProfilesBarrelImport', () => {
  it('matches the relative barrel import App.tsx actually uses', () => {
    expect(isDemoProfilesBarrelImport('./src/demo-profiles')).toBe(true)
  })

  it('matches any specifier ending in /demo-profiles, for resilience to how it is phrased', () => {
    expect(isDemoProfilesBarrelImport('../src/demo-profiles')).toBe(true)
    expect(isDemoProfilesBarrelImport('/absolute/path/to/src/demo-profiles')).toBe(true)
  })

  it("does not match a deep import into one profile's own internals", () => {
    expect(isDemoProfilesBarrelImport('./src/demo-profiles/approver/ApproverProfile')).toBe(false)
    expect(isDemoProfilesBarrelImport('./src/demo-profiles/types')).toBe(false)
  })

  it('does not match an unrelated module that merely contains the substring', () => {
    expect(isDemoProfilesBarrelImport('./src/demo-profiles-legacy')).toBe(false)
    expect(isDemoProfilesBarrelImport('some-other-package')).toBe(false)
  })
})
