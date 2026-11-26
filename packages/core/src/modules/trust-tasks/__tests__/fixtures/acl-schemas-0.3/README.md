# Vendored `acl` 0.3, `acl/list` 0.4 and `device/list` 0.3 and 0.2 schemas

Copied verbatim from the Trust Tasks specification registry, for
`../../agentAccess.test.ts`: every payload agent connect's access-list writes and
device listings send (docs/plans/agent-connect-plan.md, step 7.4) is validated
against the registry's own schema, so a test cannot quietly accept a shape the
VTA would refuse. Not reformatted (`packages/.prettierignore`).

## Attribution

Required by the licence (see `../pcs-schemas/README.md` for the OWFa 1.0 terms,
which apply identically here).

|                   |                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------ |
| **Specification** | Trust Tasks: `acl` 0.3, `acl/list` 0.4, `device/list` 0.3 and 0.2, and what they reference |
| **Source**        | https://github.com/trustoverip/dtgwg-trust-tasks-tf                                        |
| **Commit**        | `2a66a035104700fb5ddb1623ba5062b565f3b080` (also in `PROVENANCE.sha`)                      |
| **Copied**        | 2026-11-25                                                                                 |

These are at the shared pin (`scripts/openvtc/PINS.json`, `dtgwg-trust-tasks-tf`
at `2a66a0351`).

| File here                             | Path in the registry                                  |
| ------------------------------------- | ----------------------------------------------------- |
| `acl-entry-0.3.schema.json`           | `specs/acl/_shared/0.3/acl-entry.schema.json`         |
| `acl-grant-0.3.payload.schema.json`   | `specs/acl/grant/0.3/payload.schema.json`             |
| `acl-update-0.3.payload.schema.json`  | `specs/acl/update/0.3/payload.schema.json`            |
| `acl-revoke-0.3.payload.schema.json`  | `specs/acl/revoke/0.3/payload.schema.json`            |
| `device-list-0.3.payload.schema.json` | `specs/device/list/0.3/payload.schema.json`           |
| `device-list-0.2.payload.schema.json` | `specs/device/list/0.2/payload.schema.json`           |
| `acl-list-0.4.payload.schema.json`    | `specs/acl/list/0.4/payload.schema.json`              |
| `device-binding-0.2.schema.json`      | `specs/device/_shared/0.2/device-binding.schema.json` |
| `framework-0.4.schema.json`           | `specs/_framework/0.4/framework.schema.json`          |
| `framework-0.2.schema.json`           | `specs/_framework/0.2/framework.schema.json`          |

The schemas' `$ref`s are relative paths; the test registers each schema under the
URL its referrers resolve it to.
