# DRAFT: the `hcp/entries/get`, `withdraw` and `revise` schemas, from upstream `main`, not yet published to the registry

**Draft 0.1 specifications, merged but not yet published.** From the `main` branch of
trustoverip/dtgwg-trust-tasks-tf at the commit in `SUITE_COMMIT.sha` (`4e2dd42fae13452fe30f0e077f359110bb2ad414`,
the merge of [#1380](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/1380), fetched 2026-11-27): the same
pin as the `hcp/*` schemas in `../../../../__tests__/fixtures/hcp-suite-4e2dd42fa/`. Nothing checked against these
is proven against a real service yet.

They are here for the C10 seam's tests (`../../`): every payload `hcpManagementCall` sends for these three tasks is
checked against them. The backlog brief had part 1 vendor them in that folder; part 1's vendoring was not done, so
they are vendored here, as the "Answers on" part did for `directives/set`. Only the three payload files are copied:
the shared files they name (`_shared/0.1/common`, `context-entry`, `disclosure`, `entry-write`) are read from that
folder, and `_shared/0.1/directive` (named by `entries/get`'s response) from
`../../../answersOn/__tests__/fixtures/hcp-suite-4e2dd42fa/`, both at this commit. When the suite changes, re-fetch
every folder at the new commit.

**Layout kept**, as in that folder: the files sit at the suite's own paths under `specs/`, and the test adds each
payload schema under the URL of its file, so its relative `$ref`s resolve to the shared `$id`s.

**Formatted.** Left to prettier: the files are JSON-equal to the source, not byte-equal.

| File here                                            | Source (`main` at `4e2dd42fa`, merged as #1380)      |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `specs/hcp/entries/get/0.1/payload.schema.json`      | `specs/hcp/entries/get/0.1/payload.schema.json`      |
| `specs/hcp/entries/withdraw/0.1/payload.schema.json` | `specs/hcp/entries/withdraw/0.1/payload.schema.json` |
| `specs/hcp/entries/revise/0.1/payload.schema.json`   | `specs/hcp/entries/revise/0.1/payload.schema.json`   |

## Licence

The registry is published under the **Open Web Foundation Final Specification Agreement 1.0 (OWFa 1.0)**
(`LICENSE.md` at the commit above), whose §2.1 grants a perpetual, worldwide, royalty-free copyright licence to
reproduce and distribute the Specification, and whose §2.2 makes attribution a condition of that grant.

**Attribution:** Trust Tasks specifications, `hcp/entries/get` **0.1**, `hcp/entries/withdraw` **0.1** and
`hcp/entries/revise` **0.1** (carrying the Human Context Protocol 2.0-draft-3), from
https://github.com/trustoverip/dtgwg-trust-tasks-tf at commit `4e2dd42fae13452fe30f0e077f359110bb2ad414`. Keep this
with the files, and update the versions if a schema is re-vendored from another version.
