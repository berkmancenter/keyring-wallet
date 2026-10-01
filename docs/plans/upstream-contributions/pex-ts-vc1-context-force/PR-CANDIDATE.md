# PR candidate — `constructPresentations()` must not force-append the VC 1.1 base context

*Status: **staged on an isolated clone, not pushed anywhere**. Branch
`fix/pex-context-force-append`, commit `ca5e46e8f531ea0f46f34be6e3f6a752a69633bf`
(DCO signed off, SSH-signed and verified). Target: **`animo/PEX`**
(`https://github.com/animo/PEX`, `main`, at the exact commit tagged `v6.1.1`)
— see "Which repo is upstream" below for why this is the target, not
`Sphereon-Opensource/pex` or `animo/pex-ts`. Not submitted; no PR/issue
opened, nothing pushed.*

## Which repo is upstream, and why this took real digging

The installed dependency is `@animo-id/pex@6.1.1`. Its own `package.json`
`repository` field still says `Sphereon-Opensource/pex`, which is misleading:

| Repo | Tag `v6.1.1`? | Evidence |
|---|---|---|
| `Sphereon-Opensource/pex` | No — tags stop at `v4.1.0` | Not archived, but last push `2024-12-16`. Dormant for the entire `4.1.1` → `6.1.1` release range. |
| `animo/pex-ts` | No tags at all | Single commit ("feat: initial implementation", 2026-08-27), a **from-scratch rewrite** under a new package name, `@animo-id/dif-pex`. No shared git history with either PEX repo. |
| **`animo/PEX`** (fork of `Sphereon-Opensource/pex`) | **Yes** — `git ls-remote --tags` shows `v6.1.1` at `4651d8c6211451008302a8c4413fbeeeb35eca07` | This commit **is** `main`'s current `HEAD`. Full, continuous commit history from the Sphereon fork point through every `4.1.1`–`6.1.1` release (`Merge pull request #10 from animo/fix/predicates-and-other-issues`, etc). This is where Animo (`blu3beri`, `timoglastra` — `@animo-id/pex`'s npm maintainers) actually cut every release from `4.1.1-alpha.0` onward. |

So the real upstream continuity for the *installed, currently-broken*
package is the fork **`animo/PEX`**, not the nominal `repository` field and
not the new rewrite. `animo/pex-ts`'s own `parity/package.json` and
`parity/PARITY.md` call `@animo-id/pex` "the deprecated `@animo-id/pex` (the
version credo-ts pins, `^6.1.1`)" — confirming both that a migration is
intended *and* that credo-ts (the consumer Candidate 3 patches) still runs
on the old package today, which is exactly what `animo/PEX` ships.

## (b): the bug is present verbatim in current upstream source

`animo/PEX` at `v6.1.1` (== current `main`), `lib/PEX.ts:345–352`, is the
literal TypeScript source that compiles to the `dist/main/lib/PEX.js` Keyring
already patches:

```ts
const context = opts?.basePresentationPayload?.['@context']
  ? Array.isArray(opts.basePresentationPayload['@context'])
    ? opts.basePresentationPayload['@context']
    : [opts.basePresentationPayload['@context']]
  : [];
if (!context.includes('https://www.w3.org/2018/credentials/v1')) {
  context.push('https://www.w3.org/2018/credentials/v1');
}
```

This is not "the same logic under a different name" — it is byte-identical
to what Keyring's local patch
(`.yarn/patches/@animo-id-pex-npm-6.1.1-976fb8ed6b.patch`) already targets in
the compiled `dist/*/lib/PEX.js`. No commit since `v6.1.1` touches this
function (`main` and the tag are the same commit).

`animo/pex-ts` (the rewrite) was checked too, structurally, not by grep: its
`dif-pex/src/presentation-submission/` module builds only the
`PresentationSubmission` descriptor map (`createPresentationSubmission()`),
a pure function of caller-supplied choices — there is no module anywhere in
`dif-pex/src` that builds the wrapping `VerifiablePresentation` shell
(`@context`/`type`/`holder`) at all. Per its own `README.md` ("no credential
parsing… you pass already-decoded claims") and `parity/PARITY.md` ("Result
*structures* differ by design"), that responsibility was deliberately moved
out of the library's scope, not fixed as a side effect. So the bug has no
equivalent locus there to fix — see `INVESTIGATION.md` in this same
directory for that side of the finding, kept separate because it doesn't
warrant a PR.

## The fix (identical shape to Keyring's local patch)

```ts
// Only default to the VC 1.1 base context when the caller supplied no base context at all.
// The previous unconditional `!context.includes(v1)` check force-appended the v1 context onto
// any caller-supplied base context (e.g. a VC 2.0 context array), producing a VP whose context
// mixes v1 and v2 credential vocabularies. Signing such a VP over a VC2.0-shaped credential
// (e.g. with Ed25519Signature2018) then fails downstream with a JSON-LD "redefine a protected
// term" error, because the mixed context redefines terms the VC's own v2-family context already
// fixed. A caller that supplies its own base context has already made a deliberate choice; this
// must not silently overwrite it.
if (context.length === 0) {
  context.push('https://www.w3.org/2018/credentials/v1');
}
```

Full diff: [`fix.patch`](./fix.patch) (`git format-patch -1`, one commit).

### Test coverage added, and a pre-existing gap it surfaced

`grep -rl constructPresentations test/` in `animo/PEX` returns **no test
file** — this codepath had zero direct coverage. Two new tests were added to
`test/PEX.spec.ts` right after the existing submission-location tests:

- `constructPresentations defaults the base context to VC 1.1 when the caller supplies none`
- `constructPresentations does not force-append the VC 1.1 context onto a caller-supplied base context`

Adding them required removing an accidental `it.only(...)` already sitting
in that file (`test/PEX.spec.ts:1253`, on an unrelated test), which was
silently limiting the whole suite to **1 of 52 tests** — almost certainly
how this bug (and the pre-existing gap below) went uncaught. Confirmed this
predates the current change: it reproduces with `.only` removed against the
unmodified `lib/PEX.ts` (verified via `git stash` back to upstream `HEAD`
before re-applying the fix).

Removing `.only` also **exposes two pre-existing, unrelated test failures**
in the same file:

- `should pass with jwt vp with submission data`
- `when single presentation is passed with presentationSubmissionLocation.EXTERNAL, it generates the submission as external`

Both fail with a descriptor-id mismatch (`pdSchema` in the test body uses
input descriptor id `'1'`, but the evaluated submission from
`vp_permanentResidentCard.jwt` expects `'prc_type'`) — this reproduces
identically against upstream's unmodified `lib/PEX.ts`, so it is unrelated
to the `@context` fix and is **left unfixed here**, flagged for a maintainer
to look at separately. Everything else passes:

```
Test Suites: 1 failed, 39 passed, 40 total
Tests:       2 failed, 3 skipped, 362 passed, 367 total
```

(the 2 failures are the pre-existing ones above; 3 skips are pre-existing
and unrelated). `npx tsc -p tsconfig.json --noEmit` is clean.

## Coupling with Candidate 3 (credo-ts)

A parallel effort ("Candidate 3") patches credo-ts's
`DifPresentationExchangeService` to supply a real, caller-chosen base
context (e.g. a VC 2.0 context) instead of leaving it empty. That fix is
inert without this one: as long as `animo/PEX`'s `constructPresentations()`
force-appends v1 regardless, whatever context credo-ts supplies gets a v1
context spliced in anyway, reproducing the same mixed-context JSON-LD
signing failure. This fix is what makes Candidate 3's context actually
*respected* rather than overridden. Both fixes target the same consumer
path: credo-ts pins `@animo-id/pex@^6.1.1`, i.e. exactly the `animo/PEX`
lineage this PR targets — not `animo/pex-ts`.

## Why this serves the community, not just our use case

- Any caller that wants to issue/present a VC 2.0-shaped credential through
  this library hits the same mixed-context bug — this is not
  Keyring-specific behavior, it's a caller-context-ignored bug in the public
  `constructPresentations()` API.
- No API change: same signature, same return shape, only the internal
  default-context decision changes, and only for callers who supply their
  own base context (behavior for the common case — no base context
  supplied — is unchanged).
- Adds the first direct test coverage for this method's `@context` handling,
  and surfaces (without trying to silently fix) an unrelated accidental
  `.only` that was hiding real coverage gaps.

## Open questions for the maintainer

1. `animo/PEX` is itself heading toward deprecation in favor of
   `@animo-id/dif-pex` (`animo/pex-ts`) — is a `6.1.2` patch release still
   wanted here, given the migration in progress? (credo-ts's current pin
   suggests yes, for however long the migration takes.)
2. Preference on the two pre-existing, now-exposed test failures — worth a
   separate issue/PR, or should this PR's scope grow to include them? Kept
   out of this PR to keep the diff reviewable and scoped to one bug.
3. Should `@animo-id/dif-pex` eventually grow a `constructPresentations()`
   equivalent (VP-shell construction), or is that intentionally left to
   callers going forward? If the latter, this class of bug simply cannot
   recur there, which is worth knowing for the migration write-up.

## Notes for our own review

- Everything above happened in an isolated clone at
  `/srv/dev/scratch/upstream-contrib/pex-animo-fork` (remote
  `https://github.com/animo/PEX.git`), never inside the Keyring repo. Nothing
  was pushed; no PR or issue was opened anywhere.
- Keyring's own `.yarn/patches/@animo-id-pex-npm-6.1.1-976fb8ed6b.patch`
  stays in place regardless of what happens with this upstream PR — it
  patches the installed `dist/*` build directly and isn't contingent on
  upstream accepting anything.
