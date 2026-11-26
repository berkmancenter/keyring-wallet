// envelope.mjs: the messages the pairing sends, and how they are wrapped.
//
// A sender that holds no account on the recipient's mediator reaches a
// `did:key` in three layers (agent-connect-plan.md section 2.4):
//
//   1. a plain DIDComm v2 message, sender to recipient;
//   2. that message as an authcrypt JWE for the recipient;
//   3. a `routing/2.0/forward` whose `next` is the recipient, carrying the
//      JWE, itself authcrypted to the mediator and POSTed to its inbound route.
//
// Pure: nothing here opens a socket or reads a clock it was not handed.

import { randomUUID } from "node:crypto";
import { buildForward, pack, packAnoncrypt } from "@openvtc/vti-didcomm-js";
import { recipientOf } from "./identity.mjs";

export const BASIC_MESSAGE = "https://didcomm.org/basicmessage/2.0/message";
export const FORWARD = "https://didcomm.org/routing/2.0/forward";
export const TRUST_TASK_ENVELOPE = "https://trusttasks.org/binding/didcomm/0.1/envelope";

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A plain DIDComm v2 message. `now` is in seconds; the message expires 300 s later. */
export function plainMessage({ type = BASIC_MESSAGE, from, to, body, thid, now = nowSeconds() }) {
  const message = {
    id: `urn:uuid:${randomUUID()}`,
    typ: "application/didcomm-plain+json",
    type,
    to: [to],
    created_time: now,
    expires_time: now + 300,
    body,
  };
  if (from) message.from = from;
  if (thid) message.thid = thid;
  return message;
}

/** Layer 2: the message as an authcrypt JWE (a JSON string) for `recipientDid`. */
export function sealFor(message, sender, recipientDid) {
  return pack({ message, sender: sender.sender, recipient: recipientOf(recipientDid) });
}

/**
 * Layer 3: the forward for the mediator.
 *
 * `mediator` is `{ did, kid, x25519Pub }` as `resolveMediator` returns it.
 * With `anonymous`, the forward is anoncrypted, which a mediator that blocks
 * an anonymous outer envelope refuses.
 */
export async function forwardVia({ innerJwe, next, sender, mediator, anonymous = false }) {
  const recipient = {
    kid: mediator.kid,
    publicJwk: { kty: "OKP", crv: "X25519", x: Buffer.from(mediator.x25519Pub).toString("base64url"), kid: mediator.kid },
  };
  if (anonymous) {
    // An anonymous forward names no sender: nothing in it says who sent it.
    const forward = { ...buildForward({ next, innerJwe }), to: [mediator.did] };
    return packAnoncrypt({ message: forward, recipient });
  }
  const forward = buildForward({ next, from: sender.did, mediatorDid: mediator.did, innerJwe });
  return pack({ message: forward, sender: sender.sender, recipient });
}

/** Layers 1 to 3 in one call. Returns the sealed forward and the inner message's id. */
export async function sealedForward({ sender, recipientDid, mediator, body, anonymous = false, now }) {
  const message = plainMessage({ from: sender.did, to: recipientDid, body, now });
  const innerJwe = await sealFor(message, sender, recipientDid);
  const outer = await forwardVia({ innerJwe, next: recipientDid, sender, mediator, anonymous });
  return { outer, innerId: message.id, innerJwe };
}

/** The protected header of a JWE string, decoded. */
export function protectedHeader(jweString) {
  const jwe = typeof jweString === "string" ? JSON.parse(jweString) : jweString;
  return JSON.parse(Buffer.from(jwe.protected, "base64url").toString("utf8"));
}
