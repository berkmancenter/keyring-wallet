import { HotUpdater } from '@hot-updater/react-native'
import React from 'react'
import { Text } from 'react-native'

import { isOtaEnabled, otaUpdateUrl } from './otaConfig'
import { otaLabel, OtaClient, readOtaStatus } from './otaStatus'
import { DEFAULT_RING, ensureRing, isRing, setRing } from './rings'
import { withOta } from './withOta'

const fakeStore = (initial: string) => {
  let cohort = initial
  return {
    getCohort: () => cohort,
    setCohort: jest.fn((next: string) => {
      cohort = next
    }),
  }
}

describe('otaConfig', () => {
  it('is off without a URL', () => {
    expect(otaUpdateUrl({})).toBeUndefined()
    expect(otaUpdateUrl({ OTA_UPDATE_URL: '  ' })).toBeUndefined()
    expect(isOtaEnabled({})).toBe(false)
  })

  it('is off for a cleartext URL, which a release build cannot reach', () => {
    expect(otaUpdateUrl({ OTA_UPDATE_URL: 'http://192.168.1.2:3080/hot-updater' })).toBeUndefined()
  })

  it('is on for an https URL, without a trailing slash', () => {
    expect(otaUpdateUrl({ OTA_UPDATE_URL: 'https://ota.example.org/hot-updater/' })).toBe(
      'https://ota.example.org/hot-updater'
    )
  })
})

describe('rings', () => {
  it('moves an install with a numeric cohort to the default ring, never keeping a per-install number', () => {
    const store = fakeStore('411')
    expect(ensureRing(store)).toBe(DEFAULT_RING)
    expect(store.setCohort).toHaveBeenCalledWith(DEFAULT_RING)
  })

  it('keeps an install that is already in a ring', () => {
    const store = fakeStore('ring0')
    expect(ensureRing(store)).toBe('ring0')
    expect(store.setCohort).not.toHaveBeenCalled()
  })

  it('moves an install between rings', () => {
    const store = fakeStore('ring2')
    setRing(store, 'ring0')
    expect(store.getCohort()).toBe('ring0')
    expect(isRing('ring3')).toBe(false)
  })
})

describe('otaStatus', () => {
  const client = (bundleId: string, cohort = 'ring2'): OtaClient => ({
    getBundleId: () => bundleId,
    getMinBundleId: () => 'min-0000',
    getChannel: () => 'production',
    getCohort: () => cohort,
    getFingerprintHash: () => 'abc123',
    getCrashHistory: () => ['bad-bundle'],
  })

  it('reports the shipped bundle as embedded', () => {
    const status = readOtaStatus(client('min-0000'), true)
    expect(status).toMatchObject({ embedded: true, ring: 'ring2', rolledBack: ['bad-bundle'] })
    expect(otaLabel(status)).toBe('embedded')
  })

  it('reports an installed update by a short id', () => {
    const status = readOtaStatus(client('0192f3a4-5b6c-7d8e-9f00-112233445566', '411'), true)
    expect(status.embedded).toBe(false)
    expect(status.ring).toBeUndefined()
    expect(otaLabel(status)).toBe('0192f3a4')
  })

  it('has no label when OTA is off', () => {
    expect(otaLabel(readOtaStatus(client('min-0000'), false))).toBeUndefined()
  })
})

describe('withOta', () => {
  const App: React.FC = () => <Text>app</Text>

  afterEach(() => jest.restoreAllMocks())

  it('returns the root unchanged and touches nothing when OTA is off', () => {
    const wrap = jest.spyOn(HotUpdater, 'wrap')
    const setCohort = jest.spyOn(HotUpdater, 'setCohort')
    expect(withOta(App, undefined)).toBe(App)
    expect(wrap).not.toHaveBeenCalled()
    expect(setCohort).not.toHaveBeenCalled()
  })

  it('puts the install in a ring and wraps with the fingerprint strategy, never reloading mid-session', () => {
    jest.spyOn(HotUpdater, 'getCohort').mockReturnValue('411')
    const setCohort = jest.spyOn(HotUpdater, 'setCohort')
    const Wrapped: React.FC = () => <Text>wrapped</Text>
    const wrap = jest.spyOn(HotUpdater, 'wrap').mockReturnValue(() => Wrapped)
    const log = jest.fn()

    expect(withOta(App, 'https://ota.example.org/hot-updater', log)).toBe(Wrapped)
    expect(setCohort).toHaveBeenCalledWith(DEFAULT_RING)
    expect(wrap).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://ota.example.org/hot-updater',
        updateStrategy: 'fingerprint',
        reloadOnForceUpdate: false,
      })
    )
    expect(log).toHaveBeenCalledWith('enabled', expect.objectContaining({ ring: DEFAULT_RING }))
  })

  it('runs without updates when the binary has no loader', () => {
    jest.spyOn(HotUpdater, 'getCohort').mockImplementation(() => {
      throw new Error('native module missing')
    })
    const wrap = jest.spyOn(HotUpdater, 'wrap')
    const log = jest.fn()
    expect(withOta(App, 'https://ota.example.org/hot-updater', log)).toBe(App)
    expect(wrap).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('loader unavailable, running without updates', expect.anything())
  })
})
