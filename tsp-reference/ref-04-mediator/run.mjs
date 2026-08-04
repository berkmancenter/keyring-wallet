#!/usr/bin/env node
// ref-04-mediator — TSP through a real mediator, the shape production uses.
//
// Everything below ref-03 ran with no infrastructure. This rung introduces the
// one piece a phone genuinely cannot do without: a mediator, because phones
// can't accept inbound connections. The rules it teaches (all enforced by the
// ecosystem, not by us):
//
//   • ONE WebSocket PER DID. TSP does not get its own connection — it rides
//     the DIDComm message-pickup socket. A second socket for the same DID is
//     evicted as `duplicate-channel`.
//   • Frames are demultiplexed by content: DIDComm arrives as JSON text; TSP
//     arrives base64url-encoded starting `-E` (CESR magic 0xF8) and is handed
//     to `onTspFrame` as raw bytes. Outbound TSP is a raw binary WS frame.
//   • Routing comes from the TSP envelope, not from HTTP: the mediator opens
//     the outer routing hop (sealed to ITS key), reads the next hop, and
//     drops the still-sealed inner into the recipient's mailbox.
//   • TSP carries no thread id at this layer — correlation is the caller's
//     job (we use the thread digest).
//
// Wallet→mediator→peer is exactly ref-01's routed mode: pack the payload
// end-to-end to the peer, then packRouted it to the mediator with the peer as
// the remaining route.
//
// NETWORK: this rung talks to a mediator over the internet by default (the
// ecosystem's public dev mediator, the same one the browser plugin ships as
// its default). Override with MEDIATOR_DID=... , or point at a local one.
// Payloads are end-to-end encrypted; the mediator sees only routing metadata.

import { WebSocket } from "ws";
import { authenticateToMediator, MediatorSession } from "@openvtc/vti-didcomm-js";
import { pack, packRouted, unpack } from "@openvtc/vti-tsp-js";

import { mintIdentity, tspKeysForDid } from "./identity.mjs";

const QUIET = process.argv.includes("--quiet");
const say = (...a) => { if (!QUIET) console.log(...a); };

// The ecosystem's public dev mediator (browser plugin's DEFAULT_WALLET_MEDIATOR_DID
// and the mobile core's VTA_TEST_MEDIATOR default).
const MEDIATOR_DID = process.env.MEDIATOR_DID
  ?? "did:webvh:QmTS3a3H9Dk4ZMPAZ8jNWGeyPbuKrPbrPZcSbg8CJ6yynD:webvh.storm.ws:mediator";

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const utf8 = (s) => new TextEncoder().encode(s);
const deutf8 = (u8) => new TextDecoder().decode(u8);

/** Attach one party to the mediator: authenticate, then open the pickup socket. */
async function attach(name, id) {
  const auth = await authenticateToMediator({
    mediatorDid: MEDIATOR_DID,
    clientDid: id.did,
    clientX25519Private: id.xSecret,
    clientX25519Public: id.xPublic,
    allowInsecure: Boolean(process.env.MEDIATOR_ALLOW_INSECURE),
  });

  const inbox = [];
  const waiters = [];
  const session = new MediatorSession({
    mediator: auth.mediator,
    mediatorJwt: auth.accessToken,
    client: { did: id.did, kid: id.kid, privateKey: id.xSecret, publicKey: id.xPublic },
    WebSocketImpl: WebSocket,
    // TSP frames land here as raw CESR bytes — already demuxed off the stream
    // that also carries DIDComm JSON. This callback IS the TSP leg.
    onTspFrame: (bytes) => {
      const waiter = waiters.shift();
      if (waiter) waiter(bytes);
      else inbox.push(bytes);
    },
    onError: (e) => say(`  [${name}] socket note: ${e?.message ?? e}`),
  });
  await session.connect();
  say(`  [${name}] authenticated + live-delivery socket open`);
  say(`           did: ${id.did.slice(0, 32)}…`);

  const nextTspFrame = (timeoutMs = 20000) =>
    new Promise((resolve, reject) => {
      if (inbox.length) return resolve(inbox.shift());
      const timer = setTimeout(() => reject(new Error(`${name}: no TSP frame within ${timeoutMs}ms`)), timeoutMs);
      waiters.push((bytes) => { clearTimeout(timer); resolve(bytes); });
    });

  return { auth, session, nextTspFrame };
}

say("── attaching two independent parties to the mediator ──");
say(`  mediator: ${MEDIATOR_DID}`);
const alice = mintIdentity();
const bob = mintIdentity();
const alicePub = tspKeysForDid(alice.did);
const bobPub = tspKeysForDid(bob.did);

const A = await attach("alice", alice);
const B = await attach("bob", bob);

// The mediator's own X25519 key — the routing layer is sealed to this.
const mediatorVid = A.auth.mediator.did;
const mediatorEncPub = A.auth.mediator.x25519Pub;
say(`  mediator VID resolved: ${mediatorVid.slice(0, 40)}…`);

let passed = 0;
try {
  // ─────────────────────────── routed send (what Rust/iOS do)
  say("\n── routed: pack end-to-end to Bob, wrap for the mediator ──");
  const inner = await pack(utf8("hello bob, via the mediator"), alice.did, bob.did, {
    senderSigningKey: alice.edSecret,
    senderEncryptionKey: alice.xSecret,
    receiverEncryptionKey: bobPub.encPub,
  });
  say(`  inner (sealed to Bob only): ${inner.bytes.length}B, thread digest ${hex(inner.threadDigest).slice(0, 16)}…`);

  const outer = await packRouted(inner.bytes, [bob.did], alice.did, mediatorVid, {
    senderSigningKey: alice.edSecret,
    senderEncryptionKey: alice.xSecret,
    receiverEncryptionKey: mediatorEncPub,
  });
  say(`  outer (routing hop, sealed to the mediator): ${outer.bytes.length}B`);

  A.session.sendBinary(outer.bytes);
  say(`  → sent as a raw binary WS frame on Alice's single socket`);

  const frame = await B.nextTspFrame();
  say(`  ← Bob's onTspFrame fired: ${frame.length}B (base64url text on the wire, demuxed to bytes)`);

  const got = await unpack(frame, {
    receiverDecryptionKey: bob.xSecret,
    senderEncryptionKey: alicePub.encPub,
    senderSigningKey: alicePub.signPub,
  });
  const text = deutf8(got.payload);
  say(`  Bob reads: "${text}"`);
  if (text !== "hello bob, via the mediator") throw new Error("routed payload mismatch");
  if (hex(got.threadDigest) !== hex(inner.threadDigest)) throw new Error("thread digest mismatch");
  say(`  ✓ thread digest matches what Alice packed — correlation without any thread id`);
  say(`  ✓ the mediator forwarded the inner UNCHANGED (it never held Bob's key)`);
  passed++;

  // ─────────────────────────── direct send (what the browser wallet does)
  say("\n── direct: no routing layer, receiver VID in the cleartext envelope ──");
  const direct = await pack(utf8("hello again, direct"), alice.did, bob.did, {
    senderSigningKey: alice.edSecret,
    senderEncryptionKey: alice.xSecret,
    receiverEncryptionKey: bobPub.encPub,
  });
  A.session.sendBinary(direct.bytes);
  say(`  → sent ${direct.bytes.length}B; the mediator routes on the envelope's receiver VID`);

  const frame2 = await B.nextTspFrame();
  const got2 = await unpack(frame2, {
    receiverDecryptionKey: bob.xSecret,
    senderEncryptionKey: alicePub.encPub,
    senderSigningKey: alicePub.signPub,
  });
  say(`  Bob reads: "${deutf8(got2.payload)}"  (messageType=${got2.messageType})`);
  if (deutf8(got2.payload) !== "hello again, direct") throw new Error("direct payload mismatch");
  passed++;

  // ─────────────────────────── reply, proving the leg is bidirectional
  say("\n── Bob replies on his own socket ──");
  const reply = await pack(utf8("got it, alice"), bob.did, alice.did, {
    senderSigningKey: bob.edSecret,
    senderEncryptionKey: bob.xSecret,
    receiverEncryptionKey: alicePub.encPub,
  });
  B.session.sendBinary(reply.bytes);
  const frame3 = await A.nextTspFrame();
  const got3 = await unpack(frame3, {
    receiverDecryptionKey: alice.xSecret,
    senderEncryptionKey: bobPub.encPub,
    senderSigningKey: bobPub.signPub,
  });
  say(`  Alice reads: "${deutf8(got3.payload)}"`);
  if (deutf8(got3.payload) !== "got it, alice") throw new Error("reply payload mismatch");
  passed++;
} finally {
  A.session.close();
  B.session.close();
}

console.log(`\nREF-04 PASS — ${passed}/3 exchanges through a real mediator (routed, direct, reply); one socket per DID, TSP demuxed off the DIDComm pickup stream`);
