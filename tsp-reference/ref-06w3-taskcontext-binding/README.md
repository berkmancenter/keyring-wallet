# ref-06w3 — the taskContext binding: id-only vs digest vs proofValue

**Question this rung answers:** Glenn's finding from the 2026-08 sync — a VWC's
`taskContext` is a document **id**, and "nothing stops me creating a different
trust task with the same document ID … it's not proof of anything." He named
two candidate fixes (the proof value, slight preference, or a hash of the whole
trust task) and asked for both to be tried. This rung is the trial: one
forgery, three binding rules, 13 checks.

**Run:** `node run.mjs` (no dependencies — Node's built-in Ed25519 and SHA-256).

## The forgery

Mallory mints a counterfeit `witness/session` document carrying the **same id**
as the genuine one but different parties. The same VWC is then paired against
genuine and forged documents under each rule.

## Results

| Binding rule | Genuine doc | Forged doc | Unproofed conforming doc |
|---|---|---|---|
| **id-only** (the spec as merged — #213's "taskContext MUST equal the id") | pairs | **pairs — the hole is real** | pairs |
| **taskDigestMultibase** (digest over JCS of the whole document) | pairs | **rejected** | **works** — no proof needed |
| **taskProofValue** — string match only | pairs | **spoofed** — Mallory copies the genuine proof block verbatim | **impossible — no proof exists to anchor to** |
| **taskProofValue** — with full signature verification | pairs | rejected | impossible |

Cost of the digest recompute at verification time (Glenn's expense concern,
measured): **~5 µs** per JCS + SHA-256 + multibase over the session document.

## The two facts that decide it

1. **`witness/session` 0.1 declares `proofRequirement.request: OPTIONAL`** —
   and the request document *is* the taskContext anchor. A proofValue binding
   is structurally unavailable on sessions the merged spec itself permits;
   adopting it would force flipping that OPTIONAL to REQUIRED across every
   witnessed flow.
2. **proofValue's cheap string match has no security value on its own** — the
   attacker controls the forged document's proof block and simply pastes the
   genuine one in. The check only gains teeth behind full signature
   verification (canonicalize + hash + Ed25519 verify), which costs *more*
   than the digest recompute it was meant to avoid. The digest is
   self-verifying by recompute; proofValue is not.

## Recommendation

`taskContext` **stays the id** — the locator, conformant with SPEC §4.9.1 and
O(1) to look up, which answers the search-cost concern — **plus a REQUIRED
`taskDigestMultibase`**: digest over the RFC 8785 canonicalization of the
session document as authored (pre-proof), encoded per
`_framework/0.3#/$defs/DigestMultibase`. Locator and binder, two fields, two
jobs. proofValue remains a fine *index key* where a proof happens to exist,
but cannot be the normative binding.

This is also the registry's own idiom now: `submit#response` already binds
session→credential with `vwcDigestMultibase` (#213); `taskDigestMultibase`
closes the loop credential→session in the same form. And it is generic the
way Glenn wanted — a digest does not care whether the anchored document is a
trust task today or a trust ceremony receipt tomorrow.

## Where the change lands

- **cred-spec #18** (open, unreviewed — amend in place): the VWC gains
  `taskDigestMultibase` REQUIRED beside `taskContext`; the verifier pairing
  checklist gains the digest-match step; retention of the session document
  becomes MUST-ship (priced at 2,213 bytes in ref-06w's A5).
- **trust-tasks-tf** (draft PR): `witness/session` and `witness/session/submit`
  MUST-clauses extend from "taskContext MUST equal the id" to "…and the
  credential's `taskDigestMultibase` MUST match the digest of that document."

## Honest limits

- The proof here is an eddsa-jcs-2022-*shaped* simplification (Ed25519 over
  sha256(JCS(doc))) — enough to demonstrate the anchor semantics; it is not a
  conformant Data Integrity implementation.
- JCS here is the sorted-keys subset sufficient for this value domain (no
  floats, no non-BMP escapes).
