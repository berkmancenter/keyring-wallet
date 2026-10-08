# Investigation — does the v1-context-force bug exist in `animo/pex-ts`?

*Companion to [`PR-CANDIDATE.md`](./PR-CANDIDATE.md) in this directory, which
targets `animo/PEX` (the real upstream continuity of the installed
`@animo-id/pex@6.1.1`). This file covers the other repo checked,
`animo/pex-ts` / `@animo-id/dif-pex`, and why it does **not** get a PR.*

## Repo identity, established by evidence, not by name

Three repos were in play; `git ls-remote --tags` against each resolved which
one actually corresponds to the installed `6.1.1`:

- `Sphereon-Opensource/pex` — `isArchived: false`, `pushedAt: 2024-12-16`.
  Tags stop at `v4.1.0`. No `v6.1.1` tag.
- `animo/pex-ts` — `isArchived: false`, `pushedAt: 2026-08-27`. **No tags at
  all.** `git clone --depth 1` shows a single commit, `4552ad4` "feat:
  initial implementation" — a from-scratch rewrite, not a continuation of
  either PEX repo's history.
- `animo/PEX` (a fork of `Sphereon-Opensource/pex`, found via
  `gh api /repos/Sphereon-Opensource/pex/forks`) — has tag `v6.1.1` at
  `4651d8c6211451008302a8c4413fbeeeb35eca07`, which is exactly `main`'s
  current `HEAD`. Continuous history from the fork point through every
  `4.1.1`–`6.1.1` release. This is the real upstream for the installed
  package (see `PR-CANDIDATE.md`).

`animo/pex-ts` publishes a **different package**, `@animo-id/dif-pex`, at
version `0.1.0`. Its own `parity/package.json` description says: "Temporary
harness diffing `@animo-id/dif-pex` against the deprecated `@animo-id/pex`.
Delete once the migration lands." So `pex-ts` is not upstream continuity for
`@animo-id/pex` at all — it is a planned *replacement*, under new naming,
not yet at feature parity (see its own `parity/PARITY.md`, which documents
known behavioural divergences and 18 of 28 corpus definitions with only
"vacuous" test coverage).

## Structural read of `dif-pex/src` — conclusion (a)/(b)/(c): **neither, definitively**

The task was to determine whether the force-v1 bug is (a) already fixed as
a side effect of the rewrite, (b) present under different names, or (c)
inconclusive. The actual answer is more specific than any of the three: the
codepath that contains the bug **does not exist in this library at all**,
by deliberate design choice, not by fix or oversight.

Evidence, from reading the source (not grepping for the literal string):

- `dif-pex/src/index.ts` re-exports eight modules:
  `filter`, `json-path`, `pex-credential`, `pex-error`, `pex-parser`,
  `pex-query-result`, `presentation-definition`, `presentation-submission`.
  None of them builds a `VerifiablePresentation` object.
- `dif-pex/src/presentation-submission/create-presentation-submission.ts` —
  the closest thing to `constructPresentations()` — builds only the
  `PresentationSubmission` descriptor map (`{ id, definition_id,
  descriptor_map }`). Its docstring: "This is a pure function of its
  inputs. Which credential satisfies which input descriptor is the
  caller's decision — run the query first, then pass the choices here."
  There is no `@context`, no `type`, no `holder` field anywhere in its
  output type or logic.
- `dif-pex/README.md`: "A lean TypeScript implementation of DIF
  Presentation Exchange v1 and v2… no credential parsing… you pass
  already-decoded claims." The library's stated scope is parsing
  definitions and matching/filtering credentials against them — not
  constructing or signing presentations.
- `parity/PARITY.md` §"What is compared": "Result *structures* differ by
  design (see `PLAN.md` §7)… the harness compares a projection both
  implementations can express: which input descriptors were satisfied, by
  which credentials." I.e. even the parity harness the Animo team built to
  compare old-vs-new explicitly does not compare VP-shell construction,
  because the new library doesn't produce one.
- A literal grep for the hardcoded string
  `https://www.w3.org/2018/credentials/v1` across `dif-pex/src` (excluding
  tests) returns **zero matches** in source files — consistent with the
  structural finding above, not just an artifact of renamed variables.

So: the responsibility of building the wrapping `VerifiablePresentation`
(`@context`/`type`/`holder`) — the thing `constructPresentations()` does in
the old package, and where the bug lives — has been moved **out of this
library's scope** as part of the rewrite. It isn't fixed; it isn't hiding
under a new name; it simply isn't this library's job anymore. Presumably
that responsibility now falls to whatever caller replaces credo-ts's usage
once/if `@animo-id/dif-pex` is adopted — which is not yet the case
anywhere in Keyring's dependency tree (credo-ts still pins the old
`@animo-id/pex@^6.1.1`, confirmed in `parity/package.json`'s own
description).

## What would need to happen for this to become a PR here

Nothing to fix today — there's no incorrect code to point at. Only two
things would make this directory relevant to `pex-ts` in the future:

1. If `@animo-id/dif-pex` grows a VP-shell-construction helper (unlikely
   given the stated "lean" scope, but not ruled out), that helper would
   need to be checked for the same caller-context-respecting behavior
   before Keyring or credo-ts adopts it.
2. If/when credo-ts's `DifPresentationExchangeService` migrates from
   `@animo-id/pex` to `@animo-id/dif-pex`, whatever now performs VP-shell
   construction downstream of that migration (credo-ts itself, most likely,
   since the library no longer does it) needs the same audit this
   investigation just did on `constructPresentations()`.

Until then, the actionable fix is the one in `PR-CANDIDATE.md`, against
`animo/PEX`, which is where the currently-real bug, for the
currently-installed and currently-consumed package, actually lives.
