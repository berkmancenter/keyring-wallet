#!/usr/bin/env node
// fetch-vectors.mjs — extract the official CFRG HPKE test vectors for OUR
// suite only (mode_auth / DHKEM-X25519-HKDF-SHA256 / HKDF-SHA256 /
// ChaCha20Poly1305) into vectors/cfrg-auth-x25519-chacha.json.
//
// Source: https://github.com/cfrg/draft-irtf-cfrg-hpke (test-vectors.json).
// The full file is many MB and covers every suite/mode; we keep only the
// handful of entries that apply, so the rung stays offline-runnable and the
// committed fixture is reviewable.
//
// Run: npm run vectors   (only needed when refreshing; the extract is kept)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const URL_SRC = "https://raw.githubusercontent.com/cfrg/draft-irtf-cfrg-hpke/master/test-vectors.json";

const MODE_AUTH = 2, KEM = 0x0020, KDF = 0x0001, AEAD = 0x0003;

console.log(`fetching ${URL_SRC} …`);
const res = await fetch(URL_SRC);
if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
const all = await res.json();
console.log(`  ${all.length} total vectors`);

const mine = all
  .filter((v) => v.mode === MODE_AUTH && v.kem_id === KEM && v.kdf_id === KDF && v.aead_id === AEAD)
  .map((v) => ({
    // Keep only what a single-shot seal/open needs to be checked.
    info: v.info, ikmE: v.ikmE, skEm: v.skEm, pkEm: v.pkEm,
    skRm: v.skRm, pkRm: v.pkRm, skSm: v.skSm, pkSm: v.pkSm,
    enc: v.enc, shared_secret: v.shared_secret, key: v.key, base_nonce: v.base_nonce,
    encryptions: (v.encryptions ?? []).slice(0, 2).map((e) => ({ aad: e.aad, pt: e.pt, nonce: e.nonce, ct: e.ct })),
  }));

if (mine.length === 0) throw new Error("no vectors matched our suite — did the upstream format change?");
mkdirSync(join(here, "vectors"), { recursive: true });
const out = {
  source: URL_SRC,
  fetched: new Date().toISOString().slice(0, 10),
  filter: "mode=2 (auth), kem=0x0020 DHKEM(X25519,HKDF-SHA256), kdf=0x0001, aead=0x0003 ChaCha20Poly1305",
  vectors: mine,
};
writeFileSync(join(here, "vectors", "cfrg-auth-x25519-chacha.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`  kept ${mine.length} vector(s) for our suite → vectors/cfrg-auth-x25519-chacha.json`);
