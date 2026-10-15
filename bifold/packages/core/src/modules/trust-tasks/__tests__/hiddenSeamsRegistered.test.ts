/**
 * Both hidden-vetting seams register when the wallet imports the package.
 *
 * A seam registers itself as a side effect of its adapter module being
 * imported, and nothing else imports an adapter. So an adapter that is
 * written, tested and committed, but never re-exported, registers nothing:
 * `hiddenVetterSeam()` returns undefined, the screens show nothing, and every
 * unit test still passes — because each one imports the adapter directly.
 *
 * That is exactly what happened to the vetter adapter between its own suite
 * going green and this test being written. Both entry points are checked: the
 * module index, and `src/index.ts`, which is what the wallet means by
 * '@bifold/core' (app/App.tsx; Metro resolves it from source via
 * BIFOLD_SOURCE_PACKAGES, and the built lib/commonjs carries the same
 * re-export). Testing only the module index would leave the wallet's real
 * entry point untested.
 *
 * Each case runs in its own module registry, because registration is a
 * one-time side effect: a second `require` of an already-loaded module does
 * nothing, so a shared registry would make every case after the first vacuous.
 */
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

/** Load `entry` in a fresh registry and report whether each seam registered. */
const registeredVia = (entry: string): { applicant: boolean; vetter: boolean } => {
  let seen = { applicant: false, vetter: false }
  jest.isolateModules(() => {
    const applicantSeam = require('../screens/hiddenVettingSeam') as typeof import('../screens/hiddenVettingSeam')
    const vetterSeam = require('../screens/hiddenVetterSeam') as typeof import('../screens/hiddenVetterSeam')
    // Nothing is registered until something imports an adapter.
    expect(applicantSeam.hiddenVettingSeam()).toBeUndefined()
    expect(vetterSeam.hiddenVetterSeam()).toBeUndefined()

    require(entry)

    seen = {
      applicant: applicantSeam.hiddenVettingSeam() !== undefined,
      vetter: vetterSeam.hiddenVetterSeam() !== undefined,
    }
  })
  return seen
}

describe('the entry points that put the hidden-vetting modules in a build', () => {
  it("registers both seams through the package root, which is what '@bifold/core' means", () => {
    expect(registeredVia('../../../index')).toEqual({ applicant: true, vetter: true })
  })

  it('registers both seams through the module index', () => {
    expect(registeredVia('../index')).toEqual({ applicant: true, vetter: true })
  })
})

describe('the vetter seam, once registered', () => {
  it('offers every method the vetter screens call', () => {
    jest.isolateModules(() => {
      const { hiddenVetterSeam } =
        require('../screens/hiddenVetterSeam') as typeof import('../screens/hiddenVetterSeam')
      require('../index')
      const seam = hiddenVetterSeam()
      for (const name of ['standing', 'enrol', 'drawTokens', 'requests', 'attest', 'decline'] as const) {
        expect(typeof seam?.[name]).toBe('function')
      }
    })
  })
})
