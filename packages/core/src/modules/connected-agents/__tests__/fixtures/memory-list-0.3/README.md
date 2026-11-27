# Vendored `vta/memory/list` 0.3 schemas

From the Trust Tasks specification registry, for `../../memories.test.ts`. Every request agent connect's memory count
sends, and every answer the fake VTA gives, is validated against the registry's own schemas
(docs/plans/agent-connect-plan.md §3.15, step 7.7).

**Formatted, not verbatim.** The folder is left to prettier, not listed in `packages/.prettierignore`, so its drift test
compares the JSON, not the bytes (`expectNoDrift` with `as: 'json'`). All five files are JSON-equal to the registry at
the commit below.

## Attribution

Required by the licence (see `../../../../trust-tasks/__tests__/fixtures/pcs-schemas/README.md` for the OWFa 1.0
terms, which apply identically here).

|                   |                                                                       |
| ----------------- | --------------------------------------------------------------------- |
| **Specification** | Trust Tasks: `vta/memory/list` 0.3 and the schemas it references      |
| **Source**        | https://github.com/trustoverip/dtgwg-trust-tasks-tf                   |
| **Commit**        | `2a66a035104700fb5ddb1623ba5062b565f3b080` (also in `PROVENANCE.sha`) |
| **Copied**        | 2026-11-26                                                            |

| File here                                 | Path in the registry                              |
| ----------------------------------------- | ------------------------------------------------- |
| `vta-memory-list-0.3.payload.schema.json` | `specs/vta/memory/list/0.3/payload.schema.json`   |
| `memory-record-0.1.schema.json`           | `specs/vta/_shared/0.1/memory-record.schema.json` |
| `acl-entry-0.3.schema.json`               | `specs/acl/_shared/0.3/acl-entry.schema.json`     |
| `framework-0.2.schema.json`               | `specs/_framework/0.2/framework.schema.json`      |
| `framework-0.4.schema.json`               | `specs/_framework/0.4/framework.schema.json`      |
