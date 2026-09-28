# @bifold/dtg-vocab

Predicate Handling (cred-spec §C4 in `docs/plans/vsc-migration-plan/cred-spec-constraints.md`) as a real package: a verifier-side accept-list, loaded once at configuration time and never dereferenced or derived from a credential at verification time, plus the three-step check (absolute-IRI, in-accept-list, profile-constraints) that consumes it.

This is plan §6's V1 — promoted from `tsp-reference/ref-07f-predicate-registry/`'s exploratory mirror-and-consumer rung, now wired into the app via the four-entry `@bifold/*` registration (root `package.json` resolutions, `app/package.json`, `app/metro.config.js`'s `packageDirs` and `BIFOLD_SOURCE_PACKAGES`). Nothing outside this package imports it yet — wiring it into the wallet's actual verification path is V2/V3's job, not this one's.

## `vocab/` is a mirror — read this before touching it

`vocab/predicates/*.jsonld`, `vocab/meta/predicate.schema.json`, and everything under `vocab/dist/` are a **mirror** of [`trustoverip/dtgwg-vsc-registry`](https://github.com/trustoverip/dtgwg-vsc-registry) — a real registry repository that exists today but has not published a release or an npm/JS package. `vocab/tools/build.mjs` validates `vocab/predicates/*.jsonld` against `vocab/meta/predicate.schema.json` and regenerates `vocab/dist/` (`accept-list.json`, `vocab.jsonld`, `context/v1.jsonld`) — never hand-edit `dist/`.

**Deletion trigger:** the moment `dtgwg-vsc-registry` publishes a consumable release (an npm package, or even just a stable raw-content URL a build step can fetch), delete `vocab/` entirely and point `src/acceptList.ts` at that release instead of the local mirror. Everything in `src/` is written so that swap only touches `acceptList.ts`'s loader — `namespace.ts`, `predicateHandling.ts`, and this package's public API do not change.

This mirror tracks cred-spec [`#52`](https://github.com/trustoverip/dtgwg-cred-spec/issues/52) ("Predicate Registry structure") for the *shape* of a predicate definition, but the two `.jsonld` files under `vocab/predicates/` are transcribed from the **real registry's own content**, not `#52`'s issue-body example — the real registry is richer (adds `name`/`version`, uses a flat versioned-path `id` rather than a `#fragment`). `witnessed.jsonld` is a verbatim transcription of the real registry's `predicates/witnessed/1/predicate.jsonld`. **`endorses.jsonld` is reconstructed from cred-spec's own normative `dtg:endorses` profile text, not a verbatim mirror of the real registry's file** — this rung's author didn't have network access to fetch that file directly. Treat `endorses.jsonld` as a best-effort placeholder until someone diffs it against the real file.

## Namespace: real registry, not the plan's placeholder

This package targets the **real registry namespace** (`https://registry.trustoverip.org/dtg/...`), not `docs/plans/vsc-migration-plan.md`'s still-written `firstperson.network` placeholder. That's a deliberate decision, not an oversight — see `/srv/dev/scratch/2026-09-27-bm-vsc-migration-handoff.md`'s "Cleanup" section for the reasoning (`dtgwg-cred-spec#64`, Brendan's own PR, already has an upstream "ship it") and what to check if `#64` changes before merging. `src/namespace.ts` is the one place this would need to change.

Note the resulting inconsistency with `tsp-reference/ref-07h-vsc-credo-suites/` (a sibling V0 rung, built in parallel before this namespace decision was forced): it still uses the old placeholder. That's expected and already documented in the handoff file, not something this package's build fixes.

## A real, load-bearing finding from V0: draft status, not active

Both mirrored predicates carry `"status": "draft"` in the real registry today — neither has been formally activated. `vocab/tools/build.mjs`'s `buildAcceptList()` therefore defaults to `statuses: ['active', 'draft']`, not cred-spec `#52`'s stricter `'active'`-only default — a caller who wants `#52`'s reading passes `{ statuses: ['active'] }` explicitly, and will get an **empty** accept-list against today's real registry content. Whoever wires this into V3's actual verification path needs to make an explicit, visible call about whether accepting draft-status predicates is acceptable for production, or whether to wait on the registry's own activation — this package deliberately does not make that call silently.

## `src/` — permanent, survives the mirror's deletion

- `namespace.ts` — the one exported set of namespace constants (cred-spec `#48`'s "isolate this behind one constant").
- `acceptList.ts` — loads the built accept-list from disk; no network, no dereference at verification time (cred-spec C4).
- `predicateHandling.ts` — `configure()` (once, may load schemas) and `verify()` (per-credential, network-free): the three Predicate Handling steps plus every profile constraint expressible generically, reporting `checked` vs. `unchecked` so a caller never mistakes "accepted" for "every constraint was mechanically enforced" (`subjectObjectRelationship` and `minimumIssuerScope` are free-text/unenforceable today and always land in `unchecked` unless the caller supplies enough context to check them).

## Commands

```sh
yarn workspace @bifold/dtg-vocab build        # validates vocab/, regenerates vocab/dist/, compiles src/ -> build/
yarn workspace @bifold/dtg-vocab test          # regenerates vocab/dist/ (pretest), then runs the jest suite
yarn typecheck                                 # root — must stay green
```
