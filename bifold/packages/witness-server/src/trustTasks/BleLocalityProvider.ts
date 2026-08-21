/**
 * BleLocalityProvider — the sensor side of co-presence evidence, for the
 * Trust Tasks witnessed ceremony (`WitnessTaskSessions`).
 *
 * A DELIBERATELY SEPARATE port from `../LocalityProvider.ts`'s
 * `LocalityProvider`/`NullLocalityProvider` — that interface still backs
 * the legacy basic-message ceremony's own (never actually wired to real
 * hardware) locality gate, which the locality plan explicitly leaves alone
 * ("the legacy LocalityService... is standing down for v4 pairs and is not
 * worth reworking" — reworking its interface in place would have broken
 * that still-serving legacy path for no benefit). This is the REVISED
 * design (plan §5.2) the legacy interface's own doc comment already
 * anticipated as a distinct "planned implementation": the witness no
 * longer advertises a rotating challenge for a device to sign and report
 * back — a broadcast challenge is a shared secret with a multi-minute
 * life, and a device's account of what it heard on the radio is a software
 * claim, not evidence (§1). The revised direction (matching FIDO CTAP 2.2
 * hybrid): the DEVICE advertises a per-session ephemeral id, the WITNESS'S
 * SENSOR scans for it, connects, and runs the bounded GATT round trip that
 * produces the signed transcript.
 *
 * Proven with no radios in tsp-reference/ref-06p-locality-binding and over a
 * real BLE pair in ref-06p2 (discrimination + honest RTT) and ref-06p4 (the
 * relay trial) — this is the production version of exactly that sensor
 * script, over BlueZ's D-Bus interface via `node-ble`, not a raw HCI socket
 * (`@abandonware/noble`/`bleno` silently produced zero discover events
 * against a live advert while `bluetoothd` ran on the same box D-Bus
 * scanning worked on — see docs/plans/locality-plan/2026-08-20-bam.md).
 */

import { randomBytes } from 'node:crypto'
import { createBluetooth } from 'node-ble'

import { LocalityTranscript, deriveEid, serviceUuidFromEid } from './locality'

export interface LocalityObserveParams {
  /** The session document's §4.9.3 digest — the EID derivation's `info`. */
  sessionTaskDigestMultibase: string
  /** The per-party challenge issued in `witness/session#response` — the EID derivation's `ikm`. */
  challenge: string
  sensorDid: string
  /**
   * The sensor's own trust parameter (plan §5.5): measured from when this
   * sensor starts scanning for the session's expected EID to when it first
   * observes a matching advert — never from when the directive was minted,
   * and never the device's own advertise timeout (which is a UX choice,
   * not a security parameter).
   */
  windowSeconds: number
}

export interface LocalityObservationResult {
  transcript: LocalityTranscript
  rttMs: number
  rssiDbm?: number
  /**
   * The sensor's OWN minted nonce — the caller must verify
   * `transcript.sensorNonce` against THIS, not merely trust the
   * transcript's self-reported copy (which would make the check
   * self-referential and unable to ever fail).
   */
  sensorNonce: string
}

export interface TaskLocalityProvider {
  readonly name: string
  start(): Promise<void>
  stop(): Promise<void>
  /**
   * Watch for the device advertising the EID this session's challenge and
   * task digest derive, connect when found, and run the GATT round trip.
   * Resolves `null` if `windowSeconds` elapses with no matching advert
   * (§7.1's `windowLost` — the app backgrounded, locked, or the ceremony
   * moved on before the radio phase completed). Several sessions may be
   * observed concurrently; implementations must not serialize scanning.
   */
  observeSession(params: LocalityObserveParams): Promise<LocalityObservationResult | null>
}

/** No-op — locality policy `off`, or no BLE adapter available. */
export class NullTaskLocalityProvider implements TaskLocalityProvider {
  readonly name = 'null'
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async observeSession(): Promise<LocalityObservationResult | null> {
    return null
  }
}

type BleDevice = {
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  gatt: () => Promise<{ getPrimaryService: (uuid: string) => Promise<{ getCharacteristic: (uuid: string) => Promise<BleCharacteristic> }> }>
  helper: { prop: (name: string) => Promise<string[]> }
}
type BleCharacteristic = {
  writeValue: (value: Buffer, options: { type: 'request' }) => Promise<void>
  readValue: () => Promise<Buffer>
}

const GATT_CHARACTERISTIC_UUID = '4b524c32-0000-1000-8000-2a2b3c4d5e6f'

interface PendingObservation {
  serviceUuid: string
  windowDeadline: number
  resolve: (result: LocalityObservationResult | null) => void
}

/**
 * The BLE sensor, over BlueZ's D-Bus interface. One continuous scan serves
 * every concurrent `observeSession` call — the scan runs for as long as any
 * observation is pending, and a matching advert is dispatched to whichever
 * pending observation's expected EID it satisfies (plan §4.2: the observed
 * set is a live map, not one session at a time).
 */
export class BleLocalityProvider implements TaskLocalityProvider {
  readonly name = 'ble'

  private bluetooth?: ReturnType<typeof createBluetooth>['bluetooth']
  private destroyBluetooth?: () => void
  private pending = new Map<string, PendingObservation>() // serviceUuid (no dashes, lowercase) -> waiter
  private scanning = false
  private scanLoopPromise?: Promise<void>
  private seenAddresses = new Set<string>()
  private deviceByAddress = new Map<string, BleDevice>()

  async start(): Promise<void> {
    const { bluetooth, destroy } = createBluetooth()
    this.bluetooth = bluetooth
    this.destroyBluetooth = destroy
  }

  async stop(): Promise<void> {
    this.pending.forEach((waiter) => waiter.resolve(null))
    this.pending.clear()
    this.scanning = false
    await this.scanLoopPromise
    this.destroyBluetooth?.()
    this.bluetooth = undefined
  }

  async observeSession(params: LocalityObserveParams): Promise<LocalityObservationResult | null> {
    const eid = deriveEid(params.challenge, params.sessionTaskDigestMultibase)
    const serviceUuid = serviceUuidFromEid(eid).toLowerCase()

    const result = await new Promise<LocalityObservationResult | null>((resolve) => {
      this.pending.set(serviceUuid, {
        serviceUuid,
        windowDeadline: Date.now() + params.windowSeconds * 1000,
        resolve,
      })
      this.ensureScanning()
    })
    return result
  }

  /** Starts the shared scan loop if it isn't already running. */
  private ensureScanning(): void {
    if (this.scanning) return
    this.scanning = true
    this.scanLoopPromise = this.runScanLoop().finally(() => {
      this.scanning = false
    })
  }

  private async runScanLoop(): Promise<void> {
    if (!this.bluetooth) throw new Error('BleLocalityProvider.start() was not called')
    const adapter = await this.bluetooth.defaultAdapter()
    if (!(await adapter.isDiscovering())) await adapter.startDiscovery()

    try {
      while (this.pending.size > 0) {
        const now = Date.now()
        for (const [serviceUuid, waiter] of this.pending) {
          if (now > waiter.windowDeadline) {
            this.pending.delete(serviceUuid)
            waiter.resolve(null) // windowLost — the plan's §7.1 reason, not a signature failure
          }
        }
        if (this.pending.size === 0) break

        const addresses: string[] = await adapter.devices()
        for (const address of addresses) {
          let device = this.deviceByAddress.get(address)
          if (!device) {
            try {
              device = (await adapter.getDevice(address)) as unknown as BleDevice
              this.deviceByAddress.set(address, device)
            } catch {
              continue
            }
          }
          let uuids: string[] = []
          try {
            uuids = ((await device.helper.prop('UUIDs')) ?? []).map((u) => u.toLowerCase())
          } catch {
            // not yet resolved by BlueZ — try again next tick
          }
          const matched = uuids.find((u) => this.pending.has(u))
          if (!matched) continue
          const waiter = this.pending.get(matched)
          if (!waiter) continue
          this.pending.delete(matched)
          this.seenAddresses.add(address)
          const observation = await this.runTranscriptExchange(device, waiter.serviceUuid).catch(() => null)
          waiter.resolve(observation)
        }
        await new Promise((r) => setTimeout(r, 500))
      }
    } finally {
      await adapter.stopDiscovery().catch(() => {})
    }
  }

  /** Connect, discover the characteristic, mint and write the sensor nonce, and read back the signed transcript. */
  private async runTranscriptExchange(device: BleDevice, serviceUuid: string): Promise<LocalityObservationResult | null> {
    await device.connect()
    try {
      const gattServer = await device.gatt()
      const service = await gattServer.getPrimaryService(serviceUuid)
      const characteristic = await service.getCharacteristic(GATT_CHARACTERISTIC_UUID)

      // §5.3: the sensor mints the nonce, fresh, on the radio link — it
      // never travels the task channel. Writing it is what starts the
      // bounded round trip §5.5's timing bound measures; the device signs
      // the transcript over THIS nonce once it has received it.
      const sensorNonce = randomBytes(32).toString('hex')
      const t0 = Date.now()
      await characteristic.writeValue(Buffer.from(sensorNonce, 'utf8'), { type: 'request' })
      const raw = await characteristic.readValue()
      const rttMs = Date.now() - t0
      const transcript = JSON.parse(raw.toString('utf8')) as LocalityTranscript
      return { transcript, rttMs, sensorNonce }
    } finally {
      await device.disconnect().catch(() => {})
    }
  }
}
