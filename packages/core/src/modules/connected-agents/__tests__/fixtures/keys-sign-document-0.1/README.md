# Vendored `keys/sign-document` 0.1 schema

From the Trust Tasks specification registry, for `../../vdcSigner.test.ts`. The
request agent connect's VDC signer sends, and every answer the fake VTA gives,
is validated against the registry's own schema (docs/plans/agent-connect-plan.md,
step 7.3, measured in step 0.1(f)).

**Formatted, not verbatim.** The folder is left to prettier, not listed in
`packages/.prettierignore`, so its drift test compares the JSON, not the bytes
(`expectNoDrift` with `as: 'json'`). Both files are JSON-equal to the registry at
the commit below.

## Attribution

Required by the licence (see `../../../../trust-tasks/__tests__/fixtures/pcs-schemas/README.md`
for the OWFa 1.0 terms, which apply identically here).

|                   |                                                                           |
| ----------------- | ------------------------------------------------------------------------- |
| **Specification** | Trust Tasks: `keys/sign-document` 0.1 and the framework 0.1 it references |
| **Source**        | https://github.com/trustoverip/dtgwg-trust-tasks-tf                       |
| **Commit**        | `2a66a035104700fb5ddb1623ba5062b565f3b080` (also in `PROVENANCE.sha`)     |
| **Copied**        | 2026-11-26                                                                |

| File here                                    | Path in the registry                               |
| -------------------------------------------- | -------------------------------------------------- |
| `keys-sign-document-0.1.payload.schema.json` | `specs/keys/sign-document/0.1/payload.schema.json` |
| `framework-0.1.schema.json`                  | `specs/_framework/0.1/framework.schema.json`       |
