# Join 0.3 fixtures

Not written by Keyring, so the tests do not agree with themselves:

- `manifest-response-examples.json` — the response examples of
  `specs/vtc/join-requests/manifest/0.3/spec.md`, each with its section title.
  The spec states the `requirementsDigest` values printed there are the real
  ones for the criteria as printed.
- `manifest-invalid-examples.json`, `submit-invalid-examples.json`,
  `submit-payload.schema.json` — copied from
  `specs/vtc/join-requests/{manifest,submit}/0.3/`.

All from trustoverip/dtgwg-trust-tasks-tf at e675cc1b (#710), content unchanged
(only reformatted by this repo's prettier). To refresh:
copy the files again at the new commit, extract the spec's `#response` JSON
blocks again, and read every change as a finding before accepting it.

- `vtc-0.49.0-answers.json` — what a running vtc-service 0.49.0 answered: its
  manifest at 0.2, and its refusal of a manifest/0.3 request.
