/**
 * NobleLocalityProvider tests — the CoreBluetooth-backed sensor, driven by a
 * fake noble. Mirrors `BleLocalityProvider.test.ts`'s scan-loop coverage for
 * the event-driven discovery this provider does instead of BlueZ's polling:
 * windowLost, match-and-exchange, ignore-non-matching, bounded retry within
 * the window, stop() mid-scan, one scan serving two concurrent sessions.
 * Plus the two things the adapter alone is responsible for — UUID
 * normalisation and the "one read is the whole value" offset contract the
 * file header explains.
 *
 * Nothing here touches a radio. The one thing these cannot prove is the
 * CoreBluetooth long-read behaviour the offset contract relies on; that is a
 * device-run question, recorded in the provider's header.
 */
import { EventEmitter } from 'node:events'

import {
  GATT_CORE_CHARACTERISTIC_UUID,
  GATT_SIGNATURE_CHARACTERISTIC_UUID,
} from '../../src/trustTasks/BleLocalityProvider'
import {
  NobleLocalityProvider,
  adaptPeripheral,
  flatUuid,
  waitForPoweredOn,
  type NobleCharacteristic,
  type NobleLike,
  type NoblePeripheral,
  type NobleState,
} from '../../src/trustTasks/NobleLocalityProvider'
import { deriveEid, serviceUuidFromEid } from '../../src/trustTasks/locality'

// ------------------------------------------------------------------ fakes

class FakeNoble extends EventEmitter implements NobleLike {
  state: NobleState
  startScanningAsync = jest.fn(async (_uuids: string[], _dupes: boolean) => undefined)
  stopScanningAsync = jest.fn(async () => undefined)
  constructor(state: NobleState = 'poweredOn') {
    super()
    this.state = state
  }
}

const params = {
  sessionTaskDigestMultibase: 'sha256:deadbeef',
  challenge: 'a-challenge',
  sensorDid: 'did:peer:4witness',
}
const matchingService = serviceUuidFromEid(deriveEid(params.challenge, params.sessionTaskDigestMultibase))

function transcriptFor(challenge: string, taskDigestMultibase: string) {
  return {
    method: 'ble-challenge-response/0.1',
    taskDigestMultibase,
    challenge,
    sensorNonce: 'ignored-here',
    sensorDid: params.sensorDid,
    hardwareAttestation: 'present-unverified',
    devicePublicKey: 'ZmFrZS1wdWJsaWMta2V5',
    signature: 'ZmFrZS1zaWduYXR1cmU',
  }
}

function fakeCharacteristic(
  uuid: string,
  value: object
): NobleCharacteristic & { writeAsync: jest.Mock; readAsync: jest.Mock } {
  return {
    uuid: flatUuid(uuid),
    writeAsync: jest.fn(async () => undefined),
    readAsync: jest.fn(async () => Buffer.from(JSON.stringify(value), 'utf8')),
  }
}

/** A peripheral advertising `serviceUuid` that serves a full transcript, split across the two characteristics. */
function workingPeripheral(
  serviceUuid: string,
  challenge: string,
  taskDigestMultibase: string,
  overrides: Partial<NoblePeripheral> & { id?: string } = {}
) {
  const { devicePublicKey, signature, ...core } = transcriptFor(challenge, taskDigestMultibase)
  const coreChar = fakeCharacteristic(GATT_CORE_CHARACTERISTIC_UUID, core)
  const sigChar = fakeCharacteristic(GATT_SIGNATURE_CHARACTERISTIC_UUID, { devicePublicKey, signature })
  const peripheral = {
    id: overrides.id ?? 'periph-1',
    rssi: -51,
    advertisement: { serviceUuids: [flatUuid(serviceUuid)] },
    connectAsync: jest.fn(async () => undefined),
    disconnectAsync: jest.fn(async () => undefined),
    discoverSomeServicesAndCharacteristicsAsync: jest.fn(async () => ({ characteristics: [coreChar, sigChar] })),
    ...overrides,
  }
  return { peripheral: peripheral as NoblePeripheral & typeof peripheral, coreChar, sigChar }
}

async function startedProvider(noble: FakeNoble = new FakeNoble()) {
  const provider = new NobleLocalityProvider(async () => noble)
  await provider.start()
  return { provider, noble }
}

/** Let the event loop turn so `ensureScanning`'s awaited `startScanningAsync` has registered the listener. */
const tick = () => new Promise((r) => setImmediate(r))

// ------------------------------------------------------------- start / state

describe('waitForPoweredOn', () => {
  test('returns at once when already poweredOn', async () => {
    await expect(waitForPoweredOn(new FakeNoble('poweredOn'))).resolves.toBeUndefined()
  })

  test('resolves once stateChange reports poweredOn', async () => {
    const noble = new FakeNoble('unknown')
    const p = waitForPoweredOn(noble, 1000)
    noble.emit('stateChange', 'poweredOn')
    await expect(p).resolves.toBeUndefined()
  })

  test('unauthorized is a thrown error that says how to fix it — the common first-run failure on a Mac', async () => {
    await expect(waitForPoweredOn(new FakeNoble('unauthorized'))).rejects.toThrow(/Privacy & Security/)
    const noble = new FakeNoble('unknown')
    const p = waitForPoweredOn(noble, 1000)
    noble.emit('stateChange', 'unauthorized')
    await expect(p).rejects.toThrow(/permission denied/)
  })

  test('poweredOff and unsupported are distinguishable errors', async () => {
    await expect(waitForPoweredOn(new FakeNoble('poweredOff'))).rejects.toThrow(/Bluetooth is off/)
    await expect(waitForPoweredOn(new FakeNoble('unsupported'))).rejects.toThrow(/no Bluetooth adapter/)
  })

  test('times out rather than hanging if the adapter never reports', async () => {
    await expect(waitForPoweredOn(new FakeNoble('unknown'), 20)).rejects.toThrow(/did not power on within 20ms/)
  })
})

// ------------------------------------------------------------------ adapter

describe('adaptPeripheral', () => {
  test('a dashed, upper-case service UUID and dashed characteristic UUIDs are normalised to noble form', async () => {
    const { peripheral } = workingPeripheral(matchingService, params.challenge, params.sessionTaskDigestMultibase)
    const device = adaptPeripheral(peripheral, matchingService.toUpperCase())
    const gatt = await device.gatt()
    const service = await gatt.getPrimaryService(matchingService)
    await service.getCharacteristic(GATT_CORE_CHARACTERISTIC_UUID)
    expect(peripheral.discoverSomeServicesAndCharacteristicsAsync).toHaveBeenCalledWith(
      [flatUuid(matchingService)],
      [flatUuid(GATT_CORE_CHARACTERISTIC_UUID), flatUuid(GATT_SIGNATURE_CHARACTERISTIC_UUID)]
    )
  })

  test('characteristics are discovered once, for both UUIDs, not once per getCharacteristic', async () => {
    const { peripheral } = workingPeripheral(matchingService, params.challenge, params.sessionTaskDigestMultibase)
    const service = await (await adaptPeripheral(peripheral, matchingService).gatt()).getPrimaryService(matchingService)
    await service.getCharacteristic(GATT_CORE_CHARACTERISTIC_UUID)
    await service.getCharacteristic(GATT_SIGNATURE_CHARACTERISTIC_UUID)
    expect(peripheral.discoverSomeServicesAndCharacteristicsAsync).toHaveBeenCalledTimes(1)
  })

  test('the offset contract: readValue(0) is the whole value, readValue(n>0) is end-of-value', async () => {
    const { peripheral, coreChar } = workingPeripheral(
      matchingService,
      params.challenge,
      params.sessionTaskDigestMultibase
    )
    const service = await (await adaptPeripheral(peripheral, matchingService).gatt()).getPrimaryService(matchingService)
    const core = await service.getCharacteristic(GATT_CORE_CHARACTERISTIC_UUID)
    expect((await core.readValue(0)).length).toBeGreaterThan(0)
    expect(await core.readValue(22)).toHaveLength(0)
    expect(coreChar.readAsync).toHaveBeenCalledTimes(1)
  })

  test('writes are with-response, matching the BlueZ path', async () => {
    const { peripheral, coreChar } = workingPeripheral(
      matchingService,
      params.challenge,
      params.sessionTaskDigestMultibase
    )
    const service = await (await adaptPeripheral(peripheral, matchingService).gatt()).getPrimaryService(matchingService)
    const core = await service.getCharacteristic(GATT_CORE_CHARACTERISTIC_UUID)
    await core.writeValue(Buffer.from('nonce'), { type: 'request' })
    expect(coreChar.writeAsync).toHaveBeenCalledWith(Buffer.from('nonce'), false)
  })

  test('a missing characteristic is a clear error, not an undefined dereference later', async () => {
    const { peripheral } = workingPeripheral(matchingService, params.challenge, params.sessionTaskDigestMultibase, {
      discoverSomeServicesAndCharacteristicsAsync: jest.fn(async () => ({ characteristics: [] })),
    })
    const service = await (await adaptPeripheral(peripheral, matchingService).gatt()).getPrimaryService(matchingService)
    await expect(service.getCharacteristic(GATT_CORE_CHARACTERISTIC_UUID)).rejects.toThrow(/not found/)
  })
})

// ------------------------------------------------------------- the provider

describe('NobleLocalityProvider', () => {
  test('observeSession before start() is a programming error, not a silent null', async () => {
    const provider = new NobleLocalityProvider(async () => new FakeNoble())
    await expect(provider.observeSession({ ...params, windowSeconds: 1 })).rejects.toThrow(/start\(\) was not called/)
  })

  test('resolves null when the window elapses with nothing advertising (windowLost), and stops scanning when idle', async () => {
    const { provider, noble } = await startedProvider()
    const result = await provider.observeSession({ ...params, windowSeconds: 0.05 })
    expect(result).toBeNull()
    expect(noble.startScanningAsync).toHaveBeenCalledWith([], false)
    await tick()
    expect(noble.stopScanningAsync).toHaveBeenCalled()
    expect(noble.listenerCount('discover')).toBe(0)
  })

  test('a matching advert runs the exchange and returns the merged transcript with the minted nonce and RSSI', async () => {
    const { provider, noble } = await startedProvider()
    const { peripheral, coreChar } = workingPeripheral(
      matchingService,
      params.challenge,
      params.sessionTaskDigestMultibase
    )
    const pending = provider.observeSession({ ...params, windowSeconds: 5 })
    await tick()
    noble.emit('discover', peripheral)
    const result = await pending
    expect(result).not.toBeNull()
    expect(result!.transcript).toMatchObject({
      challenge: params.challenge,
      devicePublicKey: 'ZmFrZS1wdWJsaWMta2V5',
      signature: 'ZmFrZS1zaWduYXR1cmU',
    })
    expect(result!.rssiDbm).toBe(-51)
    // The nonce written to the device is the one reported back — 32 bytes hex, as UTF-8 text.
    const written = (coreChar.writeAsync.mock.calls[0] as [Buffer, boolean])[0].toString('utf8')
    expect(written).toMatch(/^[0-9a-f]{64}$/)
    expect(result!.sensorNonce).toBe(written)
    expect(peripheral.disconnectAsync).toHaveBeenCalled()
  })

  test('advertised UUIDs arrive from noble lowercase and dashless; a session keyed from the dashed form still matches', async () => {
    const { provider, noble } = await startedProvider()
    const { peripheral } = workingPeripheral(matchingService, params.challenge, params.sessionTaskDigestMultibase)
    expect(peripheral.advertisement!.serviceUuids![0]).not.toContain('-')
    const pending = provider.observeSession({ ...params, windowSeconds: 5 })
    await tick()
    noble.emit('discover', peripheral)
    await expect(pending).resolves.not.toBeNull()
  })

  test('a non-matching peripheral is never connected to', async () => {
    const { provider, noble } = await startedProvider()
    const stranger = workingPeripheral(serviceUuidFromEid('ff'.repeat(12)), 'other', 'other', { id: 'stranger' })
    const pending = provider.observeSession({ ...params, windowSeconds: 0.05 })
    await tick()
    noble.emit('discover', stranger.peripheral)
    expect(await pending).toBeNull()
    expect(stranger.peripheral.connectAsync).not.toHaveBeenCalled()
  })

  test('a mid-exchange failure is retried on the same peripheral within the window and succeeds', async () => {
    const { provider, noble } = await startedProvider()
    const { peripheral } = workingPeripheral(matchingService, params.challenge, params.sessionTaskDigestMultibase)
    peripheral.connectAsync
      .mockImplementationOnce(async () => {
        throw new Error('GATT connection dropped')
      })
      .mockImplementation(async () => undefined)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const pending = provider.observeSession({ ...params, windowSeconds: 5 })
    await tick()
    noble.emit('discover', peripheral)
    const result = await pending
    expect(result).not.toBeNull()
    expect(peripheral.connectAsync).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('attempt 1/3'))
    warn.mockRestore()
  })

  test('gives up after MAX_TRANSCRIPT_ATTEMPTS with plenty of window left', async () => {
    const { provider, noble } = await startedProvider()
    const { peripheral } = workingPeripheral(matchingService, params.challenge, params.sessionTaskDigestMultibase, {
      connectAsync: jest.fn(async () => {
        throw new Error('always fails')
      }),
    })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const pending = provider.observeSession({ ...params, windowSeconds: 30 })
    await tick()
    noble.emit('discover', peripheral)
    expect(await pending).toBeNull()
    expect(peripheral.connectAsync).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })

  test('stop() resolves a pending observation with null and tears the scan down', async () => {
    const { provider, noble } = await startedProvider()
    const pending = provider.observeSession({ ...params, windowSeconds: 30 })
    await tick()
    await provider.stop()
    expect(await pending).toBeNull()
    expect(noble.stopScanningAsync).toHaveBeenCalled()
    expect(noble.listenerCount('discover')).toBe(0)
  })

  test('one shared scan serves two concurrent sessions, each matched to its own peripheral', async () => {
    const { provider, noble } = await startedProvider()
    const otherParams = { ...params, challenge: 'another-challenge' }
    const otherService = serviceUuidFromEid(deriveEid(otherParams.challenge, otherParams.sessionTaskDigestMultibase))
    const a = workingPeripheral(matchingService, params.challenge, params.sessionTaskDigestMultibase, { id: 'A' })
    const b = workingPeripheral(otherService, otherParams.challenge, otherParams.sessionTaskDigestMultibase, {
      id: 'B',
    })

    const pendingA = provider.observeSession({ ...params, windowSeconds: 5 })
    const pendingB = provider.observeSession({ ...otherParams, windowSeconds: 5 })
    await tick()
    expect(noble.startScanningAsync).toHaveBeenCalledTimes(1)
    noble.emit('discover', b.peripheral)
    noble.emit('discover', a.peripheral)
    const [resultA, resultB] = await Promise.all([pendingA, pendingB])
    expect(resultA!.transcript.challenge).toBe(params.challenge)
    expect(resultB!.transcript.challenge).toBe(otherParams.challenge)
  })

  test('if scanning cannot start, every pending session settles null rather than hanging', async () => {
    const noble = new FakeNoble()
    noble.startScanningAsync.mockImplementation(async () => {
      throw new Error('scan refused')
    })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { provider } = await startedProvider(noble)
    expect(await provider.observeSession({ ...params, windowSeconds: 30 })).toBeNull()
    warn.mockRestore()
  })
})
