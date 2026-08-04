#!/usr/bin/env node
// ref-00-hello-direct — the simplest possible TSP exchange.
//
// One Node process. Alice mints her 4 long-term numbers, Bob mints his,
// Alice packs "hello bob", Bob unpacks it. Then the two failure modes:
// a tampered byte (outer signature catches it) and a wrong-key eavesdropper.
//
// Wire layout (from vti-tsp-js src/message/direct.ts, byte-compatible with
// the Rust affinidi-tsp crate):
//   [-E envelope]  cleartext: version + sender VID + receiver VID  (HPKE info)
//   [-G frame]     ciphertext ‖ AEAD tag(16) ‖ ephemeral pub key enc(32)
//   [-C/-K frame]  Ed25519 signature(64) over everything before it
//
// Run: npm install && npm start        (--quiet for CI-style pass/fail only)

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { pack, unpack, decodeEnvelope } from "@openvtc/vti-tsp-js";

const QUIET = process.argv.includes("--quiet");
const say = (...a) => { if (!QUIET) console.log(...a); };

const SIG_LEN = 64;
const ENC_LEN = 32;
const TAG_LEN = 16;

const hex = (u8) =>
  [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const hexBlock = (u8, indent = "    ") => {
  const h = hex(u8);
  const lines = [];
  for (let i = 0; i < h.length; i += 64) lines.push(indent + h.slice(i, i + 64));
  return lines.join("\n");
};

// randomSecretKey in @noble/curves v2, randomPrivateKey in v1 — accept either.
const mintKey = (curve) =>
  (curve.utils.randomSecretKey ?? curve.utils.randomPrivateKey)();

function mintIdentity(name) {
  const signPriv = mintKey(ed25519);
  const encPriv = mintKey(x25519);
  return {
    name,
    signPriv,
    signPub: ed25519.getPublicKey(signPriv),
    encPriv,
    encPub: x25519.getPublicKey(encPriv),
  };
}

// ---------------------------------------------------------------- identities
say("── Level 0: mint identities (2 keypairs each, all Curve25519) ──");
const alice = mintIdentity("alice");
const bob = mintIdentity("bob");
const eve = mintIdentity("eve"); // the eavesdropper, for the failure demos

for (const id of [alice, bob]) {
  say(`  ${id.name}:`);
  say(`    Ed25519 sign pub (the seal-checker anyone may hold): ${hex(id.signPub)}`);
  say(`    X25519  enc  pub (the public paint swatch):          ${hex(id.encPub)}`);
}

// VIDs are opaque labels at this layer — vti-tsp-js does no resolution.
// In real life these resolve (did:webvh → keys); here WE are the phonebook.
const ALICE_VID = "did:web:alice.example";
const BOB_VID = "did:web:bob.example";

// --------------------------------------------------------------------- pack
say("\n── pack(): seal (HPKE-Auth) → frame (CESR) → sign (Ed25519) ──");
const body = new TextEncoder().encode("hello bob");
const packed = await pack(body, ALICE_VID, BOB_VID, {
  senderSigningKey: alice.signPriv,
  senderEncryptionKey: alice.encPriv,
  receiverEncryptionKey: bob.encPub,
});

const wire = packed.bytes;
const { envelope, headerLen } = decodeEnvelope(wire);

// Segment the wire. Envelope boundary is exact (headerLen); the signature is
// the last 64 bytes inside its closing frame; the ephemeral key + AEAD tag sit
// at the tail of the ciphertext frame just before the signature frame.
const sigStart = wire.length - SIG_LEN;
const sigFrameStart = sigStart - 8; // -C/-K count codes + fixed-B prefix ≈ 8B; label only
const encStart = sigFrameStart - ENC_LEN;
const tagStart = encStart - TAG_LEN;

say(`  plaintext: "hello bob" (${body.length} bytes) → wire: ${wire.length} bytes\n`);
say(`  [0..${headerLen})  -E envelope — CLEARTEXT address label (relays can read this):`);
say(`      version: TSP v${envelope.version ?? "1"}   sender: ${envelope.sender}   receiver: ${envelope.receiver}`);
say(hexBlock(wire.slice(0, headerLen), "      "));
say(`  [${headerLen}..${tagStart})  ciphertext — the sealed box (only Bob's secret opens it):`);
say(hexBlock(wire.slice(headerLen, tagStart), "      "));
say(`  [${tagStart}..${encStart})  AEAD tag (16B) — tamper detector inside the box:`);
say(hexBlock(wire.slice(tagStart, encStart), "      "));
say(`  [${encStart}..${sigFrameStart})  ephemeral X25519 pub (32B) — minted inside pack(), used once:`);
say(hexBlock(wire.slice(encStart, sigFrameStart), "      "));
say(`  [~${sigStart}..${wire.length})  Ed25519 signature (64B) — the wax seal, verifiable WITHOUT decrypting:`);
say(hexBlock(wire.slice(sigStart), "      "));
say(`  thread digest (SHA-256 of plaintext frame): ${hex(packed.threadDigest).slice(0, 32)}…`);

// ------------------------------------------------------------------- unpack
say("\n── unpack(): verify seal → redo the two DH mixings → open ──");
const msg = await unpack(wire, {
  receiverDecryptionKey: bob.encPriv,
  senderEncryptionKey: alice.encPub,
  senderSigningKey: alice.signPub,
});
const text = new TextDecoder().decode(msg.payload);
say(`  Bob reads: "${text}"   from=${msg.sender}   to=${msg.receiver}   type=${msg.messageType}`);
if (text !== "hello bob") throw new Error("round-trip failed");
if (hex(msg.threadDigest) !== hex(packed.threadDigest)) throw new Error("thread digest mismatch");

// ------------------------------------------------------------ failure modes
say("\n── failure modes (the security properties, demonstrated) ──");

// 1. Tamper one ciphertext byte → outer signature rejects before decryption.
const tampered = wire.slice();
tampered[headerLen + 4] ^= 0xff;
let tamperCaught = false;
try {
  await unpack(tampered, {
    receiverDecryptionKey: bob.encPriv,
    senderEncryptionKey: alice.encPub,
    senderSigningKey: alice.signPub,
  });
} catch (e) {
  tamperCaught = true;
  say(`  ✓ tampered byte rejected: "${e.message}"`);
}
if (!tamperCaught) throw new Error("tampered message was accepted!");

// 2. Eve (wrong receiver key) cannot open the box, even with the real pubs.
let eveCaught = false;
try {
  await unpack(wire, {
    receiverDecryptionKey: eve.encPriv,
    senderEncryptionKey: alice.encPub,
    senderSigningKey: alice.signPub,
  });
} catch (e) {
  eveCaught = true;
  say(`  ✓ eavesdropper (wrong receiver key) rejected: "${e.message}"`);
}
if (!eveCaught) throw new Error("eavesdropper decrypted the message!");

// 3. Sender-authentication: Bob checks the box was built by Alice. If he's
//    told it came from Eve (Eve's enc pub in the mixing), HPKE-Auth fails.
let imposterCaught = false;
try {
  await unpack(wire, {
    receiverDecryptionKey: bob.encPriv,
    senderEncryptionKey: eve.encPub, // "this came from Eve" — no it didn't
    senderSigningKey: alice.signPub,
  });
} catch (e) {
  imposterCaught = true;
  say(`  ✓ wrong claimed sender rejected (HPKE-Auth, the 2nd authentication): "${e.message}"`);
}
if (!imposterCaught) throw new Error("sender authentication did not trip!");

console.log(`\nREF-00 PASS — direct-mode round-trip + 3 failure modes green (wire: ${wire.length}B for a ${body.length}B payload)`);
