#!/usr/bin/env node
// ref-11-vidresolver-port — the VidResolver port ref-09 and ref-10 both
// named as still open ("a simpler concern than the crypto above, no custody
// boundary involved"). Two adapters (the two-implementation rule this
// ladder uses throughout): a raw-key/fixture reference adapter, and a real
// Credo-backed adapter against `agent.dids.resolveDidDocument`.
//
// Four levels:
//   1. FIXTURE ADAPTER CORRECTNESS — the raw-key adapter round-trips known
//      keys under known VIDs, and rejects an unregistered VID.
//   2. CREDO-BACKED ADAPTER, KNOWN KEY, INDEPENDENT CROSS-CHECK — a real
//      Credo/Askar agent creates a did:key DID from a KNOWN, externally-held
//      Ed25519 seed (imported into Askar, never generated opaquely), so this
//      rung can independently verify what comes back. The resolved
//      signingPublicKey must equal the known Ed25519 public key exactly, and
//      the resolved encryptionPublicKey must equal an INDEPENDENTLY computed
//      Ed25519→X25519 conversion (@stablelib/ed25519, the same library
//      Credo's own did:key document builder uses internally) — proving
//      Credo's resolution and this rung's own math agree, not just that the
//      code runs.
//   3. A REAL ROUND TRIP USING ONLY RESOLVER OUTPUT — the strongest check.
//      A sender (a plain raw-key KeyAgreement, ref-09 — Askar-to-Askar
//      agreement is already exhaustively proven in ref-10 and isn't this
//      rung's concern) seals an HPKE-Auth message to the recipient's
//      encryptionPublicKey AS RETURNED BY THE CREDO VIDRESOLVER — nothing
//      else about the recipient's key is passed in by hand. The recipient's
//      side is driven purely by an X25519 private key derived OUTSIDE of
//      anything VidResolver computed (this rung's own
//      convertSecretKeyToX25519 on the known seed, wrapped in ref-09's
//      raw-key KeyAgreement port) and opens it correctly. If the resolver
//      returned the wrong bytes, this open() would fail — it is not a
//      self-consistency check. (Deliberately not ref-10's Askar adapter
//      here: importing it would pull in a SECOND, separately-resolved copy
//      of @credo-ts/core's DI container from its own node_modules tree,
//      which cannot construct instances for classes registered against the
//      copy this rung's own Agent uses — a real dual-package hazard, not a
//      style choice.)
//   4. FAILURE MODES — an unregistered fixture VID and an unresolvable
//      did:key both reject with a clear error rather than returning a
//      partial/undefined result.
//
// Run: npm install && npm start     (--quiet for pass/fail only)

// Same import-order requirement ref-10 documents — must run before any
// `@credo-ts/askar` import evaluates.
import "@openwallet-foundation/askar-nodejs";

import { Agent, Kms, TypedArrayEncoder } from "@credo-ts/core";
import { agentDependencies } from "@credo-ts/node";
import { AskarModule } from "@credo-ts/askar";
import { askarNodeJS as askar } from "@openwallet-foundation/askar-nodejs";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { convertPublicKeyToX25519, convertSecretKeyToX25519 } from "@stablelib/ed25519";

import { createRawKeyVidResolver } from "./raw-key-adapter.mjs";
import { createCredoVidResolver } from "./credo-adapter.mjs";
import { rawKeyAgreement } from "../ref-09-tsp-core-ports/raw-key-adapter.mjs";
import * as ported from "../ref-09-tsp-core-ports/hpke-ports.mjs";

const QUIET = process.argv.includes("--quiet");
const say = (...a) => { if (!QUIET) console.log(...a); };

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
        store: { id: `ref11-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`, key: `ref11-testkey-${name}` },
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
  // ───────────────────────────── 1. fixture adapter correctness
  say("── 1. raw-key/fixture adapter correctness ──");
  {
    const resolver = createRawKeyVidResolver();
    const knownKeys = {
      encryptionPublicKey: new Uint8Array(32).fill(7),
      signingPublicKey: new Uint8Array(32).fill(9),
    };
    resolver.register("did:example:fixture-vid", knownKeys);

    const resolved = await resolver.resolve("did:example:fixture-vid");
    assert(eq(resolved.encryptionPublicKey, knownKeys.encryptionPublicKey), "registered encryptionPublicKey round-trips exactly");
    assert(eq(resolved.signingPublicKey, knownKeys.signingPublicKey), "registered signingPublicKey round-trips exactly");

    let unknownRejected = false;
    try {
      await resolver.resolve("did:example:never-registered");
    } catch {
      unknownRejected = true;
    }
    assert(unknownRejected, "an unregistered VID rejects rather than returning undefined");
  }

  say("\n── setting up a real @credo-ts/node agent, Askar-backed ──");
  const bob = await agent("bob");
  say("  bob initialized (Askar-backed KMS, no RN/Hermes involved)");

  // ───────────────────────────── 2. Credo-backed adapter, known key, cross-checked
  say("\n── 2. Credo-backed adapter, known Ed25519 seed, independent cross-check ──");
  let recipientDid, recipientSeed, recipientEdPub;
  {
    recipientSeed = ed25519.utils.randomSecretKey();
    recipientEdPub = ed25519.getPublicKey(recipientSeed);

    const kms = bob.dependencyManager.resolve(Kms.KeyManagementApi);
    const { keyId } = await kms.importKey({
      privateJwk: {
        kty: "OKP",
        crv: "Ed25519",
        x: TypedArrayEncoder.toBase64URL(recipientEdPub),
        d: TypedArrayEncoder.toBase64URL(recipientSeed),
      },
    });
    const created = await bob.dids.create({ method: "key", options: { keyId } });
    assert(created.didState.state === "finished", "bob's did:key registers from an existing (imported) Askar key");
    recipientDid = created.didState.did;
    say(`  bob's did:key: ${recipientDid}`);

    const resolver = createCredoVidResolver(bob);
    const resolved = await resolver.resolve(recipientDid);
    assert(eq(resolved.signingPublicKey, recipientEdPub), "resolved signingPublicKey matches the known Ed25519 public key exactly");

    const expectedX25519 = convertPublicKeyToX25519(recipientEdPub);
    assert(
      eq(resolved.encryptionPublicKey, expectedX25519),
      "resolved encryptionPublicKey matches an INDEPENDENTLY computed Ed25519→X25519 conversion (@stablelib/ed25519, not Credo's own code path)"
    );
  }

  // ───────────────────────────── 3. real round trip using only resolver output
  say("\n── 3. real HPKE-Auth round trip, recipient key sourced ONLY from the Credo VidResolver ──");
  {
    const resolver = createCredoVidResolver(bob);
    const resolved = await resolver.resolve(recipientDid);

    const senderKA = rawKeyAgreement(x25519.utils.randomSecretKey());
    const info = utf8("ref-11 vidresolver round trip");
    const plaintext = utf8("sealed to a key this rung never touched directly — only resolved");

    const sealed = await ported.seal(plaintext, new Uint8Array(0), senderKA, resolved.encryptionPublicKey, info);

    // The recipient side is deliberately NOT the resolver's own code path:
    // an X25519 private key derived independently from the known seed
    // (never seen by createCredoVidResolver at all), wrapped in ref-09's
    // raw-key KeyAgreement port.
    const recipientX25519Priv = convertSecretKeyToX25519(recipientSeed);
    const recipientKA = rawKeyAgreement(recipientX25519Priv);
    assert(eq(recipientKA.publicKey, resolved.encryptionPublicKey), "independently-derived X25519 public key matches what the resolver returned");

    const opened = await ported.open(sealed.ciphertext, new Uint8Array(0), sealed.enc, recipientKA, senderKA.publicKey, info);
    assert(eq(opened, plaintext), "round trip succeeds using ONLY the VidResolver-obtained public key on the sealing side");
  }

  // ───────────────────────────── 4. failure modes
  say("\n── 4. failure modes ──");
  {
    const resolver = createCredoVidResolver(bob);
    let rejected = false;
    try {
      await resolver.resolve("did:key:zNotAValidMultibaseFingerprint");
    } catch {
      rejected = true;
    }
    assert(rejected, "an unresolvable did:key rejects with a clear error, not a partial result");
  }

  console.log(`\nREF-11 PASS — ${checks} checks green. A raw-key adapter and a real Credo-backed adapter both satisfy tsp-core's VidResolver port.`);
} finally {
  for (const a of agents) {
    try {
      await a.shutdown();
    } catch {
      // best-effort cleanup, matches every other rung's convention here.
    }
  }
}
