// Vendored, frozen copy of `@openvtc/trust-tasks`'s own JCS canonicalizer.
//
// Source: `@openvtc/trust-tasks@0.16.8`, `src/_runtime/canonical.ts`,
// function `canonicalJson` — fetched from the public npm registry on
// 2026-09-06 via `npm pack @openvtc/trust-tasks@0.16.8` (see ../README.md for
// why: this repo's installed/pinned version, 0.9.0, does not ship this file
// at all — see the finding in ../README.md before assuming this is "the
// upstream copy already in our bundle"). Transcribed verbatim from TypeScript
// to plain JS (types erased only; no logic changed). Only `canonicalJson`
// itself is reproduced here — `sha256Hex` and the digest-vs-task-digest
// distinction in the original file's header comment are not needed for this
// corpus, which computes the SAME DigestMultibase construction
// (multibase(base58btc, multihash(sha-256, canonical bytes))) over BOTH
// canonicalizers' output for a fair comparison — see run.mjs.
//
// DO NOT hand-edit this file to "fix" anything found by the corpus. If the
// corpus finds a real divergence, the divergence is the finding — record it,
// don't paper over it here.

/**
 * Serialize `value` with object members recursively ordered and no
 * insignificant whitespace.
 *
 * `undefined` members are omitted, as `JSON.stringify` omits them — which is
 * what makes this agree with the document as it would be sent.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;

  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    // RFC 8785 §3.2.3: sort by UTF-16 code unit, which is what the default
    // comparator does after String() — and these are already strings.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
