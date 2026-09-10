/**
 * `index.ts` is the JS↔native bridge and had zero test coverage: every
 * caller (`AndroidBleDeviceLocalityProvider.test.ts` in `@bifold/core`)
 * mocks this whole module rather than importing it for real, so its own
 * branching — the turbo-vs-legacy module lookup, the throw-when-unlinked
 * path, `isSupportedPlatform`, and `getBridge`'s "fresh object each call"
 * workaround (this file's own comment documents the ESM-interop bug it
 * sidesteps) — was never exercised.
 *
 * `react-native` is mocked wholesale, virtually, rather than pulled in via
 * a preset: this module only touches three named exports
 * (`NativeModules`, `Platform`, `TurboModuleRegistry`), and the real
 * package can't be `require()`d outside a Metro/RN runtime anyway. The
 * module under test reads all three at *import* time (`NativeLocalityPeripheralSpec`
 * is resolved via `TurboModuleRegistry.get()` as a module-level side
 * effect), so every scenario below does `jest.resetModules()` +
 * `jest.doMock('react-native', ...)` + a fresh `require('./index')`.
 */

type IndexModule = typeof import('./index')

function loadIndex(opts: {
  turboModuleProxyEnabled?: boolean
  turboModule?: unknown
  legacyModule?: unknown
  platformOS?: string
}): { mod: IndexModule; turboGet: jest.Mock } {
  jest.resetModules()

  const turboGet = jest.fn(() => opts.turboModule)
  jest.doMock(
    'react-native',
    () => ({
      NativeModules: opts.legacyModule !== undefined ? { LocalityPeripheral: opts.legacyModule } : {},
      Platform: { OS: opts.platformOS ?? 'android' },
      TurboModuleRegistry: { get: turboGet },
    }),
    { virtual: true }
  )

  if (opts.turboModuleProxyEnabled) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).__turboModuleProxy = () => undefined
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (global as any).__turboModuleProxy
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('./index') as IndexModule
  return { mod, turboGet }
}

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (global as any).__turboModuleProxy
  jest.dontMock('react-native')
  jest.resetModules()
})

const sampleParams = {
  serviceUuid: '4b524c31-0000-1000-8000-000000000000',
  characteristicUuid: '4b524c32-0000-1000-8000-2a2b3c4d5e6f',
  signatureCharacteristicUuid: '4b524c33-0000-1000-8000-2a2b3c4d5e6f',
  contextString: 'keyring-locality-v1',
  method: 'ble-challenge-response/0.1' as const,
  taskDigestMultibase: 'sha256:deadbeef',
  challenge: 'a-challenge',
  sensorDid: 'did:peer:4witness',
  hardwareAttestation: 'present-unverified' as const,
  windowSeconds: 30,
  authMode: 'biometric' as const,
}

describe('isNativeModuleLinked', () => {
  test('false when neither the turbo module nor the legacy NativeModules entry resolves', () => {
    const { mod } = loadIndex({})
    expect(mod.isNativeModuleLinked()).toBe(false)
  })

  test('true when the legacy bridge (NativeModules.LocalityPeripheral) is present', () => {
    const { mod } = loadIndex({ legacyModule: { respondToSensor: jest.fn() } })
    expect(mod.isNativeModuleLinked()).toBe(true)
  })

  test('true when TurboModules are enabled and the registry resolves the spec — and the legacy NativeModules entry is ignored', () => {
    const { mod, turboGet } = loadIndex({
      turboModuleProxyEnabled: true,
      turboModule: { respondToSensor: jest.fn() },
      legacyModule: undefined,
    })
    expect(mod.isNativeModuleLinked()).toBe(true)
    expect(turboGet).toHaveBeenCalledWith('LocalityPeripheral')
  })

  test('false when TurboModules are enabled but the registry resolves nothing, even if a legacy NativeModules entry exists', () => {
    const { mod } = loadIndex({
      turboModuleProxyEnabled: true,
      turboModule: undefined,
      legacyModule: { respondToSensor: jest.fn() },
    })
    expect(mod.isNativeModuleLinked()).toBe(false)
  })
})

describe('respondToSensor', () => {
  test('throws the linking error when unlinked', async () => {
    const { mod } = loadIndex({})
    await expect(mod.respondToSensor(sampleParams)).rejects.toThrow(
      "The package '@bifold/react-native-locality-peripheral' is not linked"
    )
  })

  test('forwards params to the native module and returns its result when linked', async () => {
    const nativeResult = {
      sensorNonceHex: 'deadbeef',
      devicePublicKeyBase64: 'ZmFrZS1wdWJsaWMta2V5',
      signatureBase64Url: 'ZmFrZS1zaWduYXR1cmU',
    }
    const respondToSensor = jest.fn(async () => nativeResult)
    const { mod } = loadIndex({ legacyModule: { respondToSensor } })

    const result = await mod.respondToSensor(sampleParams)

    expect(respondToSensor).toHaveBeenCalledWith(sampleParams)
    expect(result).toBe(nativeResult)
  })

  test('resolves null when the native module resolves null (windowLost/declined)', async () => {
    const respondToSensor = jest.fn(async () => null)
    const { mod } = loadIndex({ legacyModule: { respondToSensor } })

    await expect(mod.respondToSensor(sampleParams)).resolves.toBeNull()
  })
})

describe('isPeripheralSupported', () => {
  test('false when unlinked', async () => {
    const { mod } = loadIndex({})
    await expect(mod.isPeripheralSupported()).resolves.toBe(false)
  })

  test('calls through to the native isSupported() when linked', async () => {
    const isSupported = jest.fn(async () => true)
    const { mod } = loadIndex({ legacyModule: { isSupported } })

    await expect(mod.isPeripheralSupported()).resolves.toBe(true)
    expect(isSupported).toHaveBeenCalledTimes(1)
  })
})

describe('stopAdvertising', () => {
  test('is a safe no-op when unlinked', async () => {
    const { mod } = loadIndex({})
    await expect(mod.stopAdvertising()).resolves.toBeUndefined()
  })

  test('calls through to the native stopAdvertising() when linked', async () => {
    const stopAdvertising = jest.fn(async () => undefined)
    const { mod } = loadIndex({ legacyModule: { stopAdvertising } })

    await mod.stopAdvertising()
    expect(stopAdvertising).toHaveBeenCalledTimes(1)
  })

  test('swallows a throw from the native stopAdvertising() — best-effort by contract', async () => {
    const stopAdvertising = jest.fn(async () => {
      throw new Error('nothing to tear down')
    })
    const { mod } = loadIndex({ legacyModule: { stopAdvertising } })

    await expect(mod.stopAdvertising()).resolves.toBeUndefined()
  })
})

describe('isSupportedPlatform', () => {
  test('true on android', () => {
    const { mod } = loadIndex({ platformOS: 'android' })
    expect(mod.isSupportedPlatform()).toBe(true)
  })

  test('false on ios (no native implementation yet)', () => {
    const { mod } = loadIndex({ platformOS: 'ios' })
    expect(mod.isSupportedPlatform()).toBe(false)
  })

  test('false on any other platform', () => {
    const { mod } = loadIndex({ platformOS: 'windows' })
    expect(mod.isSupportedPlatform()).toBe(false)
  })
})

describe('getBridge', () => {
  test('returns a fresh object each call — the documented ESM-interop workaround', () => {
    const { mod } = loadIndex({ legacyModule: { respondToSensor: jest.fn(), stopAdvertising: jest.fn(), isSupported: jest.fn() } })

    const first = mod.getBridge()
    const second = mod.getBridge()

    expect(first).not.toBe(second)
    expect(first).toEqual(second)
  })

  test('the bundled functions delegate to the same underlying native calls as the top-level exports', async () => {
    const isSupported = jest.fn(async () => true)
    const respondToSensor = jest.fn(async () => null)
    const stopAdvertising = jest.fn(async () => undefined)
    const { mod } = loadIndex({ legacyModule: { isSupported, respondToSensor, stopAdvertising } })

    const bridge = mod.getBridge()
    await bridge.isSupported()
    await bridge.respondToSensor(sampleParams)
    await bridge.stopAdvertising()

    expect(isSupported).toHaveBeenCalledTimes(1)
    expect(respondToSensor).toHaveBeenCalledWith(sampleParams)
    expect(stopAdvertising).toHaveBeenCalledTimes(1)
  })
})
