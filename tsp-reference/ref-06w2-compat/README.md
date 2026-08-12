# ref-06w2 — compatibility evidence: same ceremony, different dance

The claim under test: **the trust-task recast of the witnessed exchange is the
same ceremony at its core** — only the wire clothes change — and the two
dances can coexist during migration. Proven three ways, 13 checks, using the
**real compiled witness-server functions**
(`bifold/packages/witness-server/dist/WitnessService.js` — imported, not
copied).

Run: `npm install && npm start` (`npm run check` for quiet).

## Act 1 — two dances, one crypto core, one artifact

The same submission, expressed as today's `submit-presentation` JSON and as a
`witness/session/submit` task document, fed to the production
`buildWitnessCredentialJson`: the resulting VWCs are **byte-identical**
(volatile id/timestamps stripped), with the digest being the production
`computeVrcDigest` over JCS in both worlds. Also asserted: today's digest
encoding is `sha256:`+hex — so the cred-spec `digestMultibase` migration is
real, and **encoding-only** (the canonicalization survives).

## Act 2 — the translator: lossless where it maps, honest where it doesn't

A pure old⇄new mapping for the three session messages round-trips losslessly,
and the translated documents are exactly ref-06w's shapes (own thread,
`parentThreadId`, challenge in the VP). The **unmapped delta is enumerated**
in `fixtures/translator-fixtures.json` — five legacy concepts with no task
home yet (witness preference, `reportingDid`, the announce, verify-credential,
the bespoke error codes). Plus **lever B**: the legacy handshake's own
`vrc:rceVersion` ordinal gates the new dance — `4` means "speaks Trust
Tasks", parseable by every existing wallet, zero new messages.

## Act 3 — one witness, one session, two dialects (the migration demo)

Wendy registers both handlers — legacy JSON over basic messages and the
dedicated task type — normalizing both through the act-2 translator into
**one session state machine**. Alice runs the entire legacy dance; Bob runs
the entire task dance; **one challenge serves both**; each receives their
per-direction VWC (built by the real function) in their own dialect, and the
dialects never leak across. **Lever C** holds throughout: the legacy
`witnessContext.sessionId` and the task ceremony identifier are one value, so
old records and new `taskContext`s share an identifier space.

## Honest limits (signal, not production)

Keyring is pre-production, so this rung *signals* the compatibility story
rather than building it: the legacy VWC delivery here is a legacy-shaped
message, whereas today's real delivery runs Credo's `issue-credential`
protocol (keeping that channel while the `#response` carries a
reference+digest is **lever D**, an open design question for the spec
review); proofs are stubs; the announce/reporting/verify services are out of
scope; and no mediator hop. The load-bearing claims — shared core, lossless
mapping, mixed-dialect coexistence, shared identifier space — are fully
proven.

Pinned against: the app's own `witness-server` build (monorepo-relative
import), `@credo-ts/*` 0.6.3, draft spec shapes from
[ref-06w](../ref-06w-witnessed-exchange/) / [trust-tasks PR #3](https://github.com/Mickens-Lab/dtgwg-trust-tasks-tf/pull/3).
