/**
 * `readFullValue` — the long-read chaining this session's live on-device
 * verification (2026-08-21) proved necessary and then fixed twice: once
 * for pacing (a real `le-connection-abort-by-local` from back-to-back
 * reads with no delay) and once for the iteration cap (too low for a
 * connection that never negotiates past the ATT default MTU). Both are
 * real BLE behaviors a mock can't reproduce — this only proves the
 * function's own control flow (chunk assembly, early-exit on valid JSON,
 * giving up on an empty chunk, the iteration cap) against a fake
 * characteristic, not against real radios.
 */
import { BleLocalityProvider, readFullValue, runTranscriptExchange, type BleCharacteristic, type BleDevice } from '../../src/trustTasks/BleLocalityProvider'
import { deriveEid, serviceUuidFromEid } from '../../src/trustTasks/locality'

const mockCreateBluetooth = jest.fn()
jest.mock('node-ble', () => ({
  createBluetooth: () => mockCreateBluetooth(),
}))

function fakeCharacteristic(chunks: Buffer[]): BleCharacteristic {
  let call = 0
  return {
    writeValue: jest.fn(async () => undefined),
    readValue: jest.fn(async (_offset?: number) => {
      const chunk = chunks[call] ?? Buffer.alloc(0)
      call += 1
      return chunk
    }),
  }
}

describe('readFullValue', () => {
  test('assembles a value delivered across multiple chunks', async () => {
    const payload = Buffer.from(JSON.stringify({ hello: 'world', pad: '0'.repeat(50) }))
    const chunkSize = 20
    const chunks: Buffer[] = []
    for (let i = 0; i < payload.length; i += chunkSize) {
      chunks.push(payload.subarray(i, i + chunkSize))
    }
    const characteristic = fakeCharacteristic(chunks)

    const result = await readFullValue(characteristic)
    expect(result.toString('utf8')).toBe(payload.toString('utf8'))
  })

  test('stops as soon as the accumulated bytes parse as complete JSON, even if more chunks were queued', async () => {
    const payload = Buffer.from(JSON.stringify({ a: 1 }))
    const characteristic = fakeCharacteristic([payload, Buffer.from('should never be read')])

    const result = await readFullValue(characteristic)
    expect(result.toString('utf8')).toBe(payload.toString('utf8'))
    expect(characteristic.readValue).toHaveBeenCalledTimes(1)
  })

  test('passes the accumulated offset to each successive read', async () => {
    const chunks = [Buffer.from('{"a":'), Buffer.from('1}')]
    const characteristic = fakeCharacteristic(chunks)

    await readFullValue(characteristic)

    expect(characteristic.readValue).toHaveBeenNthCalledWith(1, 0)
    expect(characteristic.readValue).toHaveBeenNthCalledWith(2, chunks[0].length)
  })

  test('stops on an empty chunk (end of value) even if the accumulated bytes never parse', async () => {
    const characteristic = fakeCharacteristic([Buffer.from('{"incomplete":'), Buffer.alloc(0)])

    const result = await readFullValue(characteristic)
    expect(result.toString('utf8')).toBe('{"incomplete":')
    expect(characteristic.readValue).toHaveBeenCalledTimes(2)
  })

  test('the iteration cap is generous enough for a ~630-byte transcript at the ATT default MTU (22 usable bytes/read)', async () => {
    // The exact real-world scenario that broke a cap of 20: a connection
    // that never negotiates past the ATT default MTU (23 bytes, 22
    // usable), reading a transcript this size, needs ~29 reads.
    const payload = Buffer.from(JSON.stringify({ pad: '0'.repeat(600) }))
    const chunkSize = 22
    const chunks: Buffer[] = []
    for (let i = 0; i < payload.length; i += chunkSize) {
      chunks.push(payload.subarray(i, i + chunkSize))
    }
    expect(chunks.length).toBeGreaterThan(20) // otherwise this test wouldn't have caught the old cap
    const characteristic = fakeCharacteristic(chunks)

    const result = await readFullValue(characteristic)
    expect(result.toString('utf8')).toBe(payload.toString('utf8'))
  })
})

describe('runTranscriptExchange', () => {
  /**
   * A fake `BleDevice` serving the CORE fields from the first
   * `getCharacteristic` call and the SIGNATURE fields from the second —
   * matching call order, not exact UUIDs (those constants aren't exported;
   * order is what the real function actually depends on too). Proves the
   * exact thing the live on-device run (2026-08-21) exercised for real
   * but this file had no unit test for: that the two characteristics'
   * JSON gets merged into one `LocalityTranscript`, not just that each
   * read individually completes.
   */
  function fakeDevice(coreJson: object, signatureJson: object): { device: BleDevice; writeValue: jest.Mock } {
    const writeValue = jest.fn(async () => undefined)
    let getCharacteristicCalls = 0
    const device: BleDevice = {
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      helper: { prop: jest.fn(async () => []) },
      gatt: jest.fn(async () => ({
        getPrimaryService: jest.fn(async () => ({
          getCharacteristic: jest.fn(async (): Promise<BleCharacteristic> => {
            getCharacteristicCalls += 1
            const payload = Buffer.from(JSON.stringify(getCharacteristicCalls === 1 ? coreJson : signatureJson))
            return { writeValue, readValue: jest.fn(async () => payload) }
          }),
        })),
      })),
    }
    return { device, writeValue }
  }

  test('merges the core and signature characteristics into one LocalityTranscript', async () => {
    const { device, writeValue } = fakeDevice(
      {
        method: 'ble-challenge-response/0.1',
        taskDigestMultibase: 'sha256:deadbeef',
        challenge: 'a-challenge',
        sensorNonce: 'ignored-here', // overwritten below with the real minted nonce
        sensorDid: 'did:peer:4witness',
        hardwareAttestation: 'present-unverified',
      },
      {
        devicePublicKey: 'ZmFrZS1wdWJsaWMta2V5',
        signature: 'ZmFrZS1zaWduYXR1cmU',
      }
    )

    const result = await runTranscriptExchange(device, '4b524c31-0000-1000-8000-000000000000')

    expect(result).not.toBeNull()
    expect(result?.transcript).toEqual({
      method: 'ble-challenge-response/0.1',
      taskDigestMultibase: 'sha256:deadbeef',
      challenge: 'a-challenge',
      sensorNonce: 'ignored-here',
      sensorDid: 'did:peer:4witness',
      hardwareAttestation: 'present-unverified',
      devicePublicKey: 'ZmFrZS1wdWJsaWMta2V5',
      signature: 'ZmFrZS1zaWduYXR1cmU',
    })
    // The nonce written is a fresh random value, independent of the fake
    // characteristics' canned JSON — proving the write actually happened,
    // not just that reads were parsed.
    expect(writeValue).toHaveBeenCalledTimes(1)
    expect(result?.sensorNonce).toMatch(/^[0-9a-f]{64}$/)
    expect(device.connect).toHaveBeenCalledTimes(1)
    expect(device.disconnect).toHaveBeenCalledTimes(1)
  })

  test('disconnects even if a characteristic read throws', async () => {
    const device: BleDevice = {
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      helper: { prop: jest.fn(async () => []) },
      gatt: jest.fn(async () => ({
        getPrimaryService: jest.fn(async () => ({
          getCharacteristic: jest.fn(async (): Promise<BleCharacteristic> => ({
            writeValue: jest.fn(async () => undefined),
            readValue: jest.fn(async () => {
              throw new Error('connection dropped mid-read')
            }),
          })),
        })),
      })),
    }

    await expect(runTranscriptExchange(device, '4b524c31-0000-1000-8000-000000000000')).rejects.toThrow(
      'connection dropped mid-read'
    )
    expect(device.disconnect).toHaveBeenCalledTimes(1)
  })
})

describe('BleLocalityProvider — retry on a mid-exchange GATT failure', () => {
  const address = 'AA:BB:CC:DD:EE:FF'
  const params = {
    sessionTaskDigestMultibase: 'sha256:deadbeef',
    challenge: 'a-challenge',
    sensorDid: 'did:peer:4witness',
  }
  const matchingUuid = serviceUuidFromEid(deriveEid(params.challenge, params.sessionTaskDigestMultibase)).toLowerCase()

  function fakeAdapter(getDevice: jest.Mock) {
    return {
      isDiscovering: jest.fn(async () => false),
      startDiscovery: jest.fn(async () => undefined),
      stopDiscovery: jest.fn(async () => undefined),
      devices: jest.fn(async () => [address]),
      getDevice,
    }
  }

  function brokenDevice(): BleDevice {
    return {
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      helper: { prop: jest.fn(async () => [matchingUuid]) },
      gatt: jest.fn(async () => {
        throw new Error('GATT connection dropped')
      }),
    }
  }

  function workingDevice(): BleDevice {
    return {
      connect: jest.fn(async () => undefined),
      disconnect: jest.fn(async () => undefined),
      helper: { prop: jest.fn(async () => [matchingUuid]) },
      gatt: jest.fn(async () => ({
        getPrimaryService: jest.fn(async () => ({
          getCharacteristic: jest.fn(async (): Promise<BleCharacteristic> => ({
            writeValue: jest.fn(async () => undefined),
            readValue: jest.fn(async () =>
              Buffer.from(
                JSON.stringify({
                  method: 'ble-challenge-response/0.1',
                  taskDigestMultibase: params.sessionTaskDigestMultibase,
                  challenge: params.challenge,
                  sensorNonce: 'ignored-here',
                  sensorDid: params.sensorDid,
                  hardwareAttestation: 'present-unverified',
                  devicePublicKey: 'ZmFrZS1wdWJsaWMta2V5',
                  signature: 'ZmFrZS1zaWduYXR1cmU',
                })
              )
            ),
          })),
        })),
      })),
    }
  }

  let provider: InstanceType<typeof BleLocalityProvider>

  afterEach(async () => {
    await provider?.stop()
  })

  test('evicts the stale cached device and retries within the window, succeeding on the next attempt', async () => {
    const broken = brokenDevice()
    const working = workingDevice()
    const getDevice = jest.fn(async () => (getDevice.mock.calls.length === 1 ? broken : working))
    mockCreateBluetooth.mockReturnValue({
      bluetooth: { defaultAdapter: async () => fakeAdapter(getDevice) },
      destroy: jest.fn(),
    })

    provider = new BleLocalityProvider()
    await provider.start()
    const result = await provider.observeSession({ ...params, windowSeconds: 5 })

    expect(result).not.toBeNull()
    expect(result?.transcript.signature).toBe('ZmFrZS1zaWduYXR1cmU')
    // Refetched after the first failure — proves the stale entry was evicted
    // rather than the same broken device object being reused forever.
    expect(getDevice).toHaveBeenCalledTimes(2)
    expect(broken.disconnect).toHaveBeenCalledTimes(1)
  })

  test('gives up after MAX_TRANSCRIPT_ATTEMPTS even with plenty of window left', async () => {
    const getDevice = jest.fn(async () => brokenDevice())
    mockCreateBluetooth.mockReturnValue({
      bluetooth: { defaultAdapter: async () => fakeAdapter(getDevice) },
      destroy: jest.fn(),
    })

    provider = new BleLocalityProvider()
    await provider.start()
    // A long window — if this still gives up quickly, the attempt cap (not
    // the window) is what stopped it.
    const result = await provider.observeSession({ ...params, windowSeconds: 30 })

    expect(result).toBeNull()
    expect(getDevice).toHaveBeenCalledTimes(3)
  })
})
