// direct.ts's pack/unpack, ported onto tsp-core's three ports (SigningKey/
// KeyAgreement from ref-09/ref-10, VidResolver from ref-11) instead of raw
// PackKeys/UnpackKeys — the gap ref-09's investigation named as the actual
// blocker to custody: direct.ts's own pack/unpack take raw private key bytes
// directly, with no injection point for an opaque signer/key-agreement.
//
// The CESR framing (encodePayloadFrame/decodePayloadFrame/
// encodeSignatureFrame/decodeSignatureFrame) below is NOT a hand transcription
// of the pinned clone's direct.ts — it's rebuilt from the REAL, PUBLISHED
// `@openvtc/vti-tsp-js` package's own exported `cesr` (wire.ts) and
// `encodeEnvelope`/`decodeEnvelope` (envelope.ts), which are pure byte/VID
// framing with no keys involved and are BYTE-IDENTICAL between the published
// 0.1.0 and the pinned 89d70c4 clone (diffed directly; only crypto/hpke.ts's
// backend changed between those, not the framing). Reusing the real exports
// instead of retyping them removes an entire class of transcription bugs from
// the one thing that has to be byte-exact for wire interop.
//
// What's actually new here is the orchestration: `pack`/`unpack` below use
// ref-09/ref-10's ported `seal`/`open` (a `KeyAgreement` port for the LOCAL
// side, a raw public key for the remote side — already exactly the shape
// this needs) for the HPKE-Auth step, a `SigningKey` port for the outer
// signature, and a `VidResolver` to look up the COUNTERPARTY's public keys
// (never local — local key material always comes from a port, never raw).
// See ../../docs/plans/openvtc-integration-plan/2026-09-02-bam.md.

import { cesr, encodeEnvelope, decodeEnvelope } from "@openvtc/vti-tsp-js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";

import * as ported from "../ref-09-tsp-core-ports/hpke-ports.mjs";

const ENC_LEN = 32;
const TAG_LEN = 16;
const SIG_LEN = 64;
const SIG_QUADLETS = Math.ceil(SIG_LEN / 3); // 22
const EMPTY = new Uint8Array(0);

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder("utf-8", { fatal: true });

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Build the CESR payload frame that gets encrypted — identical shape to
 *  direct.ts's own `encodePayloadFrame`, rebuilt on the real package's
 *  exported `cesr` primitives instead of transcribed. */
function encodePayloadFrame(body, kind, hops) {
  const frameBody = [];
  if (kind === "direct") {
    for (const b of cesr.XSCS) frameBody.push(b);
  } else {
    for (const b of cesr.XHOP) frameBody.push(b);
    cesr.encodeHops(
      hops.map((h) => utf8.encode(h)),
      frameBody
    );
  }
  cesr.encodeVariableData(cesr.TSP_PLAINTEXT, body, frameBody);

  const out = [];
  cesr.encodeCount(cesr.TSP_PAYLOAD, frameBody.length / 3, out);
  for (const b of frameBody) out.push(b);
  return new Uint8Array(out);
}

/** Decode a payload frame into its kind, remaining route, and body. */
function decodePayloadFrame(frame) {
  const cur = { pos: 0 };
  if (cesr.decodeCount(cesr.TSP_PAYLOAD, frame, cur) === undefined) {
    throw new Error("tsp: missing -Z payload frame");
  }
  // Optional ESSR sender-VID: the reference omits it for HPKE-Auth. A non-VID
  // marker won't match a `B` var-data field, so this is a tolerant skip.
  cesr.decodeVariableData(cesr.TSP_VID, frame, cur);

  const marker = frame.slice(cur.pos, cur.pos + 3);
  if (bytesEqual(marker, cesr.XSCS)) {
    cur.pos += 3;
    const body = cesr.decodeVariableData(cesr.TSP_PLAINTEXT, frame, cur);
    if (body === undefined) throw new Error("tsp: missing payload plaintext");
    return { kind: "direct", hops: [], body };
  }
  if (bytesEqual(marker, cesr.XHOP)) {
    cur.pos += 3;
    const hopBytes = cesr.decodeHops(frame, cur);
    if (hopBytes === undefined) throw new Error("tsp: malformed hop list");
    let hops;
    try {
      hops = hopBytes.map((h) => fromUtf8.decode(h));
    } catch {
      throw new Error("tsp: hop VID not UTF-8");
    }
    const body = cesr.decodeVariableData(cesr.TSP_PLAINTEXT, frame, cur);
    if (body === undefined) throw new Error("tsp: missing payload plaintext");
    return { kind: hops.length === 0 ? "nested" : "routed", hops, body };
  }
  throw new Error("tsp: unsupported payload type marker");
}

/** Encode the signature frame: `-C<n> -K<n> <fixed B> sig(64)`. */
function encodeSignatureFrame(signature, out) {
  cesr.encodeCount(cesr.TSP_ATTACH_GRP, SIG_QUADLETS, out);
  cesr.encodeCount(cesr.TSP_INDEX_SIG_GRP, SIG_QUADLETS, out);
  cesr.encodeFixedData(cesr.ED25519_SIGNATURE, signature, out);
}

/** Decode the signature frame; returns the 64-byte Ed25519 signature. */
function decodeSignatureFrame(data, cur) {
  const a = cesr.decodeCount(cesr.TSP_ATTACH_GRP, data, cur);
  const k = cesr.decodeCount(cesr.TSP_INDEX_SIG_GRP, data, cur);
  if (a !== SIG_QUADLETS || k !== SIG_QUADLETS) {
    throw new Error("tsp: unexpected signature group size");
  }
  const sig = cesr.decodeFixedData(cesr.ED25519_SIGNATURE, SIG_LEN, data, cur);
  if (sig === undefined) throw new Error("tsp: missing Ed25519 signature");
  return sig;
}

/**
 * @typedef {object} TspIdentity
 * @property {import('../ref-09-tsp-core-ports/ports.mjs').SigningKey} signingKey
 * @property {import('../ref-09-tsp-core-ports/ports.mjs').KeyAgreement} keyAgreement
 */

/**
 * Pack a direct TSP message: build the envelope (= HPKE info), HPKE-Auth seal
 * the payload frame (empty AAD) against the receiver's key as resolved by
 * `resolver`, append `enc`, then sign envelope‖ciphertext with the sender's
 * own `SigningKey` port.
 * @param {Uint8Array} body
 * @param {string} senderVid
 * @param {string} receiverVid
 * @param {TspIdentity} senderIdentity - the sender's OWN local ports; never
 *   resolved, always custody-backed.
 * @param {import('../ref-11-vidresolver-port/ports.mjs').VidResolver} resolver
 *   - resolves the COUNTERPARTY's (receiver's) public keys.
 */
export async function pack(body, senderVid, receiverVid, senderIdentity, resolver) {
  return packWithHops(body, "direct", [], senderVid, receiverVid, senderIdentity, resolver);
}

/** Like {@link pack} but for any message kind, carrying a routing `hops`
 *  list in the payload frame. */
export async function packWithHops(body, kind, hops, senderVid, receiverVid, senderIdentity, resolver) {
  const envelopeBytes = encodeEnvelope(senderVid, receiverVid);

  const payloadFrame = encodePayloadFrame(body, kind, hops);
  const threadDigest = sha256(payloadFrame);

  const { encryptionPublicKey: receiverEncPk } = await resolver.resolve(receiverVid);
  const sealed = await ported.seal(payloadFrame, EMPTY, senderIdentity.keyAgreement, receiverEncPk, envelopeBytes);
  // Reference ciphertext layout: ct ‖ tag(16) ‖ enc(32).
  const gPayload = concat(sealed.ciphertext, sealed.enc);

  const wireBytes = [];
  for (const b of envelopeBytes) wireBytes.push(b);
  cesr.encodeVariableData(cesr.TSP_HPKEAUTH_CIPHERTEXT, gPayload, wireBytes);

  const signature = await senderIdentity.signingKey.sign(new Uint8Array(wireBytes));
  encodeSignatureFrame(signature, wireBytes);

  return { bytes: new Uint8Array(wireBytes), threadDigest };
}

/**
 * Unpack a direct TSP message: parse the envelope (HPKE info), resolve the
 * claimed sender's keys via `resolver`, verify the outer Ed25519 signature,
 * split `enc` off the tail, and HPKE-Auth open (empty AAD) using the
 * receiver's own `KeyAgreement` port.
 * @param {Uint8Array} wireBytes
 * @param {{keyAgreement: import('../ref-09-tsp-core-ports/ports.mjs').KeyAgreement}} receiverIdentity
 *   - the receiver's OWN local port; never resolved, always custody-backed.
 * @param {import('../ref-11-vidresolver-port/ports.mjs').VidResolver} resolver
 *   - resolves the COUNTERPARTY's (sender's) public keys, by the VID the
 *   cleartext envelope claims — the caller is responsible for deciding
 *   whether that claimed sender is who it expected (direct.ts leaves this to
 *   its own caller too; ref-09/ref-10's ports carry no policy).
 */
export async function unpack(wireBytes, receiverIdentity, resolver) {
  if (wireBytes.length < 48) throw new Error("tsp: message too short");

  const { envelope, headerLen } = decodeEnvelope(wireBytes);
  const envelopeBytes = wireBytes.slice(0, headerLen);

  const cur = { pos: headerLen };
  const ctRange = cesr.decodeVariableDataRange(cesr.TSP_HPKEAUTH_CIPHERTEXT, wireBytes, cur);
  if (ctRange === undefined) throw new Error("tsp: missing G ciphertext frame");
  const signedEnd = cur.pos; // signature covers envelope‖ciphertext

  const gLen = ctRange.end - ctRange.begin;
  if (gLen > cesr.MAX_FIELD_SIZE) throw new Error("tsp: ciphertext too large");
  if (gLen < ENC_LEN + TAG_LEN) throw new Error("tsp: ciphertext truncated");

  const signature = decodeSignatureFrame(wireBytes, cur);
  if (cur.pos !== wireBytes.length) throw new Error("tsp: trailing bytes after signature");

  const { signingPublicKey: senderSignPk, encryptionPublicKey: senderEncPk } = await resolver.resolve(envelope.sender);
  if (!ed25519.verify(signature, wireBytes.slice(0, signedEnd), senderSignPk)) {
    throw new Error("tsp: signature verification failed");
  }

  const gPayload = wireBytes.slice(ctRange.begin, ctRange.end);
  const encStart = gPayload.length - ENC_LEN;
  const enc = gPayload.slice(encStart);
  const ctAndTag = gPayload.slice(0, encStart);

  const payloadFrame = await ported.open(ctAndTag, EMPTY, enc, receiverIdentity.keyAgreement, senderEncPk, envelopeBytes);
  const threadDigest = sha256(payloadFrame);
  const frame = decodePayloadFrame(payloadFrame);

  return {
    payload: frame.body,
    sender: envelope.sender,
    receiver: envelope.receiver,
    messageType: frame.kind,
    hops: frame.hops,
    threadDigest,
  };
}

export { sha256 };
