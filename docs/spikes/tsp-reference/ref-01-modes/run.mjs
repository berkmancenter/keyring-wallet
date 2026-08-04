#!/usr/bin/env node
// ref-01-modes — nested + routed TSP, the onion walked hop by hop.
//
// Builds on ref-00 (direct mode). Two new ideas:
//
//   NESTED — a complete TSP message carried opaquely inside another one.
//            The inner uses PAIRWISE VIDs, so an observer of the outer layer
//            can't map who is really talking to whom.
//   ROUTED — the onion: Alice seals the core to Bob first (nobody else can
//            ever open it), then wraps it for Relay1 carrying the itinerary.
//            Each relay does an ORDINARY unpack with its own keys, learns
//            only the next hop, re-wraps, forwards. No special machinery —
//            routing is pack()/unpack() called repeatedly by different parties.
//
// Also demonstrates the leak the spec's pairwise-VID rule exists to plug:
// the inner core's envelope is CLEARTEXT to whoever holds the bytes — a relay
// can read its VIDs. Long-term identities there would leak both endpoints;
// pairwise VIDs make the readable labels unlinkable.
//
// Fixtures: fixtures/fixtures.json freezes keys + wire bytes on first run;
// every later run re-unpacks the frozen wires and asserts the results —
// a deterministic regression net against upstream byte-format changes.
//
// Run: npm install && npm start        (--quiet for pass/fail only)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { pack, unpack, packRouted, packNested, nextHop, decodeEnvelope } from "@openvtc/vti-tsp-js";

const QUIET = process.argv.includes("--quiet");
const say = (...a) => { if (!QUIET) console.log(...a); };
const here = dirname(fileURLToPath(import.meta.url));
const fixturesPath = join(here, "fixtures", "fixtures.json");

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));
const utf8 = (s) => new TextEncoder().encode(s);
const deutf8 = (u8) => new TextDecoder().decode(u8);

const mintKey = (curve) => (curve.utils.randomSecretKey ?? curve.utils.randomPrivateKey)();
function mintIdentity(name) {
  const signPriv = mintKey(ed25519);
  const encPriv = mintKey(x25519);
  return { name, signPriv, signPub: ed25519.getPublicKey(signPriv), encPriv, encPub: x25519.getPublicKey(encPriv) };
}
const packKeys = (sender, receiver) => ({
  senderSigningKey: sender.signPriv,
  senderEncryptionKey: sender.encPriv,
  receiverEncryptionKey: receiver.encPub,
});
const unpackKeys = (receiver, sender) => ({
  receiverDecryptionKey: receiver.encPriv,
  senderEncryptionKey: sender.encPub,
  senderSigningKey: sender.signPub,
});

// Cast: everyone mints identities; the script is still the phonebook.
const alice = mintIdentity("alice");
const bob = mintIdentity("bob");
const relay1 = mintIdentity("relay1");
const relay2 = mintIdentity("relay2");

const ALICE = "did:web:alice.example";
const BOB = "did:web:bob.example";
const R1 = "did:web:relay1.example";
const R2 = "did:web:relay2.example";
// Pairwise VIDs — private labels Alice and Bob agreed for THIS relationship.
const ALICE_PW = "did:peer:pw-a7f3";
const BOB_PW = "did:peer:pw-b2e9";

// ------------------------------------------------------------------- NESTED
say("── NESTED: a sealed message inside a sealed message ──");
// Inner: Alice→Bob under their PAIRWISE identities.
const inner = await pack(utf8("secret hello (pairwise)"), ALICE_PW, BOB_PW, packKeys(alice, bob));
// Outer: the inner bytes, carried opaquely to the intermediary (Relay1).
const nested = await packNested(inner.bytes, ALICE, R1, packKeys(alice, relay1));

const relaySeesNested = await unpack(nested.bytes, unpackKeys(relay1, alice));
say(`  Relay1 opens the outer layer: type=${relaySeesNested.messageType}, payload=${relaySeesNested.payload.length}B (opaque inner)`);
const innerEnvAtRelay = decodeEnvelope(relaySeesNested.payload).envelope;
say(`  Relay1 CAN read the inner's cleartext envelope: ${innerEnvAtRelay.sender} → ${innerEnvAtRelay.receiver}`);
say(`    …but those are PAIRWISE labels — unlinkable to ${ALICE} / ${BOB}. That's the point.`);
const bobNested = await unpack(relaySeesNested.payload, unpackKeys(bob, alice));
say(`  Bob (delivered the inner by arrangement) reads: "${deutf8(bobNested.payload)}"`);
if (deutf8(bobNested.payload) !== "secret hello (pairwise)") throw new Error("nested round-trip failed");

// ------------------------------------------------------------------- ROUTED
say("\n── ROUTED: Alice → Relay1 → Relay2 → Bob, the onion hop by hop ──");
// 1. Seal the CORE end-to-end to Bob first. Pairwise VIDs (the honest way).
const core = await pack(utf8("hello through the onion"), ALICE_PW, BOB_PW, packKeys(alice, bob));
say(`  core: sealed to Bob under pairwise VIDs (${core.bytes.length}B) — no relay can ever open this`);

// 2. Wrap for the first hop, itinerary rides INSIDE the sealed layer.
const leg1 = await packRouted(core.bytes, [R2, BOB_PW], ALICE, R1, packKeys(alice, relay1));
say(`\n  leg1  ${ALICE} → ${R1}  (${leg1.bytes.length}B)`);
say(`    what the wire shows anyone: envelope ${decodeEnvelope(leg1.bytes).envelope.sender} → ${decodeEnvelope(leg1.bytes).envelope.receiver}`);

// 3. Relay1: ORDINARY unpack, then the routing decision.
const atR1 = await unpack(leg1.bytes, unpackKeys(relay1, alice));
const stepR1 = nextHop(atR1.hops, atR1.payload);
say(`    Relay1 learns: route onward = [${atR1.hops.join(", ")}] → ${stepR1.kind} to ${stepR1.next}`);
say(`    Relay1 cannot open the inner (${stepR1.inner.length}B, sealed to Bob)`);
if (stepR1.kind !== "forward" || stepR1.next !== R2) throw new Error("relay1 routing wrong");

// 4. Relay1 re-wraps for Relay2 — an ordinary pack under ITS OWN identity.
const leg2 = await packRouted(stepR1.inner, stepR1.remaining, R1, R2, packKeys(relay1, relay2));
say(`\n  leg2  ${R1} → ${R2}  (${leg2.bytes.length}B)`);
say(`    Relay2 sees envelope ${decodeEnvelope(leg2.bytes).envelope.sender} → ${decodeEnvelope(leg2.bytes).envelope.receiver} — Alice's name appears NOWHERE`);

// 5. Relay2: same ordinary unpack; last hop → deliver.
const atR2 = await unpack(leg2.bytes, unpackKeys(relay2, relay1));
const stepR2 = nextHop(atR2.hops, atR2.payload);
say(`    Relay2 learns: route onward = [${atR2.hops.join(", ")}] → ${stepR2.kind} to ${stepR2.next}`);
if (stepR2.kind !== "forward" || stepR2.next !== BOB_PW) throw new Error("relay2 routing wrong");
const finalStep = nextHop(stepR2.remaining, stepR2.inner);
if (finalStep.kind !== "deliver") throw new Error("expected deliver at the exit");
say(`    …the inner IS a complete TSP message — Relay2 just hands the bytes to Bob (transport's job)`);

// 6. Bob: ordinary direct unpack of the core.
const bobRouted = await unpack(finalStep.inner, unpackKeys(bob, alice));
say(`\n  Bob reads: "${deutf8(bobRouted.payload)}"  (sender label: ${bobRouted.sender})`);
if (deutf8(bobRouted.payload) !== "hello through the onion") throw new Error("routed round-trip failed");

// Who-saw-what table — the metadata-privacy scorecard.
say(`\n  who saw what:`);
say(`    observer of leg1 : ${ALICE} → ${R1}                (knows Alice talks to a relay)`);
say(`    Relay1           : + route [${R2}, ${BOB_PW}], inner sealed`);
say(`    observer of leg2 : ${R1} → ${R2}                   (Alice invisible)`);
say(`    Relay2           : + next hop ${BOB_PW} (a pairwise label), inner sealed`);
say(`    Bob              : everything — he holds the only opening key`);
say(`    nobody           : sees ${ALICE} and ${BOB} in the same place. Pairwise VIDs close the last gap.`);

// The leak demo: had Alice used LONG-TERM VIDs in the core, Relay1 could
// read both real endpoints right out of the inner's cleartext envelope.
const leakyCore = await pack(utf8("oops"), ALICE, BOB, packKeys(alice, bob));
const leakyEnv = decodeEnvelope(leakyCore.bytes).envelope;
say(`\n  ⚠ the leak pairwise VIDs prevent: a core packed under long-term VIDs exposes`);
say(`    "${leakyEnv.sender} → ${leakyEnv.receiver}" in cleartext to ANY relay holding it.`);

// ----------------------------------------------------------------- FIXTURES
say("\n── fixtures: freeze keys + wires; every later run re-verifies ──");
mkdirSync(join(here, "fixtures"), { recursive: true });

if (!existsSync(fixturesPath)) {
  const freeze = (id) => ({ signPriv: hex(id.signPriv), encPriv: hex(id.encPriv) });
  const fixtures = {
    note: "Frozen 2026-08-01 against @openvtc/vti-tsp-js 0.1.0 (see ../PINS.json). Wires are frozen captures; unpack is deterministic, so any byte-format change upstream turns this rung red.",
    keys: { alice: freeze(alice), bob: freeze(bob), relay1: freeze(relay1), relay2: freeze(relay2) },
    vectors: [
      { name: "direct-pairwise-core", wire: hex(core.bytes), unpackAs: ["bob", "alice"], expect: { sender: ALICE_PW, receiver: BOB_PW, messageType: "direct", payloadUtf8: "hello through the onion" } },
      { name: "nested-outer", wire: hex(nested.bytes), unpackAs: ["relay1", "alice"], expect: { sender: ALICE, receiver: R1, messageType: "nested" } },
      { name: "routed-leg1", wire: hex(leg1.bytes), unpackAs: ["relay1", "alice"], expect: { sender: ALICE, receiver: R1, messageType: "routed", hops: [R2, BOB_PW] } },
      { name: "routed-leg2", wire: hex(leg2.bytes), unpackAs: ["relay2", "relay1"], expect: { sender: R1, receiver: R2, messageType: "routed", hops: [BOB_PW] } },
    ],
  };
  writeFileSync(fixturesPath, JSON.stringify(fixtures, null, 2) + "\n");
  say(`  fixtures WRITTEN (first run): ${fixtures.vectors.length} vectors → fixtures/fixtures.json`);
  say(`  re-run to verify against the frozen bytes.`);
} else {
  const fx = JSON.parse(readFileSync(fixturesPath, "utf8"));
  const thaw = (k) => ({
    encPriv: unhex(k.encPriv), signPriv: unhex(k.signPriv),
    encPub: x25519.getPublicKey(unhex(k.encPriv)), signPub: ed25519.getPublicKey(unhex(k.signPriv)),
  });
  const cast = Object.fromEntries(Object.entries(fx.keys).map(([n, k]) => [n, thaw(k)]));
  let pass = 0;
  for (const v of fx.vectors) {
    const [rcv, snd] = v.unpackAs;
    const got = await unpack(unhex(v.wire), unpackKeys(cast[rcv], cast[snd]));
    for (const [field, want] of Object.entries(v.expect)) {
      const gotVal = field === "payloadUtf8" ? deutf8(got.payload) : field === "hops" ? JSON.stringify(got.hops) : got[field];
      const wantVal = field === "hops" ? JSON.stringify(want) : want;
      if (gotVal !== wantVal) throw new Error(`fixture ${v.name}: ${field} = ${gotVal}, expected ${wantVal}`);
    }
    pass++;
  }
  say(`  fixtures VERIFIED: ${pass}/${fx.vectors.length} frozen vectors unpack byte-true`);
}

console.log(`\nREF-01 PASS — nested + routed (2 relays) green; pairwise-VID leak demonstrated; fixtures ${existsSync(fixturesPath) ? "in place" : "written"}`);
