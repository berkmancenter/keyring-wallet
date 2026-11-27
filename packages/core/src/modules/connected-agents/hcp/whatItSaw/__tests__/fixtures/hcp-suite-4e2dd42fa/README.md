# `hcp/audit/read` schemas from upstream `main`, not yet published to the registry

**These are draft 0.1 specifications, merged but not yet published.** They come from the `main` branch of
trustoverip/dtgwg-trust-tasks-tf, at the commit in `SUITE_COMMIT.sha` (`4e2dd42fae13452fe30f0e077f359110bb2ad414`,
fetched 2026-11-27): the merge of
[#1380](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/1380), the same commit as the HCP suite track C
vendored in `../../../../__tests__/fixtures/hcp-suite-4e2dd42fa/`. Nothing checked against these is proven against
a real service yet.

**Why here.** The backlog brief (section B part 1.2) had part 1 vendor these into track C's folder for parts 3 to 5;
that folder does not hold them, and it is part 1's file, which part 3 may not write. So part 3 vendors the two
files it needs into its own test folder. Every other schema the audit read references (`common.schema.json`) and
the `disclosures/summary` schema are read from track C's folder, unchanged. When track C's folder gains these
files, this folder can go.

They are here for `../whatItSawSchemas.ts`: every payload `readHcpAudit` sends and every answer a fake VTA gives in
the tests is checked against them.

**Layout kept.** The files sit at the suite's own paths under `specs/`, so each relative `$ref` names a file here
or in track C's folder; `../whatItSawSchemas.ts` resolves them as track C's `hcpSchemas.ts` does.

**Formatted.** The folder is left to prettier: the files are JSON-equal to the source, not byte-equal.

| File here                                       | Source (`main` at `4e2dd42fa`, merged as #1380) |
| ----------------------------------------------- | ----------------------------------------------- |
| `specs/hcp/audit/read/0.1/payload.schema.json`  | `specs/hcp/audit/read/0.1/payload.schema.json`  |
| `specs/hcp/_shared/0.1/audit-event.schema.json` | `specs/hcp/_shared/0.1/audit-event.schema.json` |

## Licence

The registry is published under the **Open Web Foundation Final Specification Agreement 1.0 (OWFa 1.0)**
(`LICENSE.md` at the commit above). §2.1 grants a perpetual, worldwide, royalty-free copyright licence to
_"reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, distribute, and implement
the Specification"_, which covers copying these files here.

§2.2 makes attribution **a condition of that grant**: _"you must include an attribution to the Specification in any
derivative work you make based on the Specification. That attribution must include, at minimum, the Specification
name and version number."_

**Attribution:** Trust Tasks specifications, `hcp/audit/read` **0.1** and `hcp/_shared` **0.1** (carrying the Human
Context Protocol 2.0-draft-3), from https://github.com/trustoverip/dtgwg-trust-tasks-tf at commit
`4e2dd42fae13452fe30f0e077f359110bb2ad414`. Keep this with the files, and update the versions if a schema is
re-vendored from another version.
