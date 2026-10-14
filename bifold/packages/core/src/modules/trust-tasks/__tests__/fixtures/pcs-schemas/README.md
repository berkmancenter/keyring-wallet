# Vendored Trust Task payload schemas — `vta/pcs/*`

These JSON Schema files are **copied verbatim** from the Trust Tasks
specification registry. They are test fixtures: `../../pcsVtaPayloads.test.ts`
validates the payloads `module/pcsVtaPayloads.ts` builds against them, so that
upstream's own schemas grade our shapes rather than our reading of them.

## Attribution

Required by the licence (see below), and useful on its own terms.

| | |
|---|---|
| **Specification** | Trust Tasks specifications — `vta/pcs/*` **0.1**, `vta/_shared` **0.4**, `vetting/_shared` **0.1** |
| **Source** | https://github.com/trustoverip/dtgwg-trust-tasks-tf |
| **Commit** | `15b91d1f5ce15ead321636ab27e6e433c9d45796` (also in `PROVENANCE.sha`) |
| **Copied** | 2026-10-14 |

| File here | Path in the registry |
|---|---|
| `vta-pcs-applications-create.payload.schema.json` | `specs/vta/pcs/applications/create/0.1/payload.schema.json` |
| `vta-pcs-applications-show.payload.schema.json` | `specs/vta/pcs/applications/show/0.1/payload.schema.json` |
| `vta-pcs-applications-delete.payload.schema.json` | `specs/vta/pcs/applications/delete/0.1/payload.schema.json` |
| `vta-pcs-verify-attestation.payload.schema.json` | `specs/vta/pcs/verify-attestation/0.1/payload.schema.json` |
| `vta-pcs-prove.payload.schema.json` | `specs/vta/pcs/prove/0.1/payload.schema.json` |
| `vta-shared-pcs-engine.schema.json` | `specs/vta/_shared/0.4/pcs-engine.schema.json` |
| `vetting-shared-hidden-vetting.schema.json` | `specs/vetting/_shared/0.1/hidden-vetting.schema.json` |

The flat names exist because the registry's cross-file `$ref`s are relative
paths; the test registers each file under both its flat name and the tail its
siblings reference it by, so the schemas resolve **without being edited**. They
are byte-identical to the registry's, which is what the drift test in
`pcsVtaPayloads.test.ts` checks wherever `external/dtgwg-trust-tasks-tf` is
checked out.

## Licence

The registry is published under the **Open Web Foundation Final Specification
Agreement 1.0 (OWFa 1.0)** (`LICENSE.md` at the commit above). §2.1 grants a
perpetual, worldwide, royalty-free copyright licence to *"reproduce, prepare
derivative works of, publicly display, publicly perform, sublicense, distribute,
and implement the Specification"*, which covers copying these files here.

§2.2 makes attribution **a condition of that grant**: *"you must include an
attribution to the Specification in any derivative work you make based on the
Specification. That attribution must include, at minimum, the Specification name
and version number."* That is what the table above is for — keep it with the
files, and update the version numbers if a schema is re-vendored from a
different spec version.

## Updating these

Re-copy from the registry rather than editing in place, update the commit in
this file and in `PROVENANCE.sha`, and check the version numbers above still
describe what was copied. The drift test fails locally when the copies and the
checked-out registry disagree, which is the signal to re-copy — deliberately,
after reading what changed upstream, not as a reflex.
