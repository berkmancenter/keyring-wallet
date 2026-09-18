# ref-07f-predicate-registry

[cred-spec #52](https://github.com/trustoverip/dtgwg-cred-spec/issues/52) proposes
that DTG predicates live in a repo-driven registry, and that the registry
generates an `accept-list.json` verifiers import at configuration time. This rung
builds that registry from #52's own worked entries and runs a verifier configured
from it against **Keyring's real credentials, through Keyring's real code**, to
answer one question: *does the format carry what a verifier needs?*

```sh
npm install && node run.mjs
```

No network. No signatures — this is the vocabulary layer, not the proof layer.

## What is real here

| Input | Source |
|---|---|
| `registry/predicates/witnessed.jsonld`, `presented.jsonld` | The two worked entries in #52, extracted verbatim from the issue body (fetched 2026-09-14, body sha256 `38f6f37b369fffcf`) |
| `registry/example-accept-list-from-issue-52.json` | #52's example accept-list entry, verbatim |
| Predicate handling and profile rules | PR #47 @ `bc1fd88` |
| `credentialTypes.ts`, `witnessedExchangeContext.ts` | **Keyring source**, bifold @ `7dc1de2a`, transpiled and executed as-is (`keyring-source.mjs`) — no copy, no build |
| `../ref-07-dtg-edge-semantics/fixtures/edge-witnessed-captured.json` | A real two-party witnessed exchange captured from Keyring's Credo agents |
| `fixtures/vwc-production-builder.json` | A VWC produced by Keyring's shipped `buildWitnessCredentialJson` plus the witness server's binding lines (from `ref-07b`, commit `b8dd46c`). Act 0 guards that the source still produces this shape |

**Authored by this rung, because #52 names them but does not publish them:**
`registry/meta/predicate.schema.json` (transcribed from #47's nine profile points)
and `registry/schemas/witness-context.schema.json` (transcribed from #47's
`dtg:witnessed` profile). Each carries a `$comment` saying so.

## What it proves

**Act 0 — the shapes are current.** Keyring's witness server still binds
`taskContext`, still adds `parties` and `taskDigestMultibase`, and `witnessContext`
still carries `hardwareAttestationIncluded` and `localityVerification`. The
production fixture's digest reproduces over a real captured VRC.

**Act 1 — the registry builds.** Both worked entries are complete against the
definition format. The generated accept-list holds `witnessed` (active) and not
`presented` (proposed). The generated entry carries the `witnessContext` schema
URL; #52's own example entry omits it, although its *Generated outputs* table says
schema URLs are included.

**Act 2 — Keyring as shipped.** Both real VWCs are rejected at step 1 (no
predicate) and routed today by Keyring's type-string dispatch. Expected: they
predate #47.

**Act 3 — Keyring in #47's shape.** The production VWC, re-expressed mechanically,
is **accepted**. The legacy captured VWC is rejected for missing `taskContext` — a
real Keyring self-finding (the `vrc-reference` demo path predates Trust Task Context
Binding). With the type string gone, Keyring's real `isWitnessCredential()` stops
recognising the credential and `isPeerVrcCredential()` claims it, so today's wallet
would file it under Contacts. Dispatching on the accept-list routes it correctly:
**for a wallet, the accept-list is the dispatch table**, not only an allowlist.

**Act 4 — what a generic verifier can enforce.** Unknown predicate, proposed
predicate, missing `taskContext`, wrong object kind and a mistyped `witnessContext`
member are all rejected from the accept-list alone. Keyring's undefined top-level
members (`parties`, `taskDigestMultibase`) are ignored, per #47 profile item 5. A
CURIE (`dtg:witnessed`) passes step 1 — it is syntactically an absolute IRI — and
only falls at step 2.

The unpublished `witness-context.schema.json` turns out to matter. Under the
**open** reading Keyring's `hardwareAttestationIncluded` and `localityVerification`
are accepted; under the **closed** reading the same credential is rejected. #47 item
5 covers undefined `credentialSubject` members, not members nested inside a defined
one, so whether that evidence is conformant rests on a schema not yet written.

**Act 5 — what it cannot enforce.** A statement naming the wrong subject passes
every generic check, because `subjectObjectRelationship` is free text. The two
worked entries use exactly two relations — the subject is the referenced
credential's *issuer* (`witnessed`) or its *subject* (`presented`). Given a named
value, the check becomes mechanical: Keyring's real statement passes, the wrong
subject is caught, and both VWCs of Keyring's real two-party exchange satisfy
`subjectIsReferencedIssuer`. `minimumIssuerScope` cannot be evaluated at all: no
credential property carries a declared scope until #46 names one.

**Act 6 — deprecation.** When a later release deprecates `witnessed`, an accept-list
of active IRIs rejects the statement Keyring already issued. #52 keeps deprecated
terms "forever" but puts only active IRIs in the accept-list, so as written,
deprecation retroactively invalidates every credential issued under the term. An
accept-list that keeps deprecated entries, marked, does not.

**Act 7 — no network at verification.** Configured once, four verifications, zero
requests: the format supports #47's "resolve at configuration time, never at
verification time".

## What it does NOT prove

- **Nothing about signatures or proof suites.** Credentials are unsigned; the
  re-expressed statements keep Keyring's `@context` array untouched, and no JSON-LD
  processing happens.
- **Not the registry's real schemas.** Both schemas are this rung's transcriptions
  of #47. When #52 publishes its own, re-run against them.
- **Not a wire-compatible Keyring change.** Act 3's re-expression is mechanical and
  in-memory; Keyring does not emit statement credentials.
- **The predicate IRIs are #52's placeholders** under `https://trustoverip.org/dtg/vocab#`;
  #48 is undecided. Nothing here depends on the host.
- **The named relations in Act 5 are a proposal**, not in #47 or #52.
- **The legacy fixture's `taskContext` gap** is the known `vrc-reference` drift, not a
  production defect — Act 0 shows the production witness binds it.

Pinned against: cred-spec #52 body as fetched 2026-09-14, PR #47 @ `bc1fd88`,
bifold @ `7dc1de2a`.
