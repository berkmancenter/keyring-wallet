// links.mjs: the two links a pairing can show, their size, and their QR code.
//
// The pairing link is VTI's `auth/oob` trigger link with the owner's VTA in
// `_from` (agent-connect-plan.md section 3.2). `oobLink` builds the text the
// way the pinned producer does (`vti-oob-server/src/util.rs`, `trigger_link`
// and `encode_from`, VTI f7b78e29d): the same order, the same four members,
// the same four characters percent-encoded and no others.
//
// The fallback link names the agent's `did:key` in `_from` under a draft flow
// type, `agent-connect`, and carries the scope the agent asks for.
//
// A producer may emit at most 251 bytes (VTI-LNK-081). That number is the
// capacity of a version 11 QR code at error-correction level M when every
// character is stored as a byte. The rule is the byte count: an encoder that
// stores runs of digits more tightly can draw a slightly longer link at
// version 11, and that does not make the link conform.

import QRCode from "qrcode";
import jsQR from "jsqr";

export const LINK_HOST = "link.trustoverip.org";
export const SIGN_IN_FLOW = "/vti/flow/sign-in/0.1";
/** Keyring's proposal, not registered (the plan's asks ledger, AC-16). */
export const AGENT_CONNECT_FLOW = "/vti/flow/agent-connect/0.1";

export const MAX_LINK_BYTES_LEVEL_M = 251;
export const MAX_QR_VERSION_LEVEL_M = 11;
/** `new_request_id` at the pin: 16 random bytes, base64url, 22 characters. */
export const REQUEST_ID_LENGTH = 22;

/** Percent-encode `&`, `=`, `#` and `%`, and nothing else (the producer's contract C1). */
export function encodeFrom(did) {
  return did.replace(/[&=#%]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The `auth/oob` trigger link, as the pinned producer writes it. `deadline` is in seconds since the epoch. */
export function oobLink({ linkHost = LINK_HOST, serviceDid, requestId, deadline, flow = SIGN_IN_FLOW }) {
  return `https://${linkHost}/t#_from=${encodeFrom(serviceDid)}&_id=${requestId}&_exp=${deadline}&_type=${flow}`;
}

/**
 * The scope an agent asks for, in the fewest bytes that still read: the
 * capabilities as one letter each (`r` memory read, `w` memory write, `p`
 * room present, `o` room open) and the purposes as their names, separated by
 * `.`: `rw~assist.recall`. A link is not private, so nothing here is secret.
 */
/**
 * A purpose as the link can carry it: a registered name, in the specification's own pattern for one (`$defs.Purpose`,
 * first alternative, in `specs/acl/_shared/0.3/acl-entry.schema.json` of the Trust Tasks repository at the pin,
 * 2a66a0351; the VTAs of the lab vendor the same two patterns). That schema's second alternative, an absolute IRI,
 * is a purpose an ACL entry can hold and this link cannot carry.
 */
const PURPOSE_NAME = /^[a-z][a-zA-Z0-9]{0,63}$/;
const CAPABILITY_LETTER = { "memory-read": "r", "memory-write": "w", "room-present": "p", "room-open": "o" };

export function encodeScope({ capabilities = [], purposes = [] }) {
  const letters = capabilities.map((c) => {
    const letter = CAPABILITY_LETTER[c];
    if (!letter) throw new Error(`unknown capability ${c}`);
    return letter;
  });
  for (const purpose of purposes) {
    // `.` separates the names and `~` the two halves, so a name holding either would read back as something else.
    if (!PURPOSE_NAME.test(purpose)) throw new Error(`a purpose the link cannot carry: ${purpose}`);
  }
  return purposes.length ? `${letters.join("")}~${purposes.join(".")}` : letters.join("");
}

export function decodeScope(text) {
  const [letters, purposes = ""] = text.split("~");
  const byLetter = Object.fromEntries(Object.entries(CAPABILITY_LETTER).map(([name, letter]) => [letter, name]));
  return {
    capabilities: [...letters].map((l) => {
      if (!byLetter[l]) throw new Error(`unknown capability letter ${l}`);
      return byLetter[l];
    }),
    purposes: purposes ? purposes.split(".") : [],
  };
}

/**
 * The fallback's link: the agent's `did:key` in `_from`, and the scope it asks for in `_scope`.
 *
 * An agent that asks for nothing, no capability and no purpose, writes no `_scope` member at all: the member is
 * never present with an empty value. A link without it says the agent stated no ask, and what the owner is offered
 * is then the phone's choice. The link carries no duration for the grant; `_exp` is the code's own deadline.
 */
export function agentConnectLink({ linkHost = LINK_HOST, agentDid, requestId, deadline, scope }) {
  const base = oobLink({ linkHost, serviceDid: agentDid, requestId, deadline, flow: AGENT_CONNECT_FLOW });
  const asked = scope ? encodeScope(scope) : "";
  return asked ? `${base}&_scope=${asked}` : base;
}

/** The purposes an agent may be granted (the plan's section 3.3); the names Keyring's `AGENT_PURPOSES` holds. */
export const AGENT_PURPOSES = ["personalisation", "taskExecution"];

/**
 * The scopes the plan's contract names, each as the link an agent would show: for one `did:key`, request id and
 * deadline. Deterministic for fixed inputs, so a recorded copy can be held to the code.
 */
export function scopeRows({ agentDid, requestId, deadline }) {
  const memory = ["memory-read", "memory-write"];
  const rooms = ["room-present", "room-open"];
  const cases = [
    ["nothing asked", { capabilities: [], purposes: [] }],
    ["one purpose, no capability", { capabilities: [], purposes: AGENT_PURPOSES.slice(0, 1) }],
    ["memory, both purposes", { capabilities: memory, purposes: AGENT_PURPOSES }],
    ["memory and rooms, no purpose", { capabilities: [...memory, ...rooms], purposes: [] }],
    ["memory and rooms, both purposes", { capabilities: [...memory, ...rooms], purposes: AGENT_PURPOSES }],
  ];
  return cases.map(([name, scope]) => {
    const link = agentConnectLink({ agentDid, requestId, deadline, scope });
    const at = link.indexOf("&_scope=");
    return { name, scope: at < 0 ? null : link.slice(at + "&_scope=".length), ...measureLink(link) };
  });
}

export const byteLength = (text) => Buffer.byteLength(text, "utf8");

/** The longest `_from` an `auth/oob` link can carry and still fit, for a given host. */
export function longestServiceDid({ linkHost = LINK_HOST, flow = SIGN_IN_FLOW } = {}) {
  const empty = oobLink({ linkHost, serviceDid: "", requestId: "x".repeat(REQUEST_ID_LENGTH), deadline: 1_760_000_000, flow });
  return MAX_LINK_BYTES_LEVEL_M - byteLength(empty);
}

/**
 * The QR code of `text` at level M: its version and module count, and whether
 * a decoder reads the same text back from the drawn code. The decode is a
 * software check of the code this library draws at 4 pixels a module with a
 * 4 module quiet zone; it is not a phone's camera.
 */
export function qrAtLevelM(text, { scale = 4, quiet = 4 } = {}) {
  const code = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = code.modules.size;
  const side = (size + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (!code.modules.data[row * size + column]) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const at = (((row + quiet) * scale + y) * side + (column + quiet) * scale + x) * 4;
          pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
        }
      }
    }
  }
  const read = jsQR(pixels, side, side);
  return { version: code.version, modules: size, decodes: read?.data === text };
}

/** Everything step 0.1(h) records about one link. */
export function measureLink(text) {
  const bytes = byteLength(text);
  const qr = qrAtLevelM(text);
  return {
    bytes,
    fits: bytes <= MAX_LINK_BYTES_LEVEL_M,
    spare: MAX_LINK_BYTES_LEVEL_M - bytes,
    qrVersion: qr.version,
    qrModules: qr.modules,
    qrDecodes: qr.decodes,
  };
}
