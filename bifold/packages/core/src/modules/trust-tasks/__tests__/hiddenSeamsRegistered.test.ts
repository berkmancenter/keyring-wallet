/**
 * Both hidden-vetting seams register when the module index is imported.
 *
 * A seam registers itself as a side effect of its adapter module being
 * imported, and nothing else imports an adapter. So an adapter that is written,
 * tested and committed, but never re-exported from `index.ts`, registers
 * nothing: `hiddenVetterSeam()` returns undefined, the private-vouching entry
 * never appears, and every unit test still passes — because each one imports
 * the adapter directly.
 *
 * That is exactly what happened to the vetter adapter between its own suite
 * going green and this test being written. This test imports the index the way
 * the app does, and nothing else, so it fails if either side falls out of the
 * bundle again.
 */
import { hiddenVettingSeam } from '../screens/hiddenVettingSeam'
import { hiddenVetterSeam } from '../screens/hiddenVetterSeam'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

describe('importing the module index', () => {
  it('registers the applicant and the vetter side both', () => {
    expect(hiddenVettingSeam()).toBeUndefined()
    expect(hiddenVetterSeam()).toBeUndefined()

    require('../index')

    expect(hiddenVettingSeam()).toBeDefined()
    expect(hiddenVetterSeam()).toBeDefined()
  })

  it('offers every method the vetter screens call', () => {
    require('../index')
    const seam = hiddenVetterSeam()
    for (const name of ['standing', 'enrol', 'drawTokens', 'requests', 'attest', 'decline'] as const) {
      expect(typeof seam?.[name]).toBe('function')
    }
  })
})
