// mediator.mjs: one party's live connection to a mediator, and a send that
// needs none.
//
// A `did:key` joins a mediator by answering a DID-signed challenge
// (`/authenticate/challenge`, then `/authenticate`) and opening the pickup
// socket. A sender needs neither: it POSTs a sealed forward to `/inbound`.

import WebSocket from "ws";
import { createHash, randomUUID } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import canonicalize from "canonicalize";
import { MediatorSession, authenticateToMediator, multibase, pack, resolveMediator } from "@openvtc/vti-didcomm-js";
import { recipientOf } from "./identity.mjs";
import { TRUST_TASK_ENVELOPE } from "./envelope.mjs";
import { PROBLEM_REPORT, readRestAnswer } from "./refusal.mjs";

/** The lab mediator listens on loopback over plain HTTP. */
export const LOOPBACK = { allowInsecure: true, allowPrivate: true };

export const ACCOUNT_UPDATE = "https://trusttasks.org/spec/messaging/account/update/0.1";

const sha256Hex = (text) => createHash("sha256").update(text).digest("hex");
const wireTime = (date = new Date()) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

export const mediatorOf = (mediatorDid, netPolicy = LOOPBACK) => resolveMediator(mediatorDid, { netPolicy });

/** Authenticate only. Throws what the library throws; `tryAuthenticate` reduces that to a result. */
export function authenticate(identity, mediatorDid, netPolicy = LOOPBACK) {
  return authenticateToMediator({
    mediatorDid,
    clientDid: identity.did,
    clientX25519Private: identity.xSecret,
    clientX25519Public: identity.xPublic,
    clientKid: identity.kid,
    netPolicy,
  });
}

export async function tryAuthenticate(identity, mediatorDid, netPolicy = LOOPBACK) {
  try {
    return { ok: true, auth: await authenticate(identity, mediatorDid, netPolicy) };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/**
 * Authenticate and open the pickup socket with live delivery on.
 *
 * Returns the session plus two queues: `next()` for messages from peers and
 * `nextFromMediator()` for the mediator's own frames (a Trust Task's answer, a
 * problem report). `closed` resolves with `{ code, reason }` when the socket
 * ends, whoever ended it.
 */
export async function attach(identity, mediatorDid, { netPolicy = LOOPBACK } = {}) {
  const auth = await authenticate(identity, mediatorDid, netPolicy);
  const queue = (label) => {
    const items = [];
    const waiters = [];
    return {
      push(item) {
        const waiter = waiters.shift();
        if (waiter) waiter(item);
        else items.push(item);
      },
      next(timeoutMs = 5000) {
        if (items.length) return Promise.resolve(items.shift());
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            const at = waiters.indexOf(deliver);
            if (at >= 0) waiters.splice(at, 1);
            resolve(undefined);
          }, timeoutMs);
          const deliver = (item) => {
            clearTimeout(timer);
            resolve(item);
          };
          waiters.push(deliver);
        });
      },
      label,
      items,
    };
  };
  const peers = queue("peer");
  const mediatorFrames = queue("mediator");
  let onClosed;
  const closed = new Promise((resolve) => (onClosed = resolve));
  const errors = [];

  const session = new MediatorSession({
    mediator: auth.mediator,
    mediatorJwt: auth.accessToken,
    client: { did: identity.did, kid: identity.kid, privateKey: identity.xSecret, publicKey: identity.xPublic },
    WebSocketImpl: WebSocket,
    netPolicy,
    // A peer here is a did:key or a did:peer:2: both resolve with no network.
    resolveSender: async (did) => recipientOf(did),
    onMessage: (message, _thid, sender) => peers.push({ message, sender }),
    onMediatorMessage: (message) => mediatorFrames.push(message),
    onClose: (event) => onClosed({ code: event?.code, reason: String(event?.reason ?? "") }),
    onError: (error) => errors.push(String(error?.message ?? error)),
  });
  await session.connect();

  return {
    identity,
    auth,
    session,
    errors,
    closed,
    next: peers.next,
    nextFromMediator: mediatorFrames.next,
    close: () => session.close(),
  };
}

/** `attach` that reports a refused socket as a result. */
export async function tryAttach(identity, mediatorDid, options) {
  try {
    return { ok: true, party: await attach(identity, mediatorDid, options) };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/**
 * POST a sealed envelope to the mediator's inbound route. No session is
 * needed, and `token` adds one when a case wants to send as an authenticated
 * account. Returns the reduced answer (see refusal.mjs) with the raw body.
 */
export async function postInbound(mediator, jwe, { token } = {}) {
  const headers = { "content-type": "application/didcomm-encrypted+json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${mediator.restEndpoint.replace(/\/$/, "")}/inbound`, {
    method: "POST",
    headers,
    body: typeof jwe === "string" ? jwe : JSON.stringify(jwe),
  });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // The text is kept as it is.
  }
  const raw = { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
  return { ...readRestAnswer(raw), raw };
}

/** A Trust Task document signed by the party's own key: eddsa-jcs-2022, purpose `authentication`. */
export function signTask(identity, type, recipient, payload) {
  const document = { id: `urn:uuid:${randomUUID()}`, type, issuer: identity.did, recipient, issuedAt: wireTime(), payload };
  const proof = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: wireTime(),
    verificationMethod: identity.authVm,
    proofPurpose: "authentication",
  };
  const hash = (value) => sha256(new TextEncoder().encode(canonicalize(value)));
  const input = new Uint8Array(64);
  input.set(hash(proof), 0);
  input.set(hash(document), 32);
  const signature = ed25519.sign(input, identity.edSecret);
  return { ...document, proof: { ...proof, proofValue: `z${multibase.base58btcEncode(signature)}` } };
}

/**
 * Send a Trust Task to the mediator on the party's socket and wait for the
 * frame threaded to it. Resolves with `{ answer, problem }`: one of the two,
 * or neither when nothing came back in `timeoutMs`.
 */
export async function mediatorTask(party, type, payload, timeoutMs = 8000) {
  const { identity, auth, session } = party;
  const document = signTask(identity, type, auth.mediator.did, payload);
  const now = Math.floor(Date.now() / 1000);
  const message = {
    id: randomUUID(),
    typ: "application/didcomm-plain+json",
    type: TRUST_TASK_ENVELOPE,
    from: identity.did,
    to: [auth.mediator.did],
    created_time: now,
    expires_time: now + 300,
    body: document,
  };
  const jwe = await pack({
    message,
    sender: identity.sender,
    recipient: {
      kid: auth.mediator.kid,
      publicJwk: { kty: "OKP", crv: "X25519", x: Buffer.from(auth.mediator.x25519Pub).toString("base64url"), kid: auth.mediator.kid },
    },
  });
  session.send(jwe);

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return {};
    const frame = await party.nextFromMediator(left);
    if (!frame) return {};
    const threaded = [frame.thid, frame.pthid, frame.body?.threadId].some((t) => t === message.id || t === document.id);
    if (!threaded) continue;
    if (frame.type === PROBLEM_REPORT) return { problem: frame };
    return { answer: frame };
  }
}

/**
 * The self-grant: the account switches its own `SEND_FORWARDED` on. A mediator
 * keys accounts by the SHA-256 of the DID, and the task's `did` is that key.
 */
export function grantSelfForwarding(party) {
  return mediatorTask(party, ACCOUNT_UPDATE, { did: sha256Hex(party.identity.did), acl: { sendForwarded: true } });
}
