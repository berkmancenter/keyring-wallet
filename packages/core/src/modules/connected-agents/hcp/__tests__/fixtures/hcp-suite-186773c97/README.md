# DRAFT: `hcp/*` schemas from an open upstream pull request

**These are a draft's, not a specification's.** They come from
[trustoverip/dtgwg-trust-tasks-tf #1380](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/1380)
(`feat/hcp-suite`, the `hcp/*` suite carrying the Human Context Protocol 2.0-draft-3 as Trust Tasks), an open pull
request when step 7.27 track C was briefed, at the commit in `SUITE_COMMIT.sha`
(`186773c97d43d82d3b1cf33c9d21561d0c87af5b`, fetched 2026-11-27). The VTA side (track A) is being built to the
same commit, so nothing checked against these is proven against a real service yet.

They are here for `../../schemas.test.ts` and the part 3 tests of the HCP demo: every payload Keyring builds for
`hcp/entries/create`, `hcp/grants/revoke` and `hcp/disclosures/summary`, and every answer a fake VTA gives, is
checked against these. When the suite changes, re-fetch every file here at the new commit, record it in
`SUITE_COMMIT.sha`, rename this folder, and update the `version-pinned` constants in `../../../types.ts`.

**Not drift-checked.** `expectNoDrift` reads commits from the registry clone at the pin, which does not hold a pull
request's head.

**Layout kept.** The files sit at the suite's own paths under `specs/`, so each relative `$ref` names a file here.
A payload's `$id` is its directory (`https://trusttasks.org/spec/hcp/grants/revoke/0.1`), not its file, so its
`../../../_shared/0.1/…` resolves against that `$id` one level too high (`spec/_shared/…`), while the shared files'
`$id`s are under `spec/hcp/_shared/`. `../../schemas.test.ts` adds each shared file under its own `$id`, and each
payload schema under the URL of its file (`…/hcp/grants/revoke/0.1/payload.schema.json`), against which its `$ref`s
resolve to those `$id`s: the registry's `$id`s not matching its paths is handled the same way in
`../../../../__tests__/memories.test.ts`.

**Formatted.** The folder is left to prettier, not listed in `packages/.prettierignore`: the files are JSON-equal to
the source, not byte-equal.

| File here                                               | Source (#1380 at `186773c97`)                           |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `specs/hcp/entries/create/0.1/payload.schema.json`      | `specs/hcp/entries/create/0.1/payload.schema.json`      |
| `specs/hcp/grants/revoke/0.1/payload.schema.json`       | `specs/hcp/grants/revoke/0.1/payload.schema.json`       |
| `specs/hcp/disclosures/summary/0.1/payload.schema.json` | `specs/hcp/disclosures/summary/0.1/payload.schema.json` |
| `specs/hcp/_shared/0.1/common.schema.json`              | `specs/hcp/_shared/0.1/common.schema.json`              |
| `specs/hcp/_shared/0.1/context-entry.schema.json`       | `specs/hcp/_shared/0.1/context-entry.schema.json`       |
| `specs/hcp/_shared/0.1/disclosure.schema.json`          | `specs/hcp/_shared/0.1/disclosure.schema.json`          |
| `specs/hcp/_shared/0.1/entry-write.schema.json`         | `specs/hcp/_shared/0.1/entry-write.schema.json`         |
| `specs/hcp/_shared/0.1/grant.schema.json`               | `specs/hcp/_shared/0.1/grant.schema.json`               |

The three payload schemas reference only these five shared files, and the shared files reference only each other.

## Licence

The registry is published under the **Open Web Foundation Final Specification Agreement 1.0 (OWFa 1.0)**
(`LICENSE.md` at the commit above). §2.1 grants a perpetual, worldwide, royalty-free copyright licence to
_"reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, distribute, and implement
the Specification"_, which covers copying these files here.

§2.2 makes attribution **a condition of that grant**: _"you must include an attribution to the Specification in any
derivative work you make based on the Specification. That attribution must include, at minimum, the Specification
name and version number."_

**Attribution:** Trust Tasks specifications, `hcp/entries/create` **0.1**, `hcp/grants/revoke` **0.1**,
`hcp/disclosures/summary` **0.1** and `hcp/_shared` **0.1** (carrying the Human Context Protocol 2.0-draft-3), from
https://github.com/trustoverip/dtgwg-trust-tasks-tf at commit `186773c97d43d82d3b1cf33c9d21561d0c87af5b`. Keep this
with the files, and update the versions if a schema is re-vendored from another version.
