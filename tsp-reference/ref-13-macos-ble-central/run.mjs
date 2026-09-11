/**
 * ref-13 — can a macOS host be the locality sensor's BLE central?
 *
 * The witness's shipped `BleLocalityProvider` (witness-server) talks BlueZ
 * over D-Bus via `node-ble`, which is Linux-only. That makes a Linux box a
 * hard prerequisite for any locality run today, and it also makes the iOS
 * peripheral (locality-plan §10.3 item 9, still unimplemented) untestable on
 * a Mac-only desk.
 *
 * This rung asks the narrow question first: does macOS's CoreBluetooth,
 * driven from Node through `@abandonware/noble`, speak the SAME GATT exchange
 * `runTranscriptExchange` performs? It reimplements nothing — it replays the
 * shipped sequence, byte for byte:
 *
 *   1. scan for the service UUID derived from the EID
 *   2. connect
 *   3. write a freshly minted 32-byte nonce (hex, utf8) to the CORE characteristic
 *   4. read the CORE characteristic back (chunked, offset-wise)
 *   5. read the SIGNATURE characteristic (chunked)
 *   6. JSON.parse both, merge, report the round-trip time
 *
 * Answering it is worth a rung on its own because it decides a build order:
 * if macOS can be the central, the iOS peripheral can be developed and
 * verified against a Mac with no Linux host in the loop, and this file is
 * most of a future `MacBleLocalityProvider`. If it cannot, the iOS peripheral
 * work needs a Linux box sitting beside it from day one.
 *
 * Deliberately NOT a witness: no VWC is issued, nothing is signed, no task
 * channel is involved. It only proves the radio leg.
 *
 * Usage:
 *   npm install
 *   node run.mjs --eid <24-hex-eid>          # observe a specific advertised EID
 *   node run.mjs --scan                      # list every advertising peer, no connect
 */

import { randomBytes } from 'node:crypto'

// Same constants the shipped provider uses. Duplicated deliberately: this rung
// must fail if witness-server changes them without this being revisited, and a
// cross-package import would hide that.
const EID_UUID_PREFIX = '4b524c31'
const GATT_CORE_CHARACTERISTIC_UUID = '4b524c32-0000-1000-8000-2a2b3c4d5e6f'
const GATT_SIGNATURE_CHARACTERISTIC_UUID = '4b524c33-0000-1000-8000-2a2b3c4d5e6f'

const SCAN_TIMEOUT_MS = 30_000
const READ_CHUNK_LIMIT = 64

function serviceUuidFromEid(eidHex) {
  const hex = EID_UUID_PREFIX + eidHex
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** noble wants UUIDs lowercase with no dashes. */
const flat = (uuid) => uuid.replace(/-/g, '').toLowerCase()

const args = process.argv.slice(2)
const scanOnly = args.includes('--scan')
const eidIndex = args.indexOf('--eid')
const eid = eidIndex >= 0 ? args[eidIndex + 1] : undefined

if (!scanOnly && !eid) {
  console.error('usage: node run.mjs --eid <24-hex-eid>   |   node run.mjs --scan')
  process.exit(2)
}
// The EID is HKDF L=12 bytes (locality.ts EID_BYTES) -> 24 hex chars.
// prefix(8) + eid(24) = the 32 hex a 128-bit UUID needs.
if (eid && !/^[0-9a-f]{24}$/i.test(eid)) {
  console.error(`--eid must be 24 hex characters (12 bytes, see deriveEid); got ${eid.length}: ${eid}`)
  process.exit(2)
}

let noble
try {
  noble = (await import('@abandonware/noble')).default
} catch (err) {
  console.error('Could not load @abandonware/noble — run `npm install` first.')
  console.error(`  ${err.message}`)
  process.exit(1)
}

/**
 * One ATT read at an offset, exactly as the provider's readFullValue does —
 * a long value arrives in MTU-sized chunks and the caller chains them.
 */
async function readFullValue(characteristic) {
  const chunks = []
  let offset = 0
  for (;;) {
    const chunk = await characteristic.readAsync(offset)
    if (!chunk || chunk.length === 0) break
    chunks.push(chunk)
    if (chunk.length < READ_CHUNK_LIMIT) break
    offset += chunk.length
  }
  return Buffer.concat(chunks)
}

async function runTranscriptExchange(peripheral, serviceUuid) {
  await peripheral.connectAsync()
  try {
    const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
      [flat(serviceUuid)],
      [flat(GATT_CORE_CHARACTERISTIC_UUID), flat(GATT_SIGNATURE_CHARACTERISTIC_UUID)]
    )
    const core = characteristics.find((c) => c.uuid === flat(GATT_CORE_CHARACTERISTIC_UUID))
    const sig = characteristics.find((c) => c.uuid === flat(GATT_SIGNATURE_CHARACTERISTIC_UUID))
    if (!core) throw new Error('core characteristic not found on the advertised service')
    if (!sig) throw new Error('signature characteristic not found on the advertised service')

    // §5.3: the sensor mints the nonce fresh on the radio link; it never
    // travels the task channel. Writing it starts the bounded round trip.
    const sensorNonce = randomBytes(32).toString('hex')
    const t0 = Date.now()
    await core.writeAsync(Buffer.from(sensorNonce, 'utf8'), false) // false = write-with-response
    const coreRaw = await readFullValue(core)
    const signatureRaw = await readFullValue(sig)
    const rttMs = Date.now() - t0

    return {
      transcript: { ...JSON.parse(coreRaw.toString('utf8')), ...JSON.parse(signatureRaw.toString('utf8')) },
      rttMs,
      sensorNonce,
    }
  } finally {
    await peripheral.disconnectAsync().catch(() => {})
  }
}

const wanted = eid ? flat(serviceUuidFromEid(eid)) : undefined
if (wanted) console.log(`[ref-13] looking for service ${serviceUuidFromEid(eid)}`)
else console.log('[ref-13] scan-only: listing every advertising peer')

const seen = new Set()
let settled = false

const finish = async (code, message) => {
  if (settled) return
  settled = true
  if (message) console.log(message)
  try { await noble.stopScanningAsync() } catch { /* already stopped */ }
  process.exit(code)
}

noble.on('stateChange', async (state) => {
  console.log(`[ref-13] CoreBluetooth state: ${state}`)
  if (state === 'poweredOn') {
    await noble.startScanningAsync(wanted ? [wanted] : [], false)
  } else if (state === 'unauthorized') {
    await finish(1, 'Bluetooth permission denied — grant it in System Settings › Privacy & Security › Bluetooth.')
  } else if (state === 'poweredOff') {
    await finish(1, 'Bluetooth is off.')
  }
})

noble.on('discover', async (peripheral) => {
  const id = peripheral.id
  const advertised = (peripheral.advertisement?.serviceUuids ?? []).join(',')
  if (scanOnly) {
    if (seen.has(id)) return
    seen.add(id)
    console.log(`  ${id}  rssi=${peripheral.rssi}  name=${peripheral.advertisement?.localName ?? '-'}  services=[${advertised}]`)
    return
  }
  if (settled) return
  settled = true
  await noble.stopScanningAsync()
  console.log(`[ref-13] found ${id} (rssi ${peripheral.rssi}) — running the transcript exchange`)
  try {
    const result = await runTranscriptExchange(peripheral, serviceUuidFromEid(eid))
    console.log(`[ref-13] PASS — round trip ${result.rttMs}ms`)
    console.log(`  sensorNonce   ${result.sensorNonce}`)
    console.log(`  transcript    ${JSON.stringify(result.transcript, null, 2).split('\n').join('\n                ')}`)
    process.exit(0)
  } catch (err) {
    console.error(`[ref-13] FAIL — ${err.message}`)
    process.exit(1)
  }
})

setTimeout(() => {
  finish(scanOnly ? 0 : 1, scanOnly ? `[ref-13] scan window closed — ${seen.size} peer(s) seen` : '[ref-13] FAIL — nothing advertising that EID within 30s')
}, SCAN_TIMEOUT_MS)
