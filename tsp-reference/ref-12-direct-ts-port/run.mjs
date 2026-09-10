#!/usr/bin/env node
// ref-12-direct-ts-port — direct.ts's pack/unpack ported onto tsp-core's
// three ports (ref-09/ref-10/ref-11), the item those rungs' READMEs named as
// the natural next increment once VidResolver existed.
//
// Two levels, different kind of "real" each:
//   1. INTEROP WITH THE REAL, PUBLISHED @openvtc/vti-tsp-js — our ported
//      pack()/unpack() (raw keys wrapped in ref-09's raw-key ports + a
//      fixture VidResolver) exchanged BOTH DIRECTIONS against the actual
//      npm package's own raw-key pack()/unpack(). Not a self-consistency
//      check: if this rung's CESR-framing rebuild (on the real package's own
//      exported `cesr`/envelope primitives) or its port-based orchestration
//      diverged from the real implementation's wire format, this fails.
//      Includes both failure modes (tamper, wrong recipient).
//   2. A REAL END-TO-END ROUND TRIP OVER CREDO/ASKAR — two real
//      `@credo-ts/node` + Askar identities (private keys never leave Askar),
//      each with a did:key VID, exchanging real TSP envelopes both
//      directions through this rung's ported pack()/unpack(), resolving
//      counterparty keys through a real Credo VidResolver. The full
//      envelope stack — CESR framing, HPKE-Auth, outer signature, VID
//      resolution — driven by real custody throughout, nothing raw touched
//      by this process except the two known seeds used only to construct
//      the did:key DIDs (so this rung can independently name the VIDs it's
//      about to use — the KMS operations themselves never expose the keys
//      back out). Includes both failure modes on the real path.
//
// Run: npm install && npm start     (--quiet for pass/fail only)

// Same import-order requirement ref-10/ref-11 document.
import "@openwallet-foundation/askar-nodejs";

import { pack as realPack, unpack as realUnpack } from "@openvtc/vti-tsp-js";
import { Agent, Kms, TypedArrayEncoder } from "@credo-ts/core";
import { agentDependencies } from "@credo-ts/node";
import { AskarModule } from "@credo-ts/askar";
import { askarNodeJS as askar } from "@openwallet-foundation/askar-nodejs";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";

import { pack, unpack } from "./direct-port.mjs";
import { createAskarIdentity, createCredoVidResolver } from "./local-credo-identity.mjs";
import { rawKeySigningKey, rawKeyAgreement } from "../ref-09-tsp-core-ports/raw-key-adapter.mjs";
import { createRawKeyVidResolver } from "../ref-11-vidresolver-port/raw-key-adapter.mjs";

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
        store: { id: `ref12-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`, key: `ref12-testkey-${name}` },
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
  // ───────────────────────────── 1. interop with the real published package
  say("── 1. interop with the real, published @openvtc/vti-tsp-js ──");
  {
    const senderVid = "did:example:ref12-sender";
    const receiverVid = "did:example:ref12-receiver";

    const senderSignSk = ed25519.utils.randomSecretKey();
    const senderEncSk = x25519.utils.randomSecretKey();
    const receiverEncSk = x25519.utils.randomSecretKey();

    const senderSignPk = ed25519.getPublicKey(senderSignSk);
    const senderEncPk = x25519.getPublicKey(senderEncSk);
    const receiverEncPk = x25519.getPublicKey(receiverEncSk);

    const senderIdentity = { signingKey: rawKeySigningKey(senderSignSk), keyAgreement: rawKeyAgreement(senderEncSk) };
    const receiverIdentity = { keyAgreement: rawKeyAgreement(receiverEncSk) };

    const resolver = createRawKeyVidResolver();
    resolver.register(receiverVid, { encryptionPublicKey: receiverEncPk, signingPublicKey: new Uint8Array(32) });
    resolver.register(senderVid, { encryptionPublicKey: senderEncPk, signingPublicKey: senderSignPk });

    const plaintext = utf8("ref-12 interop with the real published package");

    // (a) our ported pack() → the real package's unpack()
    {
      const sealed = await pack(plaintext, senderVid, receiverVid, senderIdentity, resolver);
      const opened = await realUnpack(sealed.bytes, {
        receiverDecryptionKey: receiverEncSk,
        senderEncryptionKey: senderEncPk,
        senderSigningKey: senderSignPk,
      });
      assert(eq(opened.payload, plaintext), "our pack() → real package's unpack(): payload recovered");
      assert(opened.sender === senderVid && opened.receiver === receiverVid, "our pack() → real package's unpack(): sender/receiver VIDs recovered");
      assert(eq(opened.threadDigest, sealed.threadDigest), "our pack() → real package's unpack(): threadDigest matches");
    }

    // (b) the real package's pack() → our ported unpack()
    {
      const sealed = await realPack(plaintext, senderVid, receiverVid, {
        senderSigningKey: senderSignSk,
        senderEncryptionKey: senderEncSk,
        receiverEncryptionKey: receiverEncPk,
      });
      const opened = await unpack(sealed.bytes, receiverIdentity, resolver);
      assert(eq(opened.payload, plaintext), "real package's pack() → our unpack(): payload recovered");
      assert(opened.sender === senderVid && opened.receiver === receiverVid, "real package's pack() → our unpack(): sender/receiver VIDs recovered");
      assert(eq(opened.threadDigest, sealed.threadDigest), "real package's pack() → our unpack(): threadDigest matches");

      let tamperCaught = false;
      const tampered = sealed.bytes.slice();
      tampered[tampered.length - 1] ^= 0xff; // inside the signature — outer sig check must fail
      try {
        await unpack(tampered, receiverIdentity, resolver);
      } catch {
        tamperCaught = true;
      }
      assert(tamperCaught, "tampered wire bytes rejected by our unpack()");

      const wrongReceiver = { keyAgreement: rawKeyAgreement(x25519.utils.randomSecretKey()) };
      let wrongRecipientCaught = false;
      try {
        await unpack(sealed.bytes, wrongReceiver, resolver);
      } catch {
        wrongRecipientCaught = true;
      }
      assert(wrongRecipientCaught, "a different recipient's KeyAgreement cannot open our unpack()");
    }
  }

  // ───────────────────────────── 2. real end-to-end over Credo/Askar
  say("\n── 2. real end-to-end round trip, two Askar identities, real Credo VidResolver ──");
  {
    const alice = await agent("alice");
    const bob = await agent("bob");
    say("  alice, bob initialized (Askar-backed KMS, no RN/Hermes involved)");

    const aliceIdentity = await createAskarIdentity(alice);
    const bobIdentity = await createAskarIdentity(bob);
    say(`  alice: ${aliceIdentity.vid}`);
    say(`  bob:   ${bobIdentity.vid}`);

    // did:key is self-certifying — either agent's resolver can resolve
    // either VID with no network and no prior relationship.
    const resolver = createCredoVidResolver(bob);

    const aliceToBob = utf8("hello bob, from a real Askar identity resolved only by VID");
    const sealed1 = await pack(aliceToBob, aliceIdentity.vid, bobIdentity.vid, aliceIdentity, resolver);
    const opened1 = await unpack(sealed1.bytes, bobIdentity, resolver);
    assert(eq(opened1.payload, aliceToBob), "alice → bob: payload recovered over real Askar custody + real VidResolver");
    assert(opened1.sender === aliceIdentity.vid && opened1.receiver === bobIdentity.vid, "alice → bob: VIDs recovered correctly");
    assert(eq(opened1.threadDigest, sealed1.threadDigest), "alice → bob: threadDigest matches");

    const bobToAlice = utf8("hello alice, replying the same way");
    const sealed2 = await pack(bobToAlice, bobIdentity.vid, aliceIdentity.vid, bobIdentity, resolver);
    const opened2 = await unpack(sealed2.bytes, aliceIdentity, resolver);
    assert(eq(opened2.payload, bobToAlice), "bob → alice: payload recovered over real Askar custody + real VidResolver");

    let tamperCaught = false;
    const tampered = sealed1.bytes.slice();
    tampered[tampered.length - 1] ^= 0xff;
    try {
      await unpack(tampered, bobIdentity, resolver);
    } catch {
      tamperCaught = true;
    }
    assert(tamperCaught, "tampered real-Askar message rejected");

    let wrongRecipientCaught = false;
    try {
      await unpack(sealed1.bytes, aliceIdentity, resolver); // alice trying to open a message addressed to bob
    } catch {
      wrongRecipientCaught = true;
    }
    assert(wrongRecipientCaught, "a real Askar identity cannot open a message not addressed to it");
  }

  console.log(`\nREF-12 PASS — ${checks} checks green. direct.ts's pack/unpack, ported onto tsp-core's three ports, interoperates with the real published package and round-trips end to end over real Askar custody.`);
} finally {
  for (const a of agents) {
    try {
      await a.shutdown();
    } catch {
      // best-effort cleanup, matches every other rung's convention here.
    }
  }
}
