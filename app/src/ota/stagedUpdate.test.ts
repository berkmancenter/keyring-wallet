import { stagedUpdateIdOf } from './stagedUpdate'

jest.mock('react-native-fs', () => ({ DocumentDirectoryPath: '/docs', exists: jest.fn(), readFile: jest.fn() }))

const FP = 'e8edeb672d529412639097bc1e987d65aa5d1086'
const ID = '01a170d8-63a6-7376-9481-3128680b68f9'

// The shapes hot-updater 0.36.18 writes, as read on the phones on 10-22 to 10-25.
const ios = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    isolation_key: `hotupdater_${FP}_0.2.0+271_production_`,
    stable_bundle_id: null,
    staging_bundle_id: ID,
    verification_pending: true,
    launch_in_progress: false,
    ...over,
  })
const android = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    schema: 'metadata-v1',
    isolationKey: `HotUpdaterPrefs_${FP}_0.2.0+271_production`,
    stableBundleId: null,
    stagingBundleId: ID,
    verificationPending: true,
    launchInProgress: false,
    ...over,
  })

describe('stagedUpdateIdOf', () => {
  it("reads the staged update from either platform's metadata", () => {
    expect(stagedUpdateIdOf(ios(), FP)).toBe(ID)
    expect(stagedUpdateIdOf(android(), FP)).toBe(ID)
  })

  it('has nothing staged once the update has been launched and verified', () => {
    expect(stagedUpdateIdOf(ios({ verification_pending: false }), FP)).toBeUndefined()
    expect(stagedUpdateIdOf(android({ verificationPending: false }), FP)).toBeUndefined()
  })

  it('has nothing staged after a rollback, which clears staging', () => {
    expect(stagedUpdateIdOf(ios({ staging_bundle_id: null, verification_pending: false }), FP)).toBeUndefined()
    expect(stagedUpdateIdOf(android({ stagingBundleId: null }), FP)).toBeUndefined()
  })

  it('ignores metadata another build wrote (another fingerprint in the key)', () => {
    expect(stagedUpdateIdOf(ios(), '80ac04b377b593b2621517a5c6b34f261dd50117')).toBeUndefined()
    expect(stagedUpdateIdOf(android({ isolationKey: null }), FP)).toBeUndefined()
    expect(stagedUpdateIdOf(ios(), null)).toBeUndefined()
  })

  it('reads nothing from a missing or malformed file', () => {
    expect(stagedUpdateIdOf(undefined, FP)).toBeUndefined()
    expect(stagedUpdateIdOf('not json', FP)).toBeUndefined()
    expect(stagedUpdateIdOf(ios({ staging_bundle_id: '' }), FP)).toBeUndefined()
  })
})
