import * as realDemoProfiles from '@/demo-profiles'
import * as stub from '../../metro/demoProfilesStub'

describe('demoProfilesStub', () => {
  it('exports the same public API surface as the real demo-profiles barrel', () => {
    // App.tsx's own two-line integration only ever touches these two names —
    // if the real module's public surface changes, this catches the stub
    // silently drifting out of sync with it (see metro.config.js's own
    // resolveRequest rule, which swaps one module for the other verbatim).
    expect(Object.keys(stub).sort()).toEqual(Object.keys(realDemoProfiles).sort())
  })

  it('carries no profiles and registers nothing', () => {
    expect(stub.installedDemoProfiles).toEqual([])
    expect(stub.selectDemoProfiles(undefined)).toEqual([])
    expect(stub.selectDemoProfiles('approver')).toEqual([])
    expect(stub.selectDemoProfiles('none')).toEqual([])

    const registerSpy = jest.fn()
    const fakeContainer = { container: { register: registerSpy } } as any
    expect(() => stub.registerDemoProfiles(fakeContainer, [])).not.toThrow()
    expect(registerSpy).not.toHaveBeenCalled()
  })
})
