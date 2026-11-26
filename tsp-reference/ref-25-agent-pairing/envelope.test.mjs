// The rung's own packing and forward handling, with no mediator.
//
// A "mediator" here is a third identity: the tests open the outer envelope
// with its key, as a mediator would, and then the inner one as the recipient.

import { test } from "node:test";
import assert from "node:assert/strict";
import { unpack } from "@openvtc/vti-didcomm-js";
import { identityFromSeed, mintIdentity, peerIdentity, recipientOf } from "./identity.mjs";
import { FORWARD, forwardVia, plainMessage, protectedHeader, sealFor, sealedForward } from "./envelope.mjs";

const seed = (byte) => new Uint8Array(32).fill(byte);
const asRecipient = (id) => ({ kid: id.kid, privateJwk: id.sender.privateJwk });
const asMediator = (id) => ({ did: id.did, kid: id.kid, x25519Pub: id.xPublic });

test("a seed gives one did:key, the same every time", () => {
  const a = identityFromSeed(seed(1));
  const b = identityFromSeed(seed(1));
  assert.equal(a.did, b.did);
  assert.match(a.did, /^did:key:z6Mk/);
  assert.equal(a.did.length, 56);
  assert.ok(a.kid.startsWith(`${a.did}#z6LS`), "the key-agreement key id is the derived X25519 key");
  assert.notEqual(identityFromSeed(seed(2)).did, a.did);
});

test("recipientOf reads a did:key with no network", () => {
  const a = identityFromSeed(seed(3));
  const recipient = recipientOf(a.did);
  assert.equal(recipient.kid, a.kid);
  assert.equal(recipient.publicJwk.x, Buffer.from(a.xPublic).toString("base64url"));
});

test("a did:peer:2 carries its service and resolves to the same keys", () => {
  const a = identityFromSeed(seed(4));
  const peer = peerIdentity(a, "http://127.0.0.1:7061/mediator/v1");
  assert.match(peer.did, /^did:peer:2\.Ez6LS[^.]+\.Vz6Mk[^.]+\.S/);
  assert.equal(recipientOf(peer.did).publicJwk.x, Buffer.from(a.xPublic).toString("base64url"));
  assert.notEqual(peerIdentity(a, "https://elsewhere.example/mediator/v1").did, peer.did, "the service is part of the DID");
});

test("the inner message is authcrypt: the recipient opens it and learns the sender", async () => {
  const alice = mintIdentity();
  const bob = mintIdentity();
  const message = plainMessage({ from: alice.did, to: bob.did, body: { content: "hello" }, now: 1_760_000_000 });
  const jwe = await sealFor(message, alice, bob.did);

  assert.equal(protectedHeader(jwe).alg, "ECDH-1PU+A256KW");
  const opened = await unpack(jwe, asRecipient(bob), recipientOf(alice.did));
  assert.equal(opened.authenticated, true);
  assert.equal(opened.senderDid, alice.did);
  assert.deepEqual(opened.message.body, { content: "hello" });
  assert.equal(opened.message.expires_time - opened.message.created_time, 300);
});

test("someone else cannot open the inner message", async () => {
  const alice = mintIdentity();
  const bob = mintIdentity();
  const eve = mintIdentity();
  const jwe = await sealFor(plainMessage({ from: alice.did, to: bob.did, body: {} }), alice, bob.did);
  await assert.rejects(unpack(jwe, asRecipient(eve), recipientOf(alice.did)));
});

test("the forward names the recipient in `next` and carries the inner message untouched", async () => {
  const alice = mintIdentity();
  const bob = mintIdentity();
  const mediator = mintIdentity();
  const { outer, innerId, innerJwe } = await sealedForward({
    sender: alice,
    recipientDid: bob.did,
    mediator: asMediator(mediator),
    body: { content: "through the mediator" },
  });

  const atMediator = await unpack(outer, asRecipient(mediator), recipientOf(alice.did));
  assert.equal(atMediator.authenticated, true, "the outer envelope is authcrypt");
  assert.equal(atMediator.senderDid, alice.did);
  assert.equal(atMediator.message.type, FORWARD);
  assert.equal(atMediator.message.body.next, bob.did);
  assert.deepEqual(atMediator.message.to, [mediator.did]);

  const carried = atMediator.message.attachments[0].data.json;
  assert.deepEqual(carried, JSON.parse(innerJwe));
  const atBob = await unpack(JSON.stringify(carried), asRecipient(bob), recipientOf(alice.did));
  assert.equal(atBob.message.id, innerId);
  assert.deepEqual(atBob.message.body, { content: "through the mediator" });
});

test("the mediator cannot read what it forwards", async () => {
  const alice = mintIdentity();
  const bob = mintIdentity();
  const mediator = mintIdentity();
  const { outer } = await sealedForward({ sender: alice, recipientDid: bob.did, mediator: asMediator(mediator), body: {} });
  const atMediator = await unpack(outer, asRecipient(mediator), recipientOf(alice.did));
  const carried = JSON.stringify(atMediator.message.attachments[0].data.json);
  await assert.rejects(unpack(carried, asRecipient(mediator), recipientOf(alice.did)));
});

test("an anonymous forward names no sender, and its envelope is anoncrypt", async () => {
  const alice = mintIdentity();
  const bob = mintIdentity();
  const mediator = mintIdentity();
  const innerJwe = await sealFor(plainMessage({ from: alice.did, to: bob.did, body: {} }), alice, bob.did);
  const outer = await forwardVia({ innerJwe, next: bob.did, sender: alice, mediator: asMediator(mediator), anonymous: true });

  const header = protectedHeader(outer);
  assert.match(header.alg, /^ECDH-ES/);
  assert.equal(header.skid, undefined);
  const atMediator = await unpack(outer, asRecipient(mediator));
  assert.equal(atMediator.authenticated, false);
  assert.equal(atMediator.message.from, undefined);
  assert.equal(atMediator.message.body.next, bob.did);
});

test("a forward to a did:peer recipient is addressed by that DID", async () => {
  const alice = mintIdentity();
  const bob = peerIdentity(mintIdentity(), "http://127.0.0.1:7061/mediator/v1");
  const mediator = mintIdentity();
  const { outer } = await sealedForward({ sender: alice, recipientDid: bob.did, mediator: asMediator(mediator), body: {} });
  const atMediator = await unpack(outer, asRecipient(mediator), recipientOf(alice.did));
  assert.equal(atMediator.message.body.next, bob.did);
});
