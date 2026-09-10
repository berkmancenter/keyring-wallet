#!/usr/bin/env node
// ref-10-credo-askar-adapter — the real Askar-backed SigningKey/KeyAgreement
// adapter ref-09-tsp-core-ports left open ("still needed... not attempted
// here" per its README): two live @credo-ts/node agents, each with its own
// Askar wallet, run through the same fixture suite ref-09 proved the ports
// against with a raw in-memory key and a simulated opaque identity.
//
// Four levels, same order as ref-09, now against real Askar:
//   1. OFFICIAL VECTORS — the CFRG vector's fixed keys, imported into two
//      separate agents' Askar wallets, through the ported HPKE-Auth.
//   2. BYTE-IDENTICAL TO THE RAW IMPLEMENTATION — the same known keys fed
//      to ref-03's unmodified hpke-noble.mjs directly vs. through this
//      rung's real Askar adapter. Proves Askar's `keyFromKeyExchange`
//      computes the identical X25519 shared secret noble's raw DH does —
//      not assumed, checked byte-for-byte.
//   3. FULL ROUND TRIP + FAILURE MODES — real, Askar-*generated* keys
//      (never seen as raw bytes in this process at all), across THREE
//      separate agents (alice/bob/eve). Tamper and wrong-recipient both
//      still rejected.
//   4. CROSS-AGENT DH AGREEMENT — alice and bob each independently call
//      `agree()` against the other's real Askar public key, in two
//      separate agents with two separate wallets. Both sides must derive
//      the identical shared secret. This is the one thing ref-09's
//      single-process simulation could not prove: two real, independent
//      custody boundaries agreeing on the same secret.
//
// Run: npm install && npm start     (--quiet for pass/fail only)

// MUST be the first import in the entry module (transitively, before any
// `@credo-ts/askar` import evaluates) — see "a real import-order gotcha"
// in README.md. `@credo-ts/askar`'s compiled AskarKeyManagementService.mjs
// captures the `askar` binding from `@openwallet-foundation/askar-shared`
// at ITS OWN module-evaluation time rather than reading it live; if that
// evaluation happens before this side-effecting import runs
// `NativeAskar.register(...)`, every `kms.createKey`/`kms.sign` call fails
// later with "Cannot read properties of undefined (reading
// 'keyGetJwkSecret')" — even though the registration genuinely did
// succeed and every other check on the binding (including a direct CJS
// `require`) shows it correctly set. Measured, not assumed: reordering
// this one import is the entire fix.
import "@openwallet-foundation/askar-nodejs";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Agent } from "@credo-ts/core";
import { agentDependencies } from "@credo-ts/node";
import { AskarModule, AskarStoreManager } from "@credo-ts/askar";
import { askarNodeJS as askar } from "@openwallet-foundation/askar-nodejs";
import { Key } from "@openwallet-foundation/askar-shared";
import { x25519 } from "@noble/curves/ed25519.js";

import * as ported from "../ref-09-tsp-core-ports/hpke-ports.mjs";
import * as nobleHpke from "../ref-03-noble-crypto/hpke-noble.mjs";
import {
  createAskarKeyAgreement,
  importAskarKeyAgreement,
  createAskarSigningKey,
} from "./askar-adapter.mjs";

const QUIET = process.argv.includes("--quiet");
const say = (...a) => { if (!QUIET) console.log(...a); };
const here = dirname(fileURLToPath(import.meta.url));

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));
const eq = (a, b) => a.length === b.length && [...a].every((v, i) => v === b[i]);
const utf8 = (s) => new TextEncoder().encode(s);

let checks = 0;
const assert = (cond, what) => {
  if (!cond) throw new Error(`FAILED: ${what}`);
  checks++;
  say(`    ✓ ${what}`);
};

async function makeAgent(name) {
  const agent = new Agent({
    config: { label: name },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({
        askar,
        store: { id: `ref10-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`, key: `ref10-testkey-${name}` },
      }),
    },
  });
  await agent.initialize();
  return agent;
}

const agents = [];
async function agent(name) {
  const a = await makeAgent(name);
  agents.push(a);
  return a;
}

try {
  say("── setting up three real @credo-ts/node agents, each with its own Askar wallet ──");
  const alice = await agent("alice");
  const bob = await agent("bob");
  const eve = await agent("eve");
  say(`  alice, bob, eve initialized (Askar-backed KMS, no RN/Hermes involved)`);

  // ───────────────────────────── 1. official CFRG vectors, real Askar keys
  say("\n── 1. official CFRG HPKE vectors, imported into real Askar wallets ──");
  const vecPath = join(here, "..", "ref-03-noble-crypto", "vectors", "cfrg-auth-x25519-chacha.json");
  const { vectors, source } = JSON.parse(readFileSync(vecPath, "utf8"));
  say(`  source: ${source} (shared with ref-03/ref-09, not duplicated)`);

  for (const [i, v] of vectors.entries()) {
    say(`  vector ${i + 1}/${vectors.length}:`);
    // Fresh agents per vector so re-importing the same fixed key never
    // collides with a keyId from a prior vector.
    const senderAgent = i === 0 ? alice : await agent(`alice-v${i}`);
    const recipientAgent = i === 0 ? bob : await agent(`bob-v${i}`);

    const senderKA = await importAskarKeyAgreement(senderAgent, unhex(v.skSm), unhex(v.pkSm));
    const recipientKA = await importAskarKeyAgreement(recipientAgent, unhex(v.skRm), unhex(v.pkRm));
    assert(eq(senderKA.publicKey, unhex(v.pkSm)), "imported sender public key matches the vector");
    assert(eq(recipientKA.publicKey, unhex(v.pkRm)), "imported recipient public key matches the vector");

    const encaps = await ported.authEncap(unhex(v.pkRm), senderKA, unhex(v.skEm));
    assert(eq(encaps.enc, unhex(v.enc)), `AuthEncap enc matches, via real Askar (${v.enc.slice(0, 16)}…)`);
    assert(eq(encaps.sharedSecret, unhex(v.shared_secret)), "AuthEncap shared_secret matches, via real Askar");

    const decapped = await ported.authDecap(unhex(v.enc), recipientKA, unhex(v.pkSm));
    assert(eq(decapped, unhex(v.shared_secret)), "AuthDecap shared_secret matches, via real Askar");

    const enc0 = v.encryptions[0];
    const sealed = await ported.seal(unhex(enc0.pt), unhex(enc0.aad), senderKA, unhex(v.pkRm), unhex(v.info), unhex(v.skEm));
    assert(eq(sealed.ciphertext, unhex(enc0.ct)), `seal ciphertext matches, via real Askar (${enc0.ct.slice(0, 16)}…)`);

    const opened = await ported.open(unhex(enc0.ct), unhex(enc0.aad), unhex(v.enc), recipientKA, unhex(v.pkSm), unhex(v.info));
    assert(eq(opened, unhex(enc0.pt)), "open recovers the vector plaintext, via real Askar");
  }

  // ───────────────────────────── 2. byte-identical to the unmodified original
  say("\n── 2. byte-identical to ref-03's unmodified hpke-noble.mjs (proves Askar's DH == noble's DH) ──");
  {
    const aliceSk = x25519.utils.randomSecretKey();
    const bobSk = x25519.utils.randomSecretKey();
    const ephemeralSk = x25519.utils.randomSecretKey(); // fixed so both paths mint the same enc
    const info = utf8("ref-10 askar-vs-noble equivalence check");
    const plaintext = utf8("same keys, same bytes, one path through askar, one through raw noble");

    const alicePub = x25519.getPublicKey(aliceSk);
    const bobPub = x25519.getPublicKey(bobSk);
    const aliceKA = await importAskarKeyAgreement(alice, aliceSk, alicePub);
    const bobKA = await importAskarKeyAgreement(bob, bobSk, bobPub);

    const original = await nobleHpke.seal(plaintext, new Uint8Array(0), aliceSk, bobPub, info, ephemeralSk);
    const viaAskar = await ported.seal(plaintext, new Uint8Array(0), aliceKA, bobPub, info, ephemeralSk);
    assert(eq(original.enc, viaAskar.enc), "enc identical (raw noble vs. real Askar)");
    assert(eq(original.ciphertext, viaAskar.ciphertext), "ciphertext identical (raw noble vs. real Askar)");

    const openedOriginal = await nobleHpke.open(original.ciphertext, new Uint8Array(0), original.enc, bobSk, alicePub, info);
    const openedViaAskar = await ported.open(viaAskar.ciphertext, new Uint8Array(0), viaAskar.enc, bobKA, alicePub, info);
    assert(eq(openedOriginal, plaintext) && eq(openedViaAskar, plaintext), "both open() paths recover the same plaintext");

    // The askar-adapter.mjs comment claims the `keyFromKeyExchange` output
    // algorithm tag ("c20p") is an arbitrary, inert packaging choice — the
    // DH itself already ran, this only shapes how `.secretBytes` come back.
    // Checked, not assumed: fetch alice's already-imported key straight out
    // of Askar (same public route the adapter uses) and re-derive with a
    // different output tag; the raw bytes must be identical either way.
    const storeManager = alice.dependencyManager.resolve(AskarStoreManager);
    const [rawShared, rawSharedOtherTag] = await storeManager.withSession(alice.context, async (session) => {
      const entries = await session.fetchAllKeys({ algorithm: "x25519" });
      const aliceEntry = entries.find((e) => eq(e.key.publicBytes, alicePub));
      const peerKey = Key.fromPublicBytes({ algorithm: "x25519", publicKey: bobPub });
      return [
        aliceEntry.key.keyFromKeyExchange({ algorithm: "c20p", publicKey: peerKey }).secretBytes,
        aliceEntry.key.keyFromKeyExchange({ algorithm: "a256gcm", publicKey: peerKey }).secretBytes,
      ];
    });
    assert(eq(rawShared, rawSharedOtherTag), "the keyFromKeyExchange output-algorithm tag is inert — c20p and a256gcm yield identical secretBytes");
  }

  // ───────────────────────────── 3. full round trip + failure modes, real generated keys
  say("\n── 3. full round trip + failure modes, real Askar-generated keys, three separate agents ──");
  {
    const aliceKA = await createAskarKeyAgreement(alice);
    const bobKA = await createAskarKeyAgreement(bob);
    const eveKA = await createAskarKeyAgreement(eve);
    const info = utf8("ref-10 round trip");
    const plaintext = utf8("hello from a real Askar-backed identity");

    const sealed = await ported.seal(plaintext, new Uint8Array(0), aliceKA, bobKA.publicKey, info);
    const opened = await ported.open(sealed.ciphertext, new Uint8Array(0), sealed.enc, bobKA, aliceKA.publicKey, info);
    assert(eq(opened, plaintext), "round trip recovers the plaintext, real Askar keys throughout");

    let tamperCaught = false;
    const tampered = sealed.ciphertext.slice();
    tampered[0] ^= 0xff;
    try {
      await ported.open(tampered, new Uint8Array(0), sealed.enc, bobKA, aliceKA.publicKey, info);
    } catch {
      tamperCaught = true;
    }
    assert(tamperCaught, "tampered ciphertext rejected");

    let wrongRecipientCaught = false;
    try {
      await ported.open(sealed.ciphertext, new Uint8Array(0), sealed.enc, eveKA, aliceKA.publicKey, info);
    } catch {
      wrongRecipientCaught = true;
    }
    assert(wrongRecipientCaught, "wrong recipient (a real, different Askar wallet) rejected");

    // SigningKey port: sign via Credo's PUBLIC kms.sign, verify with plain
    // noble (verification is a public-key operation, no custody concern).
    const { ed25519 } = await import("@noble/curves/ed25519.js");
    const signer = await createAskarSigningKey(alice);
    const message = utf8("sign this via the real Askar-backed SigningKey port");
    const signature = await ported.sign(message, signer);
    assert(ed25519.verify(signature, message, signer.publicKey), "Askar-backed SigningKey port produces a verifiable signature");
  }

  // ───────────────────────────── 4. cross-agent DH agreement
  say("\n── 4. cross-agent DH agreement — two independent Askar wallets, one shared secret ──");
  {
    const aliceKA = await createAskarKeyAgreement(alice);
    const bobKA = await createAskarKeyAgreement(bob);

    const fromAlice = await aliceKA.agree(bobKA.publicKey);
    const fromBob = await bobKA.agree(aliceKA.publicKey);
    assert(eq(fromAlice, fromBob), "alice and bob derive the identical shared secret from two separate Askar wallets");
    assert(!fromAlice.every((b) => b === 0), "the shared secret is not all-zero");
  }

  console.log(`\nREF-10 PASS — ${checks} checks green. A real Askar-backed adapter satisfies tsp-core's SigningKey/KeyAgreement ports.`);
} finally {
  for (const a of agents) {
    try {
      await a.shutdown();
    } catch {
      // best-effort cleanup; leftover sqlite files under the OS temp dir
      // are harmless and match every other rung's convention here.
    }
  }
}
