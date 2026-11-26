# Vendored Trust Task payload schemas — `vetting/attestation`, `vetting/request`

These JSON Schema files are **copied verbatim** from the Trust Tasks
specification registry. They are test fixtures: `../../hiddenAttestation.test.ts`
validates the hidden-vetting request the wallet sends and the attestation shape
it reads against them, through `../vtcJoinSchemas.ts` (`vendoredValidatorIn`).

## Attribution

|                   |                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Specification** | Trust Tasks specifications — `vetting/attestation` **0.1**, `vetting/request` **0.1**, `vetting/_shared` **0.1**, framework **0.2** and **0.3**                         |
| **Source**        | https://github.com/trustoverip/dtgwg-trust-tasks-tf                                                                                                                     |
| **Commit**        | `15b91d1f5ce15ead321636ab27e6e433c9d45796` (also in `PROVENANCE.sha`)                                                                                                   |
| **Copied**        | 2026-10-15                                                                                                                                                              |
| **Pin status**    | **Off the shared pin**, as `../pcs-schemas/` is: `vetting/_shared/0.1/hidden-vetting.schema.json` first appears at this commit, and the attestation schema refers to it |

| File here                                   | Path in the registry                                   |
| ------------------------------------------- | ------------------------------------------------------ |
| `vetting-attestation.payload.schema.json`   | `specs/vetting/attestation/0.1/payload.schema.json`    |
| `vetting-request.payload.schema.json`       | `specs/vetting/request/0.1/payload.schema.json`        |
| `vetting-shared-hidden-vetting.schema.json` | `specs/vetting/_shared/0.1/hidden-vetting.schema.json` |
| `vetting-shared-vetting.schema.json`        | `specs/vetting/_shared/0.1/vetting.schema.json`        |
| `framework-0.2.schema.json`                 | `specs/_framework/0.2/framework.schema.json`           |
| `framework-0.3.schema.json`                 | `specs/_framework/0.3/framework.schema.json`           |

The schemas are **never edited**: the drift test in `hiddenAttestation.test.ts`
compares them byte for byte with the commit `PROVENANCE.sha` names wherever
`external/dtgwg-trust-tasks-tf` is checked out (or `TRUST_TASKS_REGISTRY`
points at a clone). The hidden-vetting `ext` a request carries is not in the
request schema: it rides in the framework's `ext`, as openvtc sends it.

## Licence

The registry is published under the **Open Web Foundation Final Specification
Agreement 1.0 (OWFa 1.0)** (`LICENSE.md` at the commit above). §2.1 grants a
royalty-free copyright licence to reproduce the Specification; §2.2 makes
attribution, including the Specification name and version number, a condition
of that grant. The table above is that attribution: keep it with the files, and
update the versions if a schema is re-vendored.
