---
name: openvtc-upstream-as-oracle
description: Use upstream's own code as the oracle for anything VTI, TSP, Trust Task or did:webvh — vta-browser-plugin, the OpenVTC repos and vti-tsp-js. Which repo answers which question, how to check our implementation against theirs byte-for-byte, and the traps in reading them. Use before designing or debugging any ecosystem protocol work.
---

# Upstream is the oracle, not our reading of the spec

Every protocol question in this repo has a better answer than reasoning from a
specification: **somebody upstream has already implemented it**, and their
implementation is checkable. Read theirs first. It has repeatedly been faster
and has twice stopped a wrong conclusion from being reported as a finding.

## Which repo answers which question

| Question | Read |
| --- | --- |
| How does a working client do this at all? | `external/vta-browser-plugin` — their own wallet |
| What does the VTA / VTC actually accept or refuse? | `external/verifiable-trust-infrastructure` (`vta-service/`, `vtc-service/`) |
| What are the exact bytes of a TSP frame? | `node_modules/@openvtc/vti-tsp-js` — vendored, and it ships **deterministic test-vector variants** |
| What does the ceremony mean? | `external/openvtc` design notes, and `dtgwg-trust-tasks-tf` for the framework |
| How is a stack meant to be stood up? | `external/vti-setup` |

**Read `external/`'s pinned clones, never a sibling checkout elsewhere on the
machine.** A sibling is not managed by the pin tooling and can sit on any
commit. If a clone is missing, run `scripts/openvtc/setup-external.mjs`.

## The habit that pays: check against them, don't argue with them

`@openvtc/vti-tsp-js` exports `__unsafeDeterministicPack*` helpers **for exactly
this** — fixed ephemeral, caller-supplied nonce, reproducible bytes. So a codec
of ours is not "believed correct", it is packed from the same inputs and
compared byte for byte, thread digest included. That is how the Rev 3
application codec was validated (15 tests) and how `packInviteRev3` was
(4 tests, including with and without a `Reply_Path`).

Jest will not resolve their `unsafe-testing` subpath — its exports map carries
only `import`/`types` conditions. `packages/core/jest.config.js` maps it. Map
the path rather than dropping the check.

## Why we cannot simply call their functions

Their API takes **raw private keys** (`PackKeys.senderSigningKey`, a 32-byte
Ed25519 secret). Our persona keys live in Askar and never exist in memory as
bytes — that custody model is the reason our codec packs through *ports* at
all. So the pattern is: **their bytes, our key handling.** Mirror the layout
exactly, sign through the port, prove equality with their deterministic helper.

Their package also blocks deep imports (`./dist/rev3/...`), so a pure helper
that is not in the public index has to be re-implemented rather than borrowed —
read it, mirror it, then prove it.

## Traps that have cost real time

- **Their comments are the best documentation in the ecosystem.** The reason
  Rev 3 needs an introduction, the `Digest`/`Reply_Digest` naming trap, why a
  referral's derivation bytes differ from its wire bytes — all of it is in
  source comments, not in any published document. Read the file, not just the
  signature.
- **A summarised quote is not a quote.** A fetched page read through a
  summariser is fine for planning and not for quoting upstream. Go to the
  source file before putting words in their mouth.
- **Prior art explains silence.** When something works for them and not for us,
  ask what their client does *differently* rather than what we did wrong:
  `vta-browser-plugin` resolves `did:webvh` with no DID-document class model,
  which is why it never met the Credo `service.type` bug that blocked us
  completely.
- **Version strings lag.** A stack is not one version — measure per component,
  and prefer a service's own `/readyz` or OpenAPI document over inference.

## When you find a defect

Classify it before writing it down: ours, theirs, or both. Check their source
for whether they already know — twice now, a "finding" turned out to be
documented in their own comments, which changes it from a bug report into a
question. See `docs/VTI_UPSTREAM_FINDINGS.md` for the recording conventions and
`.claude/skills/vti-lab-and-field/SKILL.md` for which environment can support
which claim.
