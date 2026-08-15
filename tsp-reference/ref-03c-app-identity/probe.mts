// Cross-engine byte-identity probe for the noble HPKE backend (vta-browser-plugin PR #1).
// The SAME bundled file runs under Node and under the Hermes VM binary shipped in the
// app's iOS Pods; every printed line must match byte-for-byte across engines.

// Hermes CLI has `print` but no `console`.
declare const print: ((s: string) => void) | undefined;
if (typeof console === "undefined") {
  (globalThis as any).console = { log: (...a: unknown[]) => (print as any)(a.join(" ")) };
}

import { seal, open, authEncap, authDecap } from "/Users/albertoleon/Documents/keyring-wallet/external/vta-browser-plugin/packages/tsp-js/src/crypto/hpke-noble.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { x25519 } from "@noble/curves/ed25519.js";
import vectorFile from "/Users/albertoleon/Documents/keyring-wallet/tsp-reference/ref-03-noble-crypto/vectors/cfrg-auth-x25519-chacha.json";

const HEX = "0123456789abcdef";
const toHex = (u: Uint8Array) => Array.from(u, (b) => HEX[b >> 4] + HEX[b & 15]).join("");
const fromHex = (s: string) => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
};

const transcript: string[] = [];
let failures = 0;
function check(name: string, got: string, want?: string) {
  const ok = want === undefined || got === want;
  if (!ok) failures++;
  const line = `${ok ? "PASS" : "FAIL"} ${name}: ${got}`;
  transcript.push(line);
  console.log(line);
}

async function main() {
  const engine =
    typeof (globalThis as any).HermesInternal === "object" && (globalThis as any).HermesInternal !== null
      ? "hermes"
      : "node";
  console.log(`# engine: ${engine}`);
  // Report the runtime's WebCrypto surface — evidence for the partial-subtle hazard
  // (Keyring's index.js polyfills subtle with digest ONLY). Not part of the transcript hash.
  const subtle = (globalThis as any).crypto?.subtle;
  console.log(
    `# webcrypto surface: subtle=${typeof subtle} digest=${typeof subtle?.digest} importKey=${typeof subtle?.importKey} deriveBits=${typeof subtle?.deriveBits}`,
  );

  // --- Part 1: official CFRG RFC 9180 vector (mode_auth, suite 0x0020/0x0001/0x0003)
  const v = (vectorFile as any).vectors[0];
  const info = fromHex(v.info);

  const encap = authEncap(fromHex(v.pkRm), fromHex(v.skSm), fromHex(v.skEm));
  check("cfrg.authEncap.enc", toHex(encap.enc), v.enc);
  check("cfrg.authEncap.shared_secret", toHex(encap.sharedSecret), v.shared_secret);

  const decap = authDecap(fromHex(v.enc), fromHex(v.skRm), fromHex(v.pkSm));
  check("cfrg.authDecap.shared_secret", toHex(decap), v.shared_secret);

  // seq=0 encryption: single-shot seal must reproduce the vector's first ciphertext.
  const e0 = v.encryptions[0];
  const sealed = await seal(fromHex(e0.pt), fromHex(e0.aad), fromHex(v.skSm), fromHex(v.pkRm), info, fromHex(v.skEm));
  check("cfrg.seal.enc", toHex(sealed.enc), v.enc);
  check("cfrg.seal.ciphertext", toHex(sealed.ciphertext), e0.ct);

  const opened = await open(fromHex(e0.ct), fromHex(e0.aad), fromHex(v.enc), fromHex(v.skRm), fromHex(v.pkSm), info);
  check("cfrg.open.plaintext", toHex(opened), e0.pt);

  // --- Part 2: TSP-shaped deterministic exchange (fixed keys, fixed ephemeral).
  // No expected value from a spec — the point is that both ENGINES print the same bytes.
  const skS = fromHex("2020202020202020202020202020202020202020202020202020202020202020");
  const skR = fromHex("4040404040404040404040404040404040404040404040404040404040404040");
  const skE = fromHex("6060606060606060606060606060606060606060606060606060606060606060");
  const pkR = x25519.getPublicKey(skR);
  const pkS = x25519.getPublicKey(skS);
  const pt = new TextEncoder().encode("trust task: witness/session bbbb2222 — engine identity probe");
  const tspInfo = new TextEncoder().encode("TSP-E-envelope-frame");

  const s2 = await seal(pt, new Uint8Array(0), skS, pkR, tspInfo, skE);
  check("tsp.seal.enc", toHex(s2.enc));
  check("tsp.seal.ciphertext", toHex(s2.ciphertext));
  const rt = await open(s2.ciphertext, new Uint8Array(0), s2.enc, skR, pkS, tspInfo);
  check("tsp.open.roundtrip", toHex(rt), toHex(pt));

  // --- Aggregate digest over the full transcript: one line to compare across engines.
  const digest = toHex(sha256(new TextEncoder().encode(transcript.join("\n"))));
  console.log(`# transcript-sha256: ${digest}`);
  const result = failures === 0 ? "# RESULT: ALL PASS" : `# RESULT: ${failures} FAILURES`;
  console.log(result);

  // In-app capture channel (ref-03c): RN's console.log no longer reaches the Metro
  // terminal, so POST the transcript to a listener on the host. No-op elsewhere.
  try {
    const f = (globalThis as any).fetch;
    if (typeof f === "function") {
      const subtle = (globalThis as any).crypto?.subtle;
      const surface = `# webcrypto surface: subtle=${typeof subtle} digest=${typeof subtle?.digest} importKey=${typeof subtle?.importKey} deriveBits=${typeof subtle?.deriveBits}`;
      await f("http://localhost:8971/ref-03c", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: [`# engine: ${engine}`, surface, ...transcript, `# transcript-sha256: ${digest}`, result].join("\n"),
      });
    }
  } catch (_) {
    /* listener absent — fine */
  }
}

main();
