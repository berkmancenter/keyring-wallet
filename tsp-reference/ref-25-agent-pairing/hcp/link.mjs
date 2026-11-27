// hcp/link.mjs: the HCP connect link, a second implementation.
//
// Written from the track C brief's "The connect link" (docs/briefs/2026-11-27-hcp-track-c-brief.md, as committed
// in 1286cc070), not from Keyring's `hcp/connectLink.ts`, so that the two can be held to each other:
//
//   https://link.trustoverip.org/t#_from=<clientVid>&_id=<uuid>&_type=/vti/flow/hcp-connect/0.1
//
// - `_from`: the CLI's VID, an Ed25519 `did:key` (`did:key:z6Mk…`, 56 bytes);
// - `_id`: the request's thread as a lower-case v4 UUID (36 characters); the thread is `urn:uuid:` and it;
// - `_type`: `/vti/flow/hcp-connect/0.1`, or the absolute `https://link.trustoverip.org/vti/flow/hcp-connect/0.1`;
// - exactly these three members, in any order; a missing member, a member twice or any other member is not an HCP
//   connect link;
// - at most 251 bytes (VTI-LNK-081). The link carries neither the VTA's DID nor an expiry.
//
// A value may be percent-encoded, as any fragment value may; a malformed escape is not a link.

export const HCP_LINK_PREFIX = "https://link.trustoverip.org/t#";
export const HCP_CONNECT_FLOW = "/vti/flow/hcp-connect/0.1";
export const HCP_CONNECT_FLOW_ABSOLUTE = "https://link.trustoverip.org/vti/flow/hcp-connect/0.1";
/** The longest link a reader takes, in UTF-8 bytes (VTI-LNK-081). */
export const HCP_LINK_MAX_BYTES = 251;
export const HCP_LINK_MEMBERS = ["_from", "_id", "_type"];

const BASE58 = "[1-9A-HJ-NP-Za-km-z]";
/** `did:key:` and `z6Mk` (base58btc of the Ed25519 multicodec 0xed01) and 44 more base58 characters: 56 in all. */
const ED25519_DID_KEY = new RegExp(`^did:key:z6Mk${BASE58}{44}$`);
const V4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const byteLength = (text) => Buffer.byteLength(text, "utf8");

/** The link for `clientVid` and `uuid`, in the relative `_type` form. Throws on a value a reader would refuse. */
export function hcpConnectLink({ clientVid, uuid }) {
  if (typeof clientVid !== "string" || !ED25519_DID_KEY.test(clientVid)) throw new Error("_from is not an Ed25519 did:key");
  if (typeof uuid !== "string" || !V4_UUID.test(uuid)) throw new Error("_id is not a lower-case v4 UUID");
  const link = `${HCP_LINK_PREFIX}_from=${clientVid}&_id=${uuid}&_type=${HCP_CONNECT_FLOW}`;
  if (byteLength(link) > HCP_LINK_MAX_BYTES) throw new Error("longer than 251 bytes");
  return link;
}

/**
 * `{ clientVid, uuid, threadId }` when `text` is exactly an HCP connect link, else `undefined`. `threadId` is
 * `urn:uuid:` followed by `uuid`.
 */
export function readHcpConnectLink(text) {
  if (typeof text !== "string" || byteLength(text) > HCP_LINK_MAX_BYTES) return undefined;
  if (!text.startsWith(HCP_LINK_PREFIX)) return undefined;
  const members = new Map();
  for (const pair of text.slice(HCP_LINK_PREFIX.length).split("&")) {
    const at = pair.indexOf("=");
    if (at <= 0) return undefined;
    const name = pair.slice(0, at);
    if (!HCP_LINK_MEMBERS.includes(name) || members.has(name)) return undefined;
    let value;
    try {
      value = decodeURIComponent(pair.slice(at + 1));
    } catch {
      return undefined;
    }
    members.set(name, value);
  }
  if (members.size !== HCP_LINK_MEMBERS.length) return undefined;
  const clientVid = members.get("_from");
  const uuid = members.get("_id");
  const type = members.get("_type");
  if (!ED25519_DID_KEY.test(clientVid) || !V4_UUID.test(uuid)) return undefined;
  if (type !== HCP_CONNECT_FLOW && type !== HCP_CONNECT_FLOW_ABSOLUTE) return undefined;
  return { clientVid, uuid, threadId: `urn:uuid:${uuid}` };
}
