# ref-13-jcs-canonicalizer-corpus

T1 from
[`docs/plans/reference-app-sdk-packaging/2026-09-01-al.md`](../../docs/plans/reference-app-sdk-packaging/2026-09-01-al.md)
§1 ("Remediation, phased"), restated as pre-demo-day insurance in
[`2026-09-03-bm.md`](../../docs/plans/reference-app-sdk-packaging/2026-09-03-bm.md):
**prove or disprove that `@bifold/trust-tasks`'s JCS canonicalizer
(`documentProof.ts`, the `canonicalize` npm package) and
`@openvtc/trust-tasks`'s own (`canonicalJson`) agree — before changing any
code.** This is a corpus diff, not a migration. T0/T2/T3/T4 of that
remediation are out of scope here and untouched.

```sh
npm install && node run.mjs      # verbose
node run.mjs --quiet             # pass/fail only, for the ladder runner
```

No network needed to run it — the vendored fixture in `vendor/` was fetched
once (see below) and is frozen. Deterministic; no external state.

## The finding that changes the shape of this rung

**The premise needs a correction before the corpus result means anything.**
Both plan documents describe the two canonicalizers as *already, currently* in
the bundle together: *"Both are in the app now"* (al, §1) and *"`ceremony.ts`
genuinely invokes both today"* (bm). That is not what this worktree's actual
dependency graph contains.

`@openvtc/trust-tasks` is pinned `^0.9.0` and **0.9.0 is what's installed**
(`node_modules/@openvtc/trust-tasks/package.json`, and `bifold/node_modules/@openvtc/trust-tasks/package.json`
— same version, hoisted). That installed package's `_runtime/` directory
contains exactly five files: `codes.ts`, `consume.ts`, `document.ts`,
`index.ts`, `transport.ts`. **There is no `canonical.ts`/`canonical.js` and no
exported `canonicalJson` anywhere in this package at 0.9.0** — checked against
both `src/` and the compiled `dist/`, and against the package's own
`index.ts`/`index.d.ts` export list, which names nothing canonicalization-related.
`consumeInbound` and the rest of the framework pipeline in this version take
proof verification entirely through the injected `ProofVerifier` — the
package genuinely does no canonicalization of its own at 0.9.0.

Corroborating evidence already in this repo, found independently of this
rung: [`ref-06w4-package-truth/run.mjs`](../ref-06w4-package-truth/run.mjs)
(which imports the real, installed `@openvtc/trust-tasks` for everything
else) hand-writes its own tiny `jcs()` helper rather than importing one from
the package — because there was nothing to import.

**When did `canonicalJson` actually appear?** Bisected against the public npm
registry on 2026-09-06:

| Version | Has `src/_runtime/canonical.ts`? |
|---|---|
| 0.9.0 (installed here) | no |
| 0.10.0 | no |
| 0.11.0 | no |
| 0.12.0 | no |
| **0.13.0** | **yes** |
| 0.13.1, 0.14.0, 0.16.8 | yes |

So `canonicalJson` shipped starting at **0.13.0** — consistent with the al
document's own note that "framework 0.5.0 landed in between" 0.9.0 and 0.16.8,
"which is where the two named digests, the document lifecycle table and the
freshness rules arrived." The duplicate-canonicalizer risk T1 was asked to
measure is real **once T0 (the pin advance) happens**, not before. Today, with
0.9.0 actually installed, there is exactly one JCS canonicalizer in the
bundle's live code path (`canonicalize`, via `documentProof.ts`) — the second
one doesn't exist yet in this dependency graph. `ceremony.ts` and friends
cannot be invoking a `canonicalJson` that isn't exported by the version they
depend on; grepped to confirm no production file imports
`_runtime/canonical` or a `canonicalJson` name from `@openvtc/trust-tasks`.

**This does not make T1 moot — it sharpens what T1 is actually insurance
against.** T0 (advancing the pin) is explicitly sequenced as the *next* step
in the plan, and the moment it lands, 0.13.0+'s `canonicalJson` becomes live
in the same bundle as `documentProof.ts`'s `canonicalize` call — at which
point the two-canonicalizer risk the plan describes becomes real for the
first time. Measuring the divergence *now*, before that pin advance, is still
the right sequencing the plan asked for ("prove or disprove... before
changing any code") — it just means the comparison below is against the
version upstream will *become* once T0 runs, not a version already resolving
silently in today's bundle.

## Method

- **Bifold side**: the actual, installed `canonicalize@1.0.8` — the same
  import `bifold/packages/trust-tasks/src/documentProof.ts`'s
  `jcsCanonicalize` uses, called directly here with no changes.
- **Upstream side**: `canonicalJson`, vendored frozen from
  `@openvtc/trust-tasks@0.16.8`'s `src/_runtime/canonical.ts` (the version the
  al document researched on npm on 2026-09-01) — fetched with `npm pack
  @openvtc/trust-tasks@0.16.8` on 2026-09-06, types erased, logic untouched.
  See [`vendor/upstream-canonical.mjs`](./vendor/upstream-canonical.mjs) for
  the full provenance note and the reasoning for not simply
  `import`-ing it from the installed package (0.9.0 doesn't have it — see
  above). **Do not hand-edit the vendored copy** if the corpus finds
  something — the divergence is the finding.
- **Corpus**: [`fixtures/corpus.mjs`](./fixtures/corpus.mjs), 29 cases as JS
  values (not JSON text, so `-0` and similar survive), covering the plan's
  four required categories plus one bonus case (see below).
- **Comparison**: for each case, run both canonicalizers over the identical JS
  value and diff the output byte-for-byte. Where both produced output, also
  compute `multibase(base58btc, multihash(sha-256, <canonical bytes>))` over
  each — the same `DigestMultibase` construction
  `documentProof.ts`'s `digestMultibase`/`taskDigestMultibase` use — and
  compare those too, since that's the artifact whose mismatch would actually
  produce a live signature failure.

## Result

**28/28 required cases byte-identical, and digestMultibase-identical
throughout.** Across all four categories the plan named:

- unicode escapes and surrogate pairs (including unpaired surrogates, which
  neither implementation throws on)
- number formatting edge cases (`-0`, `Number.MAX_SAFE_INTEGER`, integers past
  safe-integer precision, `1e21`/`1e20` at the exponential-notation boundary,
  a float needing full precision, the smallest denormal)
- deep member ordering (multi-level nesting, non-ASCII key ordering by UTF-16
  code unit, numeric-looking string keys sorted as strings)
- empty/absent members (empty object/array, `undefined`-valued members
  omitted, `undefined` inside an array turned to `null`, a document shaped
  like `taskDigestMultibase`'s actual input — `proof` already stripped)

no byte differs. Both implementations delegate string escaping and number
formatting to the same underlying primitive (`JSON.stringify`/`Number::toString`),
which is exactly why they agree: neither hand-rolls the part of RFC 8785 that
is hardest to get byte-exact. **Per the plan's own framing, this is the
"byte-identical" outcome: the future migration (T2, out of scope here) is a
safe swap on canonicalization grounds** — once T0 lands, nothing in this
corpus predicts a live signature mismatch from choice of canonicalizer alone.

## Beyond the plan's four categories

One extra case, `bonus-date-object-toJSON`, was added past the required list
and **does diverge** — flagged as non-gating (it doesn't fail `npm run check`)
because it's outside the plan's scope, but recorded because it's a real,
mechanical difference between the two implementations' source, not
speculation:

```
bifold:   {"when":"2026-09-06T12:00:00.000Z"}
upstream: {"when":{}}
```

`canonicalize` special-cases any object with a `toJSON` method (`object.toJSON
!= null`) and defers to `JSON.stringify` for it, exactly like `JSON.stringify`
would render it directly. `canonicalJson` has no such check — a `Date`
instance has no own enumerable properties, so `Object.entries(date)` is `[]`
and it canonicalizes to `{}`, silently dropping the value.

**This is very unlikely to be live risk in practice**: every `TrustTaskDocument`
member that could carry a timestamp (`issuedAt`, `expiresAt`, `created`) is
typed `string` in `@openvtc/trust-tasks`'s own `document.ts`, and any document
that has been through `JSON.parse` (the wire path) cannot contain a `Date`
instance at all — `JSON.parse` never produces one. The only way to hit this is
constructing a document programmatically with a live `Date` object before
serializing it, which nothing in `documentProof.ts` or `ceremony.ts` does
today (checked: no `new Date(` reaches either canonicalizer's input
anywhere in `bifold/packages/trust-tasks/src/` or
`bifold/packages/core/src/modules/trust-tasks/`). Recorded here anyway,
per the plan's own instruction to keep any found divergence as a permanent
fixture — if some future code path ever hands a `Date` (or another
`toJSON`-bearing object, e.g. a class wrapping a bigint) to either
canonicalizer before stringifying it, this is the exact case that will bite,
and silently: no exception, just a dropped/mismatched member and a
digest that won't match the other implementation's.

Not investigated further because it's outside T1's scope (T1 is measurement,
not remediation) and outside the plan's named corpus categories — flagging it
for whoever picks up T2/T4 (the "guard against more than one canonicalizer
resolving" check) as a `toJSON` case worth its own corpus entry there too.

## What this does *not* prove

- **Not a full RFC 8785 conformance suite.** This corpus targets the plan's
  four named categories plus the one bonus case above; it is not the JCS test
  vectors from the RFC or the `cyberphone/json-canonicalization` reference
  suite. If T2 proceeds, running that reference suite against both
  implementations once more (as part of T2's own verification, not this rung)
  would be the belt-and-suspenders version of this result.
- **Not a statement about `@openvtc/trust-tasks` 0.9.0's behavior**, since
  0.9.0 has no canonicalizer to compare — see the finding above. This corpus
  compares `canonicalize` (0.9.0's actual, only live canonicalizer today)
  against 0.16.8's `canonicalJson` (what 0.9.0 will gain once T0 advances the
  pin). If T0 lands on a version other than 0.16.8, re-run this rung against
  that version's `src/_runtime/canonical.ts` before treating this result as
  current — check the file hasn't changed shape first (`diff` against
  `vendor/upstream-canonical.mjs`).
- **Not proof that no OTHER duplication exists.** T1's scope is the two JCS
  canonicalizers specifically; it says nothing about the wider version-gap
  risk (0.9.0 → 0.16.8+) the al document raises alongside it, which T0 and a
  full reference-ladder re-run (per the `openvtc-workspace` skill's "bottom-up
  after advancing a pin" rule) are what actually cover.
