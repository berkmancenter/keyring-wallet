# VTI's `task-consent/request/0.1` schema bundle

`0.1.bundle.json` is `vti-specs-core/trust-tasks/task-consent/request/0.1.bundle.json` from
[OpenVTC/verifiable-trust-infrastructure](https://github.com/OpenVTC/verifiable-trust-infrastructure) at the commit
in `PROVENANCE.sha` (`97fda98130047ca8ff4c0af1b60116d558968d2a`, tagged `vta-service-v0.84.0`). It is the schema
the VTA builds its consent requests against.

It is here for `../../rungConsent.test.ts`, which validates the reference rung's HCP consent request
(`tsp-reference/ref-25-agent-pairing/fixtures/hcp-consent-request.json`) against the bundle's `schema` member. The
bundle's `schema` is self-contained (its `$ref`s are to its own `$defs`), so nothing else is vendored.

When the VTA Keyring is pinned to moves to another version, re-fetch the file at the new commit, record it in
`PROVENANCE.sha` and rename this folder.

**Formatted.** The folder is left to prettier, as the `hcp-suite-*` folder beside it is: the file is JSON-equal to the
source, not necessarily byte-equal.

## Licence

VTI is published under the **Apache License, Version 2.0** (`LICENSE` at the commit above), which permits
reproducing and redistributing the file with this notice of its source.
