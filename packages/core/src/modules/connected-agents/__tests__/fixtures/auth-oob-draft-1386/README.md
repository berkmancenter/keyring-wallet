# DRAFT: `auth/oob` `deviceEnrol` schemas from an open upstream pull request

**These are a draft's, not a specification's.** They come from
[trustoverip/dtgwg-trust-tasks-tf #1386](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/1386),
an open pull request (Keyring's ask, ledger AC-36), at the commit in
`DRAFT_COMMIT.sha` (`ceda53bca5c0ba3ca5d18c65b7e727b0a750dc49`, fetched 2026-11-26). No VTA
serves `auth/oob` today (step 7.1: `unsupportedType` on VTA 0.79.0, 0.84.0 and
0.87.0), so nothing checked against these is proven against a real service.

They are here for `../../carriage.test.ts` and `../../deviceEnrolDraft.test.ts`:
step 7.5's `deviceEnrol` path runs against a fake service (docs/plans/agent-connect-plan.md
§7.5), and every request Keyring builds and every answer the fake gives is checked
against these. When the draft changes, re-fetch every file here at the new head,
record it in `DRAFT_COMMIT.sha`, and update `../../deviceEnrolDraft.ts`, the one
seam file.

**Not drift-checked.** `expectNoDrift` reads commits from the registry clone at the
pin, which does not hold a pull request's head.

**Formatted.** The folder is left to prettier, not listed in
`packages/.prettierignore`: the files are JSON-equal to the source, not
byte-equal.

| File here                                    | Source                                                             |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `draft-auth-oob-_shared-0.2-oob.schema.json` | #1386: `specs/auth/oob/_shared/0.2/oob.schema.json`                |
| `draft-auth-oob-claim-0.3.schema.json`       | #1386: `specs/auth/oob/claim/0.3/payload.schema.json`              |
| `draft-auth-oob-prove-0.4.schema.json`       | #1386: `specs/auth/oob/prove/0.4/payload.schema.json`              |
| `draft-auth-oob-identify-0.2.schema.json`    | #1386: `specs/auth/oob/identify/0.2/payload.schema.json`           |
| `draft-auth-oob-grant-0.4.schema.json`       | #1386: `specs/auth/oob/grant/0.4/payload.schema.json`              |
| `draft-auth-oob-respond-0.4.schema.json`     | #1386: `specs/auth/oob/respond/0.4/payload.schema.json`            |
| `acl-entry-0.3.schema.json`                  | the pin `2a66a0351`: `specs/acl/_shared/0.3/acl-entry.schema.json` |
| `device-binding-0.2.schema.json`             | the pin: `specs/device/_shared/0.2/device-binding.schema.json`     |
| `framework-0.4.schema.json`                  | the pin: `specs/_framework/0.4/framework.schema.json`              |
| `framework-0.2.schema.json`                  | the pin: `specs/_framework/0.2/framework.schema.json`              |

Licence: as `../../../../trust-tasks/__tests__/fixtures/pcs-schemas/README.md` gives
the OWFa 1.0 terms of the registry.
