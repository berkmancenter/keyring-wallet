import { isolationKeyFor, stagedUpdateIdOf } from './stagedUpdate'

jest.mock('react-native-fs', () => ({ DocumentDirectoryPath: '/docs', exists: jest.fn(), readFile: jest.fn() }))

const FP = 'e8edeb672d529412639097bc1e987d65aa5d1086'
const ID = '01a170d8-63a6-7376-9481-3128680b68f9'
// The keys the 271 store build used on the phones: the iPhone 11's log (10-24) and the emulator's metadata (10-25).
const IOS_KEY = `hotupdater_${FP}_0.2.0+271_production_`
const ANDROID_KEY = `HotUpdaterPrefs_${FP}_0.2.0+271_production`

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

describe('isolationKeyFor', () => {
  const build271 = { fingerprint: FP, appVersion: '0.2.0', buildNumber: '271', channel: 'production' }

  it('composes the key exactly as AppDelegate.mm and MainApplication.kt set it', () => {
    expect(isolationKeyFor({ platform: 'ios', ...build271 })).toBe(IOS_KEY)
    expect(isolationKeyFor({ platform: 'android', ...build271 })).toBe(ANDROID_KEY)
  })

  it('without a fingerprint or a version, falls back as the natives do', () => {
    expect(isolationKeyFor({ platform: 'ios', ...build271, fingerprint: null })).toBe(
      'hotupdater_0.2.0+271_production_'
    )
    expect(isolationKeyFor({ platform: 'android', ...build271, appVersion: null })).toBe(
      `HotUpdaterPrefs_${FP}_unknown+271_production`
    )
  })
})

describe('stagedUpdateIdOf', () => {
  it("reads the staged update from either platform's metadata", () => {
    expect(stagedUpdateIdOf(ios(), IOS_KEY)).toBe(ID)
    expect(stagedUpdateIdOf(android(), ANDROID_KEY)).toBe(ID)
  })

  it('has nothing staged once the update has been launched and verified', () => {
    expect(stagedUpdateIdOf(ios({ verification_pending: false }), IOS_KEY)).toBeUndefined()
    expect(stagedUpdateIdOf(android({ verificationPending: false }), ANDROID_KEY)).toBeUndefined()
  })

  it('has nothing staged after a rollback, which clears staging', () => {
    expect(stagedUpdateIdOf(ios({ staging_bundle_id: null, verification_pending: false }), IOS_KEY)).toBeUndefined()
    expect(stagedUpdateIdOf(android({ stagingBundleId: null }), ANDROID_KEY)).toBeUndefined()
  })

  it('ignores metadata another build wrote, even with the same fingerprint', () => {
    // A store build with only JavaScript changes: same fingerprint, the next build number.
    expect(stagedUpdateIdOf(ios(), `hotupdater_${FP}_0.2.0+272_production_`)).toBeUndefined()
    expect(stagedUpdateIdOf(android(), `HotUpdaterPrefs_${FP}_0.2.0+272_production`)).toBeUndefined()
    // Another fingerprint, a missing key, or the other platform's form.
    expect(
      stagedUpdateIdOf(ios(), 'hotupdater_80ac04b377b593b2621517a5c6b34f261dd50117_0.2.0+271_production_')
    ).toBeUndefined()
    expect(stagedUpdateIdOf(android({ isolationKey: null }), ANDROID_KEY)).toBeUndefined()
    expect(stagedUpdateIdOf(ios(), ANDROID_KEY)).toBeUndefined()
  })

  it('reads nothing from a missing or malformed file', () => {
    expect(stagedUpdateIdOf(undefined, IOS_KEY)).toBeUndefined()
    expect(stagedUpdateIdOf('not json', IOS_KEY)).toBeUndefined()
    expect(stagedUpdateIdOf(ios({ staging_bundle_id: '' }), IOS_KEY)).toBeUndefined()
  })
})
