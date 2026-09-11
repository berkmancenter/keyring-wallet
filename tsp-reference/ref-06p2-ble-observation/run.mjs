// ref-06p2 — the locality binding (ref-06p) run over a real BLE radio pair.
//
// ref-06p proved the binding algebra with no radios: the EID that LOCATES, the
// signed GATT transcript that BINDS, four forgeries rejected. This rung is the
// half that needed hardware: does the same EID/service-UUID scheme actually
// discriminate a real advert out of real ambient noise, and what does a real
// GATT round trip cost in time, on the radios we actually have?
//
// Design under test: docs/plans/locality-plan.md §5.3, §5.5.
//
// This box plays the SENSOR (central) — scanning + GATT client, via BlueZ's
// D-Bus API — which is also its PRODUCTION role (plan §5.6: the witness
// server is its own sensor). The DEVICE (peripheral) role is played by a
// phone running a GATT-server test app (nRF Connect for Mobile), because a
// phone with a real radio the wallet doesn't control the internals of is a
// closer analog to production than two processes on one box, and because
// this box only has one BLE adapter — a second real radio is the whole point
// of this rung.
//
// D-Bus, not a raw HCI socket: an earlier version of this rung used
// @abandonware/noble directly against hci0. On this box that produced zero
// discover events — not a permissions problem (confirmed as root), and not a
// dead radio (bluetoothd's own discovery, and noble's own bundled example,
// showed the same silence) — while `bluetoothctl scan on` saw the whole
// room. Two processes independently opening the same raw HCI channel and
// racing bluetoothd for LE scan state is exactly the failure mode noble's own
// README warns about ("you will not get any errors... but nothing will
// happen"). Going through BlueZ's D-Bus interface, the same path bluetoothctl
// uses, sidesteps the contention rather than requiring bluetoothd to be
// stopped — which also matters for production: a witness box's Bluetooth
// stack shouldn't have to be disabled for anything else it does.
//
// Run: node run.mjs --setup    → prints the exact peripheral config to enter
//      node run.mjs            → scans, connects, measures the round trip
//      node run.mjs --quiet    → same, less prose
//      node run.mjs --trials 50 --target B
//
// One-time setup this needs beyond `npm install` — a D-Bus policy allowing
// this user to talk to org.bluez (see README):
//
//   echo '<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN"
//     "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
//   <busconfig>
//     <policy user="'"$(id -un)"'">
//      <allow own="org.bluez"/>
//       <allow send_destination="org.bluez"/>
//       <allow send_interface="org.bluez.GattCharacteristic1"/>
//       <allow send_interface="org.bluez.GattDescriptor1"/>
//       <allow send_interface="org.freedesktop.DBus.ObjectManager"/>
//       <allow send_interface="org.freedesktop.DBus.Properties"/>
//     </policy>
//   </busconfig>' | sudo tee /etc/dbus-1/system.d/node-ble.conf > /dev/null
//   sudo systemctl reload dbus

import { createHash, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createBluetooth } from "node-ble";

const { bluetooth, destroy } = createBluetooth();

const QUIET = process.argv.includes("--quiet");
const SETUP = process.argv.includes("--setup");
const argAfter = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const TRIALS = parseInt(argAfter("--trials", "30"), 10);
const TARGET = argAfter("--target", "A");
const SCAN_TIMEOUT_MS = parseInt(argAfter("--scan-timeout", "30000"), 10);
const log = (...a) => QUIET || console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- primitives
// Duplicated from ref-06p, not imported — rungs are self-contained (house
// convention). This rung needs no @openvtc/trust-tasks pipeline, only the EID
// derivation, so the dependency footprint stays "two BLE radios" and nothing
// else, matching tsp-reference/README.md's table.

function jcs(v) {
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
function taskDigestHex(doc) {
  // Stands in for SPEC.md §4.9.3's multibase digest — this rung only needs a
  // stable, derivation-grade info value, not a document a verifier checks.
  return createHash("sha256").update(Buffer.from(jcs(doc), "utf8")).digest("hex");
}

const EID_SALT = "keyring-locality-eid-v1";
const EID_BYTES = 12;
const UUID_PREFIX = "4b524c31"; // "KRL1" — plan §5.3, ref-06p act 1
function deriveEid(challenge, sessionTaskDigestHex) {
  return Buffer.from(hkdfSync("sha256",
    Buffer.from(challenge, "utf8"),
    Buffer.from(EID_SALT, "utf8"),
    Buffer.from(sessionTaskDigestHex, "utf8"),
    EID_BYTES)).toString("hex");
}
function serviceUuid(eidHex) {
  const h = UUID_PREFIX + eidHex;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const noDash = (uuid) => uuid.replace(/-/g, "").toLowerCase();

// The round-trip characteristic. Fixed, not session-derived — only the
// SERVICE UUID locates a session (plan §5.3: "a value everyone can see cannot
// be the proof"); the characteristic itself carries no session identity.
const CHAR_UUID = "4b524c32-0000-1000-8000-2a2b3c4d5e6f"; // "KRL2"

// -------------------------------------------------------- three open sessions
// The discrimination test (Done-when: "the sensor matches the correct session
// out of ≥3 open sessions"). Only TARGET is actually advertised by the phone
// in this setup — the other two exercise the matching logic against real
// ambient BLE noise, not against genuinely competing adverts. Said plainly in
// the README rather than overclaimed.

const SESSIONS = {
  A: { challenge: "9f2c1d7e4a8b0c5f3e6d1a2b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", threadId: "ref-06p2-session-a" },
  B: { challenge: "0e1d2c3b4a5968776859403f2e1d0c9b8a7968554433221100ffeeddccbbaa9", threadId: "ref-06p2-session-b" },
  C: { challenge: "77665544332211ffeeddccbbaa998877665544332211ffeeddccbbaa998877", threadId: "ref-06p2-session-c" },
};
for (const [key, s] of Object.entries(SESSIONS)) {
  s.taskDigestHex = taskDigestHex({ threadId: s.threadId, parties: ["did:peer:4alice", "did:peer:4bob"] });
  s.eid = deriveEid(s.challenge, s.taskDigestHex);
  s.serviceUuid = serviceUuid(s.eid);
}

// -------------------------------------------------------------------- --setup

if (SETUP) {
  console.log(`
ref-06p2 — phone-side setup (nRF Connect for Mobile)

Advertise SESSION ${TARGET}'s service UUID. Three candidate sessions exist so
the sensor script has to discriminate (Done-when in locality-plan.md §10.1);
only the one you configure below is actually broadcast.

  1. Open nRF Connect → the "GATT SERVER" tab → "+" → "ADD SERVICE" → "Primary
     Service", UUID:

       ${SESSIONS[TARGET].serviceUuid}

  2. Inside it, "ADD CHARACTERISTIC", UUID:

       ${CHAR_UUID}

     Properties: WRITE + READ. Permissions: readable + writable, no
     encryption/auth required. Leave the initial value empty — nRF Connect
     echoes back whatever was last written on a Write, which is the round
     trip this rung measures.

  3. Save, then go to the "ADVERTISER" tab → "+" → new advertiser:
       - Advertising data: include this GATT server's service UUID only.
       - UNCHECK "include device name" — a 128-bit service UUID already
         takes 18 of the 31 available advertisement bytes; adding a name
         commonly overflows the packet and the OS silently drops the UUID.
     Start advertising.

  4. Run this on the sensor box:  node run.mjs --target ${TARGET}

For reference, all three candidate EIDs/UUIDs this run watches for:
${Object.entries(SESSIONS).map(([k, s]) => `  ${k}: ${s.serviceUuid}${k === TARGET ? "  ← advertise this one" : ""}`).join("\n")}
`);
  process.exit(0);
}

// ------------------------------------------------------------------- helpers

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}
// A real BLE connect attempt fails or hangs transiently often enough that a
// single try is not a fair test of the mechanism — this is exactly the kind
// of real-world flakiness §5.5 already expects from long-haul relays, not
// something the protocol needs to paper over, but a bare central script does
// need to retry rather than treat one bad attempt as the measurement.
async function connectWithRetries(device, attempts = 3, perAttemptMs = 12_000) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      await withTimeout(device.connect(), perAttemptMs, "connect()");
      return;
    } catch (e) {
      lastErr = e;
      log(`  connect attempt ${i}/${attempts} failed: ${e.message}`);
      await device.disconnect().catch(() => {});
      await sleep(1000);
    }
  }
  throw lastErr;
}
const FIXTURES = join(import.meta.dirname, "fixtures");
if (!existsSync(FIXTURES)) mkdirSync(FIXTURES);

let checks = 0, failures = 0;
function check(name, fn) {
  try { fn(); checks++; log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

// ---------------------------------------------------------------- the run

log("ref-06p2 — the locality binding over real BLE\n");
log(`target session: ${TARGET}  (watching for ${Object.keys(SESSIONS).length} candidate EIDs)\n`);

try {
  const adapter = await bluetooth.defaultAdapter();
  log(`adapter: ${await adapter.getAddress()}  discovering=${await adapter.isDiscovering()}`);
  if (!(await adapter.isDiscovering())) await adapter.startDiscovery();
  log("discovery started\n");

  const expectedByUuid = Object.fromEntries(Object.entries(SESSIONS).map(([k, s]) => [s.serviceUuid.toLowerCase(), k]));

  log(`scanning up to ${SCAN_TIMEOUT_MS / 1000}s for an advert matching one of the ${Object.keys(SESSIONS).length} expected EIDs...`);
  const seenAddresses = new Set();
  const deviceByAddress = new Map(); // avoid re-wrapping the same D-Bus object path every poll (each wrap adds a PropertiesChanged listener)
  let found = null;
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  while (!found && Date.now() < deadline) {
    const addresses = await adapter.devices();
    for (const address of addresses) {
      if (found) break;
      let device = deviceByAddress.get(address);
      if (!device) {
        try { device = await adapter.getDevice(address); deviceByAddress.set(address, device); } catch { continue; }
      }
      let uuids = [];
      try { uuids = (await device.helper.prop("UUIDs")) || []; } catch { /* not yet resolved */ }
      uuids = uuids.map((u) => u.toLowerCase());
      if (!seenAddresses.has(address)) {
        seenAddresses.add(address);
        const name = await device.getName().catch(() => null);
        log(`  saw ${address} "${name || "unnamed"}" services=[${uuids.join(", ") || "none resolved yet"}]`);
      }
      const match = uuids.find((u) => expectedByUuid[u]);
      if (match) found = { device, address, session: expectedByUuid[match] };
    }
    if (!found) await sleep(500);
  }
  await adapter.stopDiscovery().catch(() => {});

  if (!found) {
    console.error(`\n✗ no peripheral advertised an expected session EID within ${SCAN_TIMEOUT_MS}ms.`);
    console.error(`  ${seenAddresses.size} peripheral(s) seen, none matching. Check: is the phone advertising?`);
    console.error(`  Does its advertised service UUID exactly equal ${SESSIONS[TARGET].serviceUuid}? Run --setup to re-print it.`);
    process.exitCode = 1;
  } else {
    check("the discovered advert matches the intended target session, not a decoy or noise", () => {
      if (found.session !== TARGET) throw new Error(`matched session ${found.session}, expected ${TARGET}`);
    });
    log(`\nmatched session ${found.session} — ${found.address}`);

    const device = found.device;
    // BlueZ stops reporting RSSI once discovery ends and a connection is
    // active, so capture the advertised RSSI now, before connecting, rather
    // than fetching a value that will be null on every trial below.
    const advertisedRssi = await device.getRSSI().catch(() => null);
    await connectWithRetries(device);
    log("connected");

    const gattServer = await device.gatt();
    log(`resolved services: [${(await gattServer.services()).join(", ") || "none"}]`);
    const service = await gattServer.getPrimaryService(SESSIONS[TARGET].serviceUuid.toLowerCase());
    let char = null;
    try { char = await service.getCharacteristic(CHAR_UUID.toLowerCase()); } catch { /* checked below */ }
    check(`the ${CHAR_UUID} characteristic exists on the connected peripheral`, () => {
      if (!char) throw new Error("characteristic not found — check the --setup steps were followed exactly");
    });

    if (!char) {
      await device.disconnect().catch(() => {});
      process.exitCode = 1;
    } else {
      log(`\nadvertised rssi at match time: ${advertisedRssi ?? "n/a"}dBm`);
      log(`running ${TRIALS} write→read round trips...`);
      const rtts = [];
      let echoMismatches = 0;
      for (let i = 0; i < TRIALS; i++) {
        const nonce = randomBytes(32);
        const t0 = performance.now();
        await char.writeValue(nonce, { type: "request" }); // write WITH response, per plan §5.3's bounded round trip
        const echoed = await char.readValue();
        const t1 = performance.now();
        const rtt = t1 - t0;
        rtts.push(rtt);
        const echoOk = Buffer.compare(nonce, Buffer.from(echoed).subarray(0, nonce.length)) === 0;
        if (!echoOk) echoMismatches++;
        log(`  trial ${String(i + 1).padStart(2)}/${TRIALS}: rtt=${rtt.toFixed(1)}ms echo=${echoOk ? "ok" : "MISMATCH"}`);
      }
      await device.disconnect().catch(() => {});

      check("every round trip echoed the value this sensor wrote — not a stale or foreign one", () => {
        if (echoMismatches > 0) throw new Error(`${echoMismatches}/${TRIALS} echoes did not match — is another central also writing this characteristic?`);
      });

      const sorted = [...rtts].sort((a, b) => a - b);
      const stats = {
        n: sorted.length,
        medianMs: Number(percentile(sorted, 0.5).toFixed(2)),
        p95Ms: Number(percentile(sorted, 0.95).toFixed(2)),
        worstMs: Number(sorted[sorted.length - 1].toFixed(2)),
        bestMs: Number(sorted[0].toFixed(2)),
      };

      // Not a frozen fixture in the usual ladder sense (real radios don't
      // reproduce a byte-identical number run to run) — a measured record,
      // appended, dated, with the hardware it was measured on named. §5.5
      // needs the DISTRIBUTION, not a single frozen figure.
      const RECORD_PATH = join(FIXTURES, "measured-rtt.jsonl");
      const record = {
        measuredAt: new Date().toISOString(),
        targetSession: TARGET,
        peripheralAddress: found.address,
        advertisedRssiDbm: advertisedRssi,
        trials: TRIALS,
        stats,
      };
      writeFileSync(RECORD_PATH, (existsSync(RECORD_PATH) ? readFileSync(RECORD_PATH, "utf8") : "") + JSON.stringify(record) + "\n");

      log(`\nhonest RTT distribution (n=${stats.n}): median=${stats.medianMs}ms p95=${stats.p95Ms}ms worst=${stats.worstMs}ms best=${stats.bestMs}ms`);
      log(`recorded to ${RECORD_PATH.replace(import.meta.dirname + "/", "")}`);
      log(`\nThis number, not an assertion, is the input ref-06p4 needs to set the timing bound (plan §5.5) —`);
      log(`run this enough times, on the adapter/phone pairing production will actually use, before trusting it.`);
    }
  }
} finally {
  destroy();
}

log(`\n${failures === 0 ? "✅" : "❌"} ${checks} checks passed, ${failures} failed`);
process.exit(failures === 0 && process.exitCode !== 1 ? 0 : 1);
