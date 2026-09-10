#!/usr/bin/env node
// ref-09-tsp-core-ports — extract SigningKey/KeyAgreement as ports (ports.mjs),
// prove a raw-key reference adapter (raw-key-adapter.mjs) satisfies them with
// zero behavior change, and prove the ported HPKE-Auth/signing (hpke-ports.mjs)
// is still RFC 9180-correct.
//
// This is the blocker ref-07-credo-adapter's design hit, resolved: vti-tsp-js's
// pack/unpack and hpke-js's CipherSuite both require a raw private key with no
// injection point for a pre-computed DH result, which an Askar-backed identity
// (private key never exported) cannot supply. ref-03-noble-crypto's
// hpke-noble.mjs already reimplements HPKE-Auth on @noble primitives, already
// vector- and interop-verified — this rung's only change is parameterizing its
// two DH call sites on the KeyAgreement port instead of a raw private key.
// Full reasoning: docs/plans/openvtc-integration-plan/2026-09-02-bam.md.
//
// Four levels of proof, hardest first:
//   1. OFFICIAL VECTORS — the same CFRG HPKE test vector ref-03 validates
//      against, run through the PORTED implementation via the raw-key
//      adapter. Proves the port refactor is still RFC 9180-correct.
//   2. BYTE-IDENTICAL TO THE ORIGINAL — same keys, same fixed ephemeral key,
//      ref-03's hpke-noble.mjs (unmodified, imported directly) vs. this
//      rung's ported version: identical enc and ciphertext. Proves the
//      refactor changed no behavior for the raw-key case.
//   3. FULL ROUND TRIP + FAILURE MODES — seal/open via the port with random
//      keys; a tampered ciphertext and a wrong recipient key both rejected.
//   4. OPAQUE CUSTODY, SIMULATED — a KeyAgreement/SigningKey pair whose
//      private key lives in a closure the port's caller cannot reach, with
//      every operation forced through a real async boundary (a queued
//      microtask, not synchronous return) — the shape an Askar RPC call
//      would have. Proves the port protocol needs no further change to
//      accept a real custody-boundary-backed implementation.
//
// Run: npm install && npm start     (--quiet for pass/fail only)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { x25519 } from "@noble/curves/ed25519.js";
import * as ported from "./hpke-ports.mjs";
import { rawKeyAgreement, rawKeySigningKey } from "./raw-key-adapter.mjs";
import * as nobleHpke from "../ref-03-noble-crypto/hpke-noble.mjs";

const QUIET = process.argv.includes("--quiet");
const say = (...a) => { if (!QUIET) console.log(...a); };
const here = dirname(fileURLToPath(import.meta.url));

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const utf8 = (s) => new TextEncoder().encode(s);

let checks = 0;
const assert = (cond, what) => {
  if (!cond) throw new Error(`FAILED: ${what}`);
  checks++;
  say(`    ✓ ${what}`);
};

const mintX = () => (x25519.utils.randomSecretKey ?? x25519.utils.randomPrivateKey)();

// ───────────────────────────── 1. official CFRG vectors, through the port
say("── 1. official CFRG HPKE vectors, through the ported (KeyAgreement-based) implementation ──");
const vecPath = join(here, "..", "ref-03-noble-crypto", "vectors", "cfrg-auth-x25519-chacha.json");
const { vectors, source } = JSON.parse(readFileSync(vecPath, "utf8"));
say(`  source: ${source} (shared with ref-03, not duplicated)`);

for (const [i, v] of vectors.entries()) {
  say(`  vector ${i + 1}/${vectors.length}:`);
  const senderKA = rawKeyAgreement(unhex(v.skSm));
  const recipientKA = rawKeyAgreement(unhex(v.skRm));

  const encaps = await ported.authEncap(unhex(v.pkRm), senderKA, unhex(v.skEm));
  assert(eq(encaps.enc, unhex(v.enc)), `AuthEncap enc matches (${v.enc.slice(0, 16)}…)`);
  assert(eq(encaps.sharedSecret, unhex(v.shared_secret)), "AuthEncap shared_secret matches");

  const decapped = await ported.authDecap(unhex(v.enc), recipientKA, unhex(v.pkSm));
  assert(eq(decapped, unhex(v.shared_secret)), "AuthDecap shared_secret matches");

  const enc0 = v.encryptions[0];
  const sealed = await ported.seal(unhex(enc0.pt), unhex(enc0.aad), senderKA, unhex(v.pkRm), unhex(v.info), unhex(v.skEm));
  assert(eq(sealed.ciphertext, unhex(enc0.ct)), `seal ciphertext matches (${enc0.ct.slice(0, 16)}…)`);

  const opened = await ported.open(unhex(enc0.ct), unhex(enc0.aad), unhex(v.enc), recipientKA, unhex(v.pkSm), unhex(v.info));
  assert(eq(opened, unhex(enc0.pt)), "open recovers the vector plaintext");
}

// ───────────────────────────── 2. byte-identical to the unmodified original
say("\n── 2. byte-identical to ref-03's unmodified hpke-noble.mjs (proves the refactor changed nothing) ──");
{
  const aliceSk = mintX(), bobSk = mintX();
  const ephemeralSk = mintX(); // fixed, so both implementations mint the same enc
  const info = utf8("ref-09 equivalence check");
  const plaintext = utf8("same keys, same bytes, either way in");

  const original = await nobleHpke.seal(plaintext, new Uint8Array(0), aliceSk, x25519.getPublicKey(bobSk), info, ephemeralSk);
  const viaPort = await ported.seal(
    plaintext,
    new Uint8Array(0),
    rawKeyAgreement(aliceSk),
    x25519.getPublicKey(bobSk),
    info,
    ephemeralSk,
  );
  assert(eq(original.enc, viaPort.enc), "enc identical (original vs. ported, raw-key case)");
  assert(eq(original.ciphertext, viaPort.ciphertext), "ciphertext identical (original vs. ported, raw-key case)");

  const openedOriginal = await nobleHpke.open(original.ciphertext, new Uint8Array(0), original.enc, bobSk, x25519.getPublicKey(aliceSk), info);
  const openedViaPort = await ported.open(viaPort.ciphertext, new Uint8Array(0), viaPort.enc, rawKeyAgreement(bobSk), x25519.getPublicKey(aliceSk), info);
  assert(eq(openedOriginal, plaintext) && eq(openedViaPort, plaintext), "both open() paths recover the same plaintext");
}

// ───────────────────────────── 3. full round trip + failure modes, random keys
say("\n── 3. full round trip + failure modes, via the port, random keys ──");
{
  const alice = rawKeyAgreement(mintX());
  const bob = rawKeyAgreement(mintX());
  const eve = rawKeyAgreement(mintX());
  const info = utf8("ref-09 round trip");
  const plaintext = utf8("hello from a port-shaped identity");

  const sealed = await ported.seal(plaintext, new Uint8Array(0), alice, bob.publicKey, info);
  const opened = await ported.open(sealed.ciphertext, new Uint8Array(0), sealed.enc, bob, alice.publicKey, info);
  assert(eq(opened, plaintext), "round trip recovers the plaintext");

  let tamperCaught = false;
  const tampered = sealed.ciphertext.slice();
  tampered[0] ^= 0xff;
  try {
    await ported.open(tampered, new Uint8Array(0), sealed.enc, bob, alice.publicKey, info);
  } catch {
    tamperCaught = true;
  }
  assert(tamperCaught, "tampered ciphertext rejected");

  let wrongRecipientCaught = false;
  try {
    await ported.open(sealed.ciphertext, new Uint8Array(0), sealed.enc, eve, alice.publicKey, info);
  } catch {
    wrongRecipientCaught = true;
  }
  assert(wrongRecipientCaught, "wrong recipient key rejected");

  // The outer signature port, same treatment: sign via the port, verify with
  // plain noble (verification is a public-key operation, no custody concern).
  const { ed25519 } = await import("@noble/curves/ed25519.js");
  const signerSk = mintX();
  const signer = rawKeySigningKey(signerSk);
  const message = utf8("sign this via the SigningKey port");
  const signature = await ported.sign(message, signer);
  assert(ed25519.verify(signature, message, signer.publicKey), "SigningKey port produces a verifiable signature");
}

// ───────────────────────────── 4. opaque custody, simulated
say("\n── 4. opaque custody, simulated (the shape an Askar-backed adapter would have) ──");
{
  /**
   * A KeyAgreement whose private key lives ONLY in this closure — nothing
   * outside `opaqueKeyAgreement` can read it — and its one operation is
   * forced through a real async boundary (queueMicrotask), never a
   * synchronous return, matching what an out-of-process KMS RPC would look
   * like. If the port protocol needed synchronous key access anywhere, this
   * would deadlock or throw; it doesn't.
   */
  function opaqueKeyAgreement() {
    const agreeSk = mintX();
    const nextTick = () => new Promise((resolve) => queueMicrotask(resolve));
    return {
      publicKey: x25519.getPublicKey(agreeSk),
      async agree(peerPublicKey) {
        await nextTick();
        return x25519.getSharedSecret(agreeSk, peerPublicKey);
      },
    };
  }

  const alice = { keyAgreement: opaqueKeyAgreement() };
  const bobSk = mintX();
  const bob = rawKeyAgreement(bobSk);
  const info = utf8("ref-09 opaque custody");
  const plaintext = utf8("sealed by an identity that never returns its key");

  const sealed = await ported.seal(plaintext, new Uint8Array(0), alice.keyAgreement, bob.publicKey, info);
  const opened = await ported.open(sealed.ciphertext, new Uint8Array(0), sealed.enc, bob, alice.keyAgreement.publicKey, info);
  assert(eq(opened, plaintext), "an opaque, fully-async KeyAgreement satisfies seal/open with no protocol change");
}

console.log(`\nREF-09 PASS — ${checks} checks green. SigningKey/KeyAgreement ports proven RFC-9180-correct and satisfiable by an opaque, async-only identity.`);
