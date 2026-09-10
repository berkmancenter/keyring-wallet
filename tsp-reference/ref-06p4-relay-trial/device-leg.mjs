// The device-side leg of the staged relay: the ONE process in this rung
// that touches real BLE. It scans for the same target EID ref-06p2 uses
// (so a phone already configured for that rung needs no changes), connects,
// and exposes a tiny newline-JSON TCP server that performs the real
// write-then-read round trip on request. The other leg (sensor-leg.mjs)
// is the one that injects relay latency — this process is deliberately
// dumb: it just does real BLE, honestly, on demand.
//
// Protocol, one JSON object per line, in and out:
//   -> {"cmd":"roundtrip","nonceHex":"..."}
//   <- {"echoedHex":"...","realRttMs":123.4}

import { createBluetooth } from "node-ble";
import { createServer } from "node:net";
import { createHash, hkdfSync } from "node:crypto";
import { performance } from "node:perf_hooks";

const { bluetooth, destroy } = createBluetooth();

// Identical to ref-06p2's session A — so a phone already set up for that
// rung's --setup instructions works here unchanged.
function jcs(v) {
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  if (v && typeof v === "object")
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
function taskDigestHex(doc) {
  return createHash("sha256").update(Buffer.from(jcs(doc), "utf8")).digest("hex");
}
const EID_SALT = "keyring-locality-eid-v1";
const EID_BYTES = 12;
const UUID_PREFIX = "4b524c31";
function deriveEid(challenge, sessionTaskDigestHex) {
  return Buffer.from(hkdfSync("sha256", Buffer.from(challenge, "utf8"), Buffer.from(EID_SALT, "utf8"),
    Buffer.from(sessionTaskDigestHex, "utf8"), EID_BYTES)).toString("hex");
}
function serviceUuid(eidHex) {
  const h = UUID_PREFIX + eidHex;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const CHAR_UUID = "4b524c32-0000-1000-8000-2a2b3c4d5e6f";
const SESSION_A_CHALLENGE = "9f2c1d7e4a8b0c5f3e6d1a2b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";
const sessionTaskDigestHex = taskDigestHex({ threadId: "ref-06p2-session-a", parties: ["did:peer:4alice", "did:peer:4bob"] });
const TARGET_SERVICE_UUID = serviceUuid(deriveEid(SESSION_A_CHALLENGE, sessionTaskDigestHex)).toLowerCase();

const PORT = parseInt(process.argv[process.argv.indexOf("--port") + 1] ?? "47610", 10);
const SCAN_TIMEOUT_MS = 30_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findAndConnect() {
  const adapter = await bluetooth.defaultAdapter();
  if (!(await adapter.isDiscovering())) await adapter.startDiscovery();
  const deviceByAddress = new Map();
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (const address of await adapter.devices()) {
      let device = deviceByAddress.get(address);
      if (!device) {
        try { device = await adapter.getDevice(address); deviceByAddress.set(address, device); } catch { continue; }
      }
      let uuids = [];
      try { uuids = (await device.helper.prop("UUIDs")) || []; } catch { /* not yet resolved */ }
      if (uuids.map((u) => u.toLowerCase()).includes(TARGET_SERVICE_UUID)) {
        await adapter.stopDiscovery().catch(() => {});
        return device;
      }
    }
    await sleep(500);
  }
  throw new Error(`no peripheral advertised ${TARGET_SERVICE_UUID} within ${SCAN_TIMEOUT_MS}ms`);
}

function withTimeout(promise, ms, label) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))]);
}
// Re-scans from scratch on every attempt rather than reusing a cached
// Device object — a timed-out connect() doesn't cancel the underlying D-Bus
// call, and Android rotates the phone's random BLE address between
// advertising sessions, so a stale object from attempt N can point at a
// device path BlueZ has already dropped by attempt N+1 ("UnknownObject" is
// exactly that symptom, hit while building this rung).
let connectedDevice = null;
async function connectFresh(attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const device = await findAndConnect();
      await withTimeout(device.connect(), 15_000, "connect()");
      const gattServer = await device.gatt();
      const service = await gattServer.getPrimaryService(TARGET_SERVICE_UUID);
      const char = await service.getCharacteristic(CHAR_UUID.toLowerCase());
      connectedDevice = device;
      return char;
    } catch (e) {
      lastErr = e;
      console.error(`device-leg: attempt ${i}/${attempts} failed (${e.message}), rescanning...`);
      await sleep(1000);
    }
  }
  throw lastErr;
}

const char = await connectFresh();
console.error(`device-leg: connected, characteristic ready`);

const server = createServer((socket) => {
  let buf = "";
  socket.on("data", async (chunk) => {
    buf += chunk.toString("utf8");
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      const req = JSON.parse(line);
      if (req.cmd === "roundtrip") {
        const nonce = Buffer.from(req.nonceHex, "hex");
        const t0 = performance.now();
        try {
          await char.writeValue(nonce, { type: "request" });
          const echoed = await char.readValue();
          const realRttMs = performance.now() - t0;
          socket.write(JSON.stringify({ echoedHex: Buffer.from(echoed).toString("hex"), realRttMs }) + "\n");
        } catch (e) {
          socket.write(JSON.stringify({ error: e.message }) + "\n");
        }
      }
    }
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`LISTENING ${PORT}`));

process.on("SIGTERM", async () => { await connectedDevice?.disconnect().catch(() => {}); destroy(); process.exit(0); });
