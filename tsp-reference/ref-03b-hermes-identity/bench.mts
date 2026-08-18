// Perf probe: noble HPKE seal/open ops/sec, same code on Node and Hermes.
// Fixed ephemeral key (bare Hermes has no getRandomValues) — the ephemeral keygen
// is one x25519.getPublicKey call, identical math either way, so the cost is the same.
declare const print: ((s: string) => void) | undefined;
if (typeof console === "undefined") {
  (globalThis as any).console = { log: (...a: unknown[]) => (print as any)(a.join(" ")) };
}

import { seal, open } from "@pr-branch/hpke-noble";
import { x25519 } from "@noble/curves/ed25519.js";

const fill = (n: number, b: number) => new Uint8Array(n).fill(b);
const skS = fill(32, 0x20), skR = fill(32, 0x40), skE = fill(32, 0x60);
const pkR = x25519.getPublicKey(skR), pkS = x25519.getPublicKey(skS);
const info = new TextEncoder().encode("TSP-E-envelope-frame");
const AAD = new Uint8Array(0);

async function bench(label: string, size: number, iters: number) {
  const pt = fill(size, 0xab);
  // warmup
  for (let i = 0; i < 10; i++) await seal(pt, AAD, skS, pkR, info, { __unsafeFixedEphemeralSk: skE });
  let t0 = Date.now();
  let last: any;
  for (let i = 0; i < iters; i++) last = await seal(pt, AAD, skS, pkR, info, { __unsafeFixedEphemeralSk: skE });
  const sealMs = Date.now() - t0;
  t0 = Date.now();
  for (let i = 0; i < iters; i++) await open(last.ciphertext, AAD, last.enc, skR, pkS, info);
  const openMs = Date.now() - t0;
  console.log(
    `${label}: seal ${((iters / sealMs) * 1000).toFixed(0)} ops/s (${(sealMs / iters).toFixed(2)} ms/op) | ` +
      `open ${((iters / openMs) * 1000).toFixed(0)} ops/s (${(openMs / iters).toFixed(2)} ms/op)`,
  );
}

async function main() {
  const engine = typeof (globalThis as any).HermesInternal === "object" && (globalThis as any).HermesInternal !== null ? "hermes" : "node";
  console.log(`# engine: ${engine}`);
  await bench("64B  payload", 64, 300);
  await bench("1KB  payload", 1024, 300);
  await bench("16KB payload", 16384, 150);
  console.log("# done");
}
main();
