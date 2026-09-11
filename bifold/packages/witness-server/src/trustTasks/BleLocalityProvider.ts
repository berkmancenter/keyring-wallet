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

export type BleDevice = {
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  gatt: () => Promise<{ getPrimaryService: (uuid: string) => Promise<{ getCharacteristic: (uuid: string) => Promise<BleCharacteristic> }> }>
  helper: { prop: (name: string) => Promise<string[]> }
}
export type BleCharacteristic = {
  writeValue: (value: Buffer, options: { type: 'request' }) => Promise<void>
  readValue: (offset?: number) => Promise<Buffer>
}

/**
 * `node-ble`'s `readValue(offset)` is ONE ATT read at that offset, up to
 * whatever the negotiated MTU allows — it does not chain BLE's own
 * long-read procedure (repeated ATT_READ_BLOB_REQ) itself; the CENTRAL has
 * to drive that by re-requesting at increasing offsets. A single un-offset
 * call (this file's original code) got back only the first chunk of the
 * transcript against a real device (2026-08-21's live verification — the
 * JSON response is a few hundred bytes of base64 keys/signature,
 * comfortably past the ATT default MTU), and the caller's own
 * `.catch(() => null)` turned the resulting JSON.parse failure into a bare
 * "windowLost" with no trace until logging was added. (A second, separate
 * bug on the device side compounded this at first — Android's
 * `BluetoothGattCharacteristic.value` silently caps at 512 bytes
 * regardless of how the read side chains — fixed in
 * `LocalityPeripheralModule.kt` to serve from its own byte array instead.)
 * Reads in a loop, appending offsets, until a chunk comes back empty/short
 * (end of value) or the accumulated bytes parse as complete JSON —
 * whichever comes first — capped so a malformed response can't loop
 * forever, with a short pause between reads: back-to-back ATT reads with
 * no pacing at all triggered a real `le-connection-abort-by-local` in
 * testing, not just a slow round trip. The iteration cap is sized for the
 * WORST case, not the common one: nothing here forces an MTU exchange, so
 * a connection that never negotiates past the ATT default (23 bytes, 22
 * usable per read) needs ~29 reads for a ~630-byte transcript — a cap of
 * 20 silently returned a truncated, unparseable buffer in testing.
 */
export async function readFullValue(characteristic: BleCharacteristic): Promise<Buffer> {
  const chunks: Buffer[] = []
  let offset = 0
  for (let i = 0; i < 80; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 30)) // see this function's own comment on why
    const chunk = await characteristic.readValue(offset)
    if (chunk.length === 0) break
    chunks.push(chunk)
    offset += chunk.length
    const soFar = Buffer.concat(chunks)
    try {
      JSON.parse(soFar.toString('utf8'))
      return soFar // a complete, parseable value — stop even if more would follow
    } catch {
      // not yet complete; read the next chunk at the new offset
    }
  }
  return Buffer.concat(chunks)
}

/**
 * Two characteristics, not one — a real, live-on-device finding
 * (2026-08-21): BLE's GATT protocol caps a SINGLE attribute value at 512
 * bytes (Bluetooth Core Spec, Vol 3, Part F, §3.2.9, "Long Attribute
 * Values"), independent of the negotiated ATT MTU (a real device
 * negotiated 517 in testing — comfortably large, and exactly why this
 * looked like an MTU/chunking bug at first, not a hard protocol ceiling).
 * The full transcript runs to ~630 bytes once it carries a real base64
 * SPKI public key and DER signature — over the ceiling regardless of how
 * patiently either side chains long reads. `GATT_CORE_CHARACTERISTIC_UUID`
 * carries everything except the two crypto-sized fields (method,
 * taskDigestMultibase, challenge, sensorNonce, sensorDid,
 * hardwareAttestation — comfortably under 512 bytes on its own);
 * `GATT_SIGNATURE_CHARACTERISTIC_UUID` carries just `devicePublicKey` and
 * `signature`, read-only, no write. Deriving `LocalityTranscript` needs
 * both.
 */
const GATT_CORE_CHARACTERISTIC_UUID = '4b524c32-0000-1000-8000-2a2b3c4d5e6f'
const GATT_SIGNATURE_CHARACTERISTIC_UUID = '4b524c33-0000-1000-8000-2a2b3c4d5e6f'

type CoreTranscriptFields = Pick<
  LocalityTranscript,
  'method' | 'taskDigestMultibase' | 'challenge' | 'sensorNonce' | 'sensorDid' | 'hardwareAttestation'
>
type SignatureTranscriptFields = Pick<LocalityTranscript, 'devicePublicKey' | 'signature'>

interface PendingObservation {
  serviceUuid: string
  windowDeadline: number
  resolve: (result: LocalityObservationResult | null) => void
  attempts: number
}

/**
 * Bounded retries within the SAME ceremony window — `windowSeconds` (plan
 * §5.5) is the security parameter and stays the outer bound; this is a
 * reliability cap on top of it, not a substitute. A single mid-exchange GATT
 * failure (a real, observed failure mode — see `runScanLoop`'s own catch-site
 * comment) no longer permanently loses the session while retries are still
 * cheap and the window has room left. Kept small: each attempt is a real
 * connect/GATT round trip against a physical radio, not a cheap retry.
 */
const MAX_TRANSCRIPT_ATTEMPTS = 3

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
        attempts: 0,
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
          try {
            const observation = await runTranscriptExchange(device, waiter.serviceUuid)
            waiter.resolve(observation)
          } catch (error) {
            // A mid-exchange GATT failure is still "no confirmed
            // observation," not a crash the caller should see — but
            // resolving null immediately silently gave up on a session
            // whose device was still advertising and its window still open,
            // making a real BLE failure indistinguishable from an honest
            // timeout with zero trace (2026-08-21's live on-device
            // verification hit this exact silence).
            console.warn(`[ble] transcript exchange with ${address} failed: ${(error as Error).message}`)
            // The cached Device object may now be stale (its BlueZ-side GATT
            // state left mid-teardown) — evict so a retry reconnects fresh
            // rather than repeating the same failure against the same
            // broken proxy every tick.
            this.deviceByAddress.delete(address)
            const attempts = waiter.attempts + 1
            if (attempts < MAX_TRANSCRIPT_ATTEMPTS && Date.now() < waiter.windowDeadline) {
              // Back into `pending` under the same key for a later tick
              // (500ms away) to retry — same bounded window, not a new one.
              this.pending.set(matched, { ...waiter, attempts })
            } else {
              waiter.resolve(null)
            }
          }
        }
        await new Promise((r) => setTimeout(r, 500))
      }
    } finally {
      await adapter.stopDiscovery().catch(() => {})
    }
  }

}

/**
 * Connect, discover both characteristics, mint and write the sensor
 * nonce, and read back the signed transcript — assembled from the two
 * characteristics' JSON, not one. See `GATT_CORE_CHARACTERISTIC_UUID`'s
 * own comment for why there are two. A standalone function, not a method —
 * it never touches `BleLocalityProvider`'s own instance state, and pulling
 * it out is what makes the two-characteristic merge (the exact thing a
 * live on-device run proved live on 2026-08-21, but this file had no unit
 * test for) directly testable against a fake `BleDevice`.
 */
export async function runTranscriptExchange(device: BleDevice, serviceUuid: string): Promise<LocalityObservationResult | null> {
  await device.connect()
  try {
    const gattServer = await device.gatt()
    const service = await gattServer.getPrimaryService(serviceUuid)
    const coreCharacteristic = await service.getCharacteristic(GATT_CORE_CHARACTERISTIC_UUID)
    const signatureCharacteristic = await service.getCharacteristic(GATT_SIGNATURE_CHARACTERISTIC_UUID)

    // §5.3: the sensor mints the nonce, fresh, on the radio link — it
    // never travels the task channel. Writing it is what starts the
    // bounded round trip §5.5's timing bound measures; the device signs
    // the transcript over THIS nonce once it has received it. Only the
    // core characteristic is written to — the signature characteristic
    // is read-only and becomes valid once the device has finished
    // signing in response to this same write.
    const sensorNonce = randomBytes(32).toString('hex')
    const t0 = Date.now()
    await coreCharacteristic.writeValue(Buffer.from(sensorNonce, 'utf8'), { type: 'request' })
    const coreRaw = await readFullValue(coreCharacteristic)
    const signatureRaw = await readFullValue(signatureCharacteristic)
    const rttMs = Date.now() - t0
    const core = JSON.parse(coreRaw.toString('utf8')) as CoreTranscriptFields
    const signature = JSON.parse(signatureRaw.toString('utf8')) as SignatureTranscriptFields
    const transcript: LocalityTranscript = { ...core, ...signature }
    return { transcript, rttMs, sensorNonce }
  } finally {
    await device.disconnect().catch(() => {})
  }
}
