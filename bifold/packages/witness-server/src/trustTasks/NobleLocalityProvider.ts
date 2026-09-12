/**
 * NobleLocalityProvider — the same BLE sensor as `BleLocalityProvider`, on a
 * different radio stack: CoreBluetooth (and, in principle, any host
 * `@abandonware/noble` supports) instead of BlueZ over D-Bus.
 *
 * WHY A SECOND PROVIDER. `BleLocalityProvider` talks to `bluetoothd` via
 * `node-ble`, which is Linux-only by construction. That made a Linux box a
 * hard prerequisite for any locality run, and it meant the iOS peripheral
 * (landed 2026-09-12, keyring-bifold #47) could not be exercised from the
 * Mac it is built on. tsp-reference/ref-14-macos-ble-central proved the
 * narrow question first — a Mac driven through noble performs the exact GATT
 * exchange `runTranscriptExchange` needs — and this file is that probe grown
 * into the provider it anticipated.
 *
 * WHAT IS SHARED, WHAT IS NOT. The GATT exchange itself — connect, write the
 * sensor nonce, chain-read two characteristics, merge the JSON — is
 * `runTranscriptExchange`, imported unchanged: a noble peripheral is adapted
 * to the `BleDevice` shape that function already takes (`adaptPeripheral`
 * below), so the wire protocol has exactly one implementation on the witness.
 * What differs is discovery. BlueZ is polled (`adapter.devices()` every
 * tick); noble is event-driven (`discover`). So the scan loop is rewritten
 * rather than ported, and the retry/window semantics — bounded attempts
 * inside the sensor's own window, `windowLost` on expiry, one shared scan
 * serving every concurrent session — are re-stated here, not inherited.
 *
 * THE ONE THING THIS RELIES ON THAT THE BLUEZ PROVIDER DOES NOT. noble's
 * `readAsync()` takes no offset: a single call returns the whole attribute
 * value on macOS because CoreBluetooth chains the long-read procedure
 * (ATT_READ_BLOB_REQ) itself. `adaptPeripheral` therefore answers the first
 * `readValue(0)` with that full value and every `readValue(offset > 0)` with
 * an empty buffer, which `readFullValue` treats as end-of-value. On a Linux
 * HCI socket noble does NOT chain, and a transcript longer than one MTU would
 * come back truncated — which is why this provider is selected for `darwin`
 * and BlueZ stays the Linux default (see `WitnessService`). Not a limitation
 * to fix here; a reason the two providers coexist.
 *
 * NOT YET PROVEN LIVE. Every test beside this file drives a fake noble. The
 * provider has been started against the real CoreBluetooth stack on a Mac
 * (state → poweredOn, scanning starts, window elapses cleanly with nothing
 * advertising) but has not yet completed an exchange against a real phone —
 * a Mac cannot see its own advertisements, so that needs the Android
 * peripheral (verified against BlueZ 2026-08-21) or the iOS one in the room.
 */

import { EventEmitter } from 'node:events'

import {
  BleDevice,
  GATT_CORE_CHARACTERISTIC_UUID,
  GATT_SIGNATURE_CHARACTERISTIC_UUID,
  LocalityObservationResult,
  LocalityObserveParams,
  TaskLocalityProvider,
  runTranscriptExchange,
} from './BleLocalityProvider'
import { deriveEid, serviceUuidFromEid } from './locality'

// ------------------------------------------------------------ noble's surface

/**
 * The slice of `@abandonware/noble` this file touches, stated here rather
 * than pulled from `@types` (there are none published for the fork) so the
 * tests can stand up a fake against the same contract the code compiles
 * against.
 */
export interface NobleCharacteristic {
  /** Lowercase, no dashes — noble's own convention. */
  uuid: string
  writeAsync(data: Buffer, withoutResponse: boolean): Promise<void>
  readAsync(): Promise<Buffer>
}

export interface NoblePeripheral {
  id: string
  rssi: number
  advertisement?: { serviceUuids?: string[]; localName?: string }
  connectAsync(): Promise<void>
  disconnectAsync(): Promise<void>
  discoverSomeServicesAndCharacteristicsAsync(
    serviceUuids: string[],
    characteristicUuids: string[]
  ): Promise<{ characteristics: NobleCharacteristic[] }>
}

export type NobleState = 'unknown' | 'resetting' | 'unsupported' | 'unauthorized' | 'poweredOff' | 'poweredOn'

export interface NobleLike extends Pick<EventEmitter, 'on' | 'off' | 'once' | 'removeListener'> {
  state: NobleState
  startScanningAsync(serviceUuids: string[], allowDuplicates: boolean): Promise<void>
  stopScanningAsync(): Promise<void>
}

/** noble wants UUIDs lowercase with no dashes; ours carry dashes. */
export const flatUuid = (uuid: string): string => uuid.replace(/-/g, '').toLowerCase()

// ------------------------------------------------------------ the adapter

/**
 * A noble peripheral seen through `BleDevice`'s eyes, so
 * `runTranscriptExchange` runs unchanged. Characteristics are discovered
 * once, on the first `getCharacteristic`, for both UUIDs at once — noble
 * discovers per connection, and asking twice is a second round trip for
 * nothing.
 */
export function adaptPeripheral(peripheral: NoblePeripheral, serviceUuid: string): BleDevice {
  let characteristics: NobleCharacteristic[] | undefined

  const characteristicFor = async (uuid: string): Promise<NobleCharacteristic> => {
    if (!characteristics) {
      const discovered = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
        [flatUuid(serviceUuid)],
        [flatUuid(GATT_CORE_CHARACTERISTIC_UUID), flatUuid(GATT_SIGNATURE_CHARACTERISTIC_UUID)]
      )
      characteristics = discovered.characteristics
    }
    const found = characteristics.find((c) => c.uuid === flatUuid(uuid))
    if (!found) throw new Error(`characteristic ${uuid} not found on the advertised service`)
    return found
  }

  return {
    connect: () => peripheral.connectAsync(),
    disconnect: () => peripheral.disconnectAsync(),
    helper: { prop: async () => (peripheral.advertisement?.serviceUuids ?? []).map(flatUuid) },
    gatt: async () => ({
      getPrimaryService: async () => ({
        getCharacteristic: async (uuid: string) => {
          const characteristic = await characteristicFor(uuid)
          return {
            // `false` = write-with-response, the same `{ type: 'request' }`
            // the BlueZ path uses; the device signs on receipt, so the
            // response is what tells us it has the nonce.
            writeValue: async (value: Buffer) => characteristic.writeAsync(value, false),
            // See the file header: one read is the whole value on
            // CoreBluetooth; any continuation read is end-of-value.
            readValue: async (offset?: number) => ((offset ?? 0) > 0 ? Buffer.alloc(0) : characteristic.readAsync()),
          }
        },
      }),
    }),
  }
}

// ------------------------------------------------------------ the provider

interface PendingObservation {
  flatServiceUuid: string
  windowDeadline: number
  timer: ReturnType<typeof setTimeout>
  settle: (result: LocalityObservationResult | null) => void
}

/** Same reliability cap as the BlueZ provider, for the same reason: each attempt is a real radio round trip. */
const MAX_TRANSCRIPT_ATTEMPTS = 3
const RETRY_PAUSE_MS = 500
/** How long `start()` waits for the adapter to report `poweredOn` before giving up. */
const POWER_ON_TIMEOUT_MS = 10_000

async function defaultLoadNoble(): Promise<NobleLike> {
  // Optional dependency, loaded lazily: a Linux witness never needs it, and
  // an install where its native build failed must still start.
  const mod = (await import('@abandonware/noble')) as unknown as { default?: NobleLike } & NobleLike
  return mod.default ?? mod
}

export class NobleLocalityProvider implements TaskLocalityProvider {
  readonly name = 'noble'

  private noble?: NobleLike
  private pending = new Map<string, PendingObservation>() // flat service uuid -> waiter
  private scanning = false
  private inFlight = new Set<string>() // flat service uuids mid-exchange
  private readonly onDiscover = (peripheral: NoblePeripheral) => void this.handleDiscover(peripheral)

  constructor(private readonly loadNoble: () => Promise<NobleLike> = defaultLoadNoble) {}

  async start(): Promise<void> {
    const noble = await this.loadNoble()
    await waitForPoweredOn(noble)
    this.noble = noble
  }

  async stop(): Promise<void> {
    for (const waiter of this.pending.values()) waiter.settle(null)
    this.pending.clear()
    await this.stopScanning()
    this.noble = undefined
  }

  async observeSession(params: LocalityObserveParams): Promise<LocalityObservationResult | null> {
    if (!this.noble) throw new Error('NobleLocalityProvider.start() was not called')
    const eid = deriveEid(params.challenge, params.sessionTaskDigestMultibase)
    const flatServiceUuid = flatUuid(serviceUuidFromEid(eid))

    return new Promise<LocalityObservationResult | null>((resolve) => {
      let settled = false
      const settle = (result: LocalityObservationResult | null) => {
        if (settled) return
        settled = true
        clearTimeout(waiter.timer)
        this.pending.delete(flatServiceUuid)
        this.inFlight.delete(flatServiceUuid)
        resolve(result)
        if (this.pending.size === 0 && this.inFlight.size === 0) void this.stopScanning()
      }
      const waiter: PendingObservation = {
        flatServiceUuid,
        windowDeadline: Date.now() + params.windowSeconds * 1000,
        // windowLost — §7.1's reason, not a signature failure. An exchange
        // already in flight when this fires is left to finish: the window
        // bounds when the advert must be SEEN (plan §5.5), and the RTT bound
        // is the exchange's own separate limit.
        timer: setTimeout(() => {
          if (!this.inFlight.has(flatServiceUuid)) settle(null)
        }, params.windowSeconds * 1000),
        settle,
      }
      this.pending.set(flatServiceUuid, waiter)
      void this.ensureScanning()
    })
  }

  private async ensureScanning(): Promise<void> {
    if (this.scanning || !this.noble) return
    this.scanning = true
    this.noble.on('discover', this.onDiscover)
    // Scan for everything and match ourselves: the set of expected UUIDs
    // changes as sessions come and go, and restarting the scan with a new
    // filter each time is a real interruption on CoreBluetooth. Duplicates
    // are not requested — a peripheral is reported once per scan, and a
    // retry reuses the peripheral object rather than waiting to see it again.
    try {
      await this.noble.startScanningAsync([], false)
    } catch (error) {
      this.scanning = false
      this.noble.removeListener('discover', this.onDiscover)
      console.warn(`[noble] could not start scanning: ${(error as Error).message}`)
      for (const waiter of this.pending.values()) waiter.settle(null)
    }
  }

  private async stopScanning(): Promise<void> {
    if (!this.scanning || !this.noble) return
    this.scanning = false
    this.noble.removeListener('discover', this.onDiscover)
    await this.noble.stopScanningAsync().catch(() => {})
  }

  private async handleDiscover(peripheral: NoblePeripheral): Promise<void> {
    const advertised = (peripheral.advertisement?.serviceUuids ?? []).map(flatUuid)
    const matched = advertised.find((u) => this.pending.has(u) && !this.inFlight.has(u))
    if (!matched) return
    const waiter = this.pending.get(matched)
    if (!waiter) return
    this.inFlight.add(matched)
    const serviceUuid = serviceUuidFromEid(matched.slice(8)) // strip the KRL1 prefix back off

    for (let attempt = 1; attempt <= MAX_TRANSCRIPT_ATTEMPTS; attempt++) {
      if (!this.pending.has(matched)) return // stop() or the window settled it meanwhile
      try {
        const observation = await runTranscriptExchange(adaptPeripheral(peripheral, serviceUuid), serviceUuid)
        // The exchange's own contract admits null; treat it as a failed
        // attempt rather than a confirmed "nothing", so it gets the same retry.
        if (!observation) throw new Error('transcript exchange returned no observation')
        waiter.settle({ ...observation, rssiDbm: peripheral.rssi })
        return
      } catch (error) {
        // Same stance as the BlueZ provider: a mid-exchange GATT failure is
        // "no confirmed observation", logged rather than swallowed, and
        // retried while the window has room — not a crash, not silence.
        console.warn(
          `[noble] transcript exchange with ${peripheral.id} failed (attempt ${attempt}/${MAX_TRANSCRIPT_ATTEMPTS}): ${(error as Error).message}`
        )
        if (attempt < MAX_TRANSCRIPT_ATTEMPTS && Date.now() < waiter.windowDeadline) {
          await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS))
          continue
        }
        waiter.settle(null)
        return
      }
    }
  }
}

/**
 * CoreBluetooth reports its state asynchronously and `unauthorized` is a
 * real, common answer on a Mac that has never granted the terminal Bluetooth
 * access — surfaced as a thrown error with the fix in the message, so the
 * witness's "continuing without locality" warning says something useful.
 */
export async function waitForPoweredOn(noble: NobleLike, timeoutMs = POWER_ON_TIMEOUT_MS): Promise<void> {
  const explain = (state: NobleState): string | undefined => {
    if (state === 'unauthorized')
      return 'Bluetooth permission denied — grant it in System Settings › Privacy & Security › Bluetooth'
    if (state === 'poweredOff') return 'Bluetooth is off'
    if (state === 'unsupported') return 'no Bluetooth adapter'
    return undefined
  }
  if (noble.state === 'poweredOn') return
  const immediate = explain(noble.state)
  if (immediate) throw new Error(immediate)

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      noble.removeListener('stateChange', onState)
      reject(new Error(`Bluetooth adapter did not power on within ${timeoutMs}ms (state: ${noble.state})`))
    }, timeoutMs)
    const onState = (state: NobleState) => {
      if (state === 'poweredOn') {
        clearTimeout(timer)
        noble.removeListener('stateChange', onState)
        resolve()
        return
      }
      const reason = explain(state)
      if (reason) {
        clearTimeout(timer)
        noble.removeListener('stateChange', onState)
        reject(new Error(reason))
      }
    }
    noble.on('stateChange', onState)
  })
}
