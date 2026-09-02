// The sensor-side leg of the staged relay: what a real sensor's central
// connection would experience if it were talking through a relay instead
// of directly to the device. This process injects the relay's latency —
// split evenly across the outbound and inbound hops, the way a real
// bidirectional relay link would add it on both legs of the round trip —
// around a call to device-leg.mjs's real BLE round trip over a local
// socket. Nothing here touches BLE; the delay is the only thing standing
// in for the missing second physical radio (see README).
//
// Usage: node sensor-leg.mjs --port 47610 --delay-ms 50 --trials 10
// Prints exactly one JSON line to stdout at the end: the trial stats.

import { connect } from "node:net";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";

const argAfter = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const PORT = parseInt(argAfter("--port", "47610"), 10);
const DELAY_MS = parseFloat(argAfter("--delay-ms", "0"));
const TRIALS = parseInt(argAfter("--trials", "10"), 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const socket = connect(PORT, "127.0.0.1");
await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });

let buf = "";
let pending = null;
socket.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  const idx = buf.indexOf("\n");
  if (idx >= 0 && pending) {
    const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
    const resolve = pending; pending = null;
    resolve(JSON.parse(line));
  }
});
function roundtrip(nonceHex) {
  return new Promise((resolve) => {
    pending = resolve;
    socket.write(JSON.stringify({ cmd: "roundtrip", nonceHex }) + "\n");
  });
}

const totalRtts = [];
const realRtts = [];
let echoMismatches = 0;
for (let i = 0; i < TRIALS; i++) {
  const nonce = randomBytes(16);
  const t0 = performance.now();
  await sleep(DELAY_MS / 2); // outbound relay hop
  const result = await roundtrip(nonce.toString("hex"));
  await sleep(DELAY_MS / 2); // inbound relay hop
  const totalRttMs = performance.now() - t0;
  if (result.error) { console.error(`trial ${i} device-leg error: ${result.error}`); continue; }
  totalRtts.push(totalRttMs);
  realRtts.push(result.realRttMs);
  if (!nonce.equals(Buffer.from(result.echoedHex, "hex").subarray(0, nonce.length))) echoMismatches++;
}

socket.end();
const sorted = [...totalRtts].sort((a, b) => a - b);
const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
console.log(JSON.stringify({
  delayMs: DELAY_MS, trials: totalRtts.length, echoMismatches,
  totalRtt: { medianMs: percentile(0.5), p95Ms: percentile(0.95), worstMs: sorted.at(-1), bestMs: sorted[0] },
  realRttMedianMs: [...realRtts].sort((a, b) => a - b)[Math.floor(realRtts.length / 2)] ?? null,
}));
process.exit(0);
