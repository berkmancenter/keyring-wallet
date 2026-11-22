# Vendored Trust Task payload schemas — `vtc/vetting/pcs-challenge`, `vtc/join-requests/submit/0.3`

These JSON Schema files are **copied verbatim** from the Trust Tasks
specification registry. They are test fixtures: `../../pcsChallenge.test.ts`
and `../../hiddenVettingSubmit.test.ts` validate the payloads the wallet builds
(and the challenge answer it reads) against them through `../vtcJoinSchemas.ts`,
so that upstream's own schemas grade our shapes rather than our reading of them.

## Attribution

|                   |                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Specification** | Trust Tasks specifications — `vtc/vetting/pcs-challenge` **0.1**, `vtc/join-requests/submit` **0.3**, `vtc/_shared` **0.1**, framework **0.2** and **0.3** |
| **Source**        | https://github.com/trustoverip/dtgwg-trust-tasks-tf                                                                                                        |
| **Commit**        | `7b6bb488ffd838bef058310c909207d4a7b77125` (also in `PROVENANCE.sha`)                                                                                      |
| **Copied**        | 2026-10-15                                                                                                                                                 |
| **Pin status**    | **On the shared pin** (`scripts/openvtc/PINS.json`), unlike `../pcs-schemas/`, whose specs postdate it                                                     |

| File here                                          | Path in the registry                                      |
| -------------------------------------------------- | --------------------------------------------------------- |
| `vtc-vetting-pcs-challenge.payload.schema.json`    | `specs/vtc/vetting/pcs-challenge/0.1/payload.schema.json` |
| `vtc-join-requests-submit-0.3.payload.schema.json` | `specs/vtc/join-requests/submit/0.3/payload.schema.json`  |
| `vtc-shared-ceremony.schema.json`                  | `specs/vtc/_shared/0.1/ceremony.schema.json`              |
| `framework-0.2.schema.json`                        | `specs/_framework/0.2/framework.schema.json`              |
| `framework-0.3.schema.json`                        | `specs/_framework/0.3/framework.schema.json`              |

The challenge's response schema is the `$defs/Response` (anchor `response`)
inside its payload schema; the helper compiles it by that anchor. As in
`../pcs-schemas/`, each file is registered under its own `$id` and under the URL
its siblings' relative `$ref`s actually resolve to, written out in
`../vtcJoinSchemas.ts`. The schemas themselves are **never edited**: the drift
test in `pcsChallenge.test.ts` compares them byte for byte with the commit
`PROVENANCE.sha` names wherever `external/dtgwg-trust-tasks-tf` is checked out
(or `TRUST_TASKS_REGISTRY` points at a clone).

## Licence

The registry is published under the **Open Web Foundation Final Specification
Agreement 1.0 (OWFa 1.0)** (`LICENSE.md` at the commit above). §2.1 grants a
royalty-free copyright licence to reproduce the Specification; §2.2 makes
attribution, including the Specification name and version number, a condition
of that grant. The table above is that attribution: keep it with the files, and
update the versions if a schema is re-vendored.
