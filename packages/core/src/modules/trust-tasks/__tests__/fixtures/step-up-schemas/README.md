# Vendored `auth/step-up/approve-response` payload schemas

Copied from the Trust Tasks specification registry, then formatted by prettier
(the documents are unchanged; the drift check compares them as JSON, so they
need no `.prettierignore` entry, a root file the release tier reads as a store
build). Test fixtures:
`../../stepUpResponse07.test.ts` holds the two to the same shape, so the
answer this phone sends, checked against the packaged 0.6 schema
(`stepUp.test.ts`), is one a 0.7 relying party takes too.

## Attribution

Required by the licence (see `../pcs-schemas/README.md` for the OWFa 1.0 terms,
which apply identically here).

|                   |                                                                       |
| ----------------- | --------------------------------------------------------------------- |
| **Specification** | Trust Tasks — `auth/step-up/approve-response` **0.6** and **0.7**     |
| **Source**        | https://github.com/trustoverip/dtgwg-trust-tasks-tf                   |
| **Commit**        | `a91f2e76414dcbf2821956b6c5530497a3a43ca7` (also in `PROVENANCE.sha`) |
| **Copied**        | 2026-10-30                                                            |

| File here                                  | Path in the registry                                          |
| ------------------------------------------ | ------------------------------------------------------------- |
| `approve-response-0.6.payload.schema.json` | `specs/auth/step-up/approve-response/0.6/payload.schema.json` |
| `approve-response-0.7.payload.schema.json` | `specs/auth/step-up/approve-response/0.7/payload.schema.json` |

**These are off the shared pin** (`scripts/openvtc/PINS.json`, `dtgwg-trust-tasks-tf`
at `7b6bb488`), on purpose: 0.7 was added at `a91f2e76` (#983, 2026-10-30), and
vta-service from 84ed3250 (v0.68.0) answers step-ups only at 0.7. The packaged
`@openvtc/trust-tasks` this repo locks (0.27.8) stops at 0.6.

## Why both versions

0.7 changes no member: it lets a passkey assertion stand without a proof (the
WebAuthn path), which this phone never takes. Every answer here is `didSigned`
with the approver's own proof, as 0.6 requires and 0.7 still accepts. The test
strips descriptions and the `#response` type name and holds the rest equal, so
any later change of shape between the two shows up as a failing test, not as
a refusal on a 0.68 agent.
