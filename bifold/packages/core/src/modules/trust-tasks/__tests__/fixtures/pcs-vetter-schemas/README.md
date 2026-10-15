# Vendored Trust Task payload schemas — the vetter's `vta/pcs/*`

Copied verbatim from the Trust Tasks registry. Test fixtures:
`../../pcsVetterTasks.test.ts` validates the payloads `module/pcsVetterTasks.ts`
builds against them.

Why it matters here more than usual: the types in that module are **mirrored by
hand**, because the generated ones ship in `@openvtc/trust-tasks` 0.26.1 and
this repository is pinned at 0.9.0 behind the Cypress lock. A hand-mirrored
type that nothing grades is a guess with a type annotation on it — and these
schemas caught three of mine on the first run: `root-accept`'s and
`tokens/accept`'s responses are declared and closed rather than opaque, and
`tokens/abandon`'s `draw` is a `{label, tick}` object rather than an id.

## Attribution

Required by the licence — see `../pcs-schemas/README.md` for the OWFa 1.0 terms,
which apply identically.

|                   |                                                                       |
| ----------------- | --------------------------------------------------------------------- |
| **Specification** | Trust Tasks — `vta/pcs/*` (the vetter's seven) **0.1**                 |
| **Source**        | https://github.com/trustoverip/dtgwg-trust-tasks-tf                   |
| **Commit**        | `15b91d1f5ce15ead321636ab27e6e433c9d45796` (also in `PROVENANCE.sha`) |
| **Copied**        | 2026-10-15                                                             |
| **Pin status**    | **Off-pin by design**, as the applicant's five are                     |

The `vta/pcs/*` specs do not exist at the shared pin (`7b6bb488`); they first
appear at the commit above. The shared pin was deliberately not moved, because
it feeds spec-watch and conformance for everything else — see
`../pcs-schemas/README.md` for the full reasoning.

`vta-shared-pcs-engine.schema.json`, `vetting-shared-hidden-vetting.schema.json`
and `framework-0.2.schema.json` are the same files as next door, copied again so
this directory stands on its own and its drift check is self-contained.
