# DRAFT: the `hcp/directives/set` schemas, from upstream `main`, not yet published to the registry

**Draft 0.1 specifications, merged but not yet published.** From the `main` branch of
trustoverip/dtgwg-trust-tasks-tf at the commit in `SUITE_COMMIT.sha` (`4e2dd42fae13452fe30f0e077f359110bb2ad414`,
the merge of [#1380](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/1380), fetched 2026-11-27): the same
pin as the `hcp/*` schemas in `../../../../__tests__/fixtures/hcp-suite-4e2dd42fa/`. Nothing checked against these
is proven against a real service yet.

They are here for the "Answers on" tests (`../../`): every `directives/set` payload Keyring builds, and every answer
a fake VTA gives, is checked against these. Only the two files that folder does not hold are copied here; the third
the payload needs, `specs/hcp/_shared/0.1/common.schema.json`, is read from that folder (JSON-equal to the source at
this commit, checked when these were vendored). When the suite changes, re-fetch both folders at the new commit.

**Layout kept**, as in that folder: the files sit at the suite's own paths under `specs/`, and the test adds the
payload schema under the URL of its file, so its relative `$ref`s resolve to the shared `$id`s.

**Formatted.** Left to prettier: the files are JSON-equal to the source, not byte-equal.

| File here                                          | Source (`main` at `4e2dd42fa`, merged as #1380)    |
| -------------------------------------------------- | -------------------------------------------------- |
| `specs/hcp/directives/set/0.1/payload.schema.json` | `specs/hcp/directives/set/0.1/payload.schema.json` |
| `specs/hcp/_shared/0.1/directive.schema.json`      | `specs/hcp/_shared/0.1/directive.schema.json`      |

## Licence

The registry is published under the **Open Web Foundation Final Specification Agreement 1.0 (OWFa 1.0)**
(`LICENSE.md` at the commit above), whose §2.1 grants a perpetual, worldwide, royalty-free copyright licence to
reproduce and distribute the Specification, and whose §2.2 makes attribution a condition of that grant.

**Attribution:** Trust Tasks specifications, `hcp/directives/set` **0.1** and `hcp/_shared` **0.1** (carrying the
Human Context Protocol 2.0-draft-3), from https://github.com/trustoverip/dtgwg-trust-tasks-tf at commit
`4e2dd42fae13452fe30f0e077f359110bb2ad414`. Keep this with the files, and update the versions if a schema is
re-vendored from another version.
