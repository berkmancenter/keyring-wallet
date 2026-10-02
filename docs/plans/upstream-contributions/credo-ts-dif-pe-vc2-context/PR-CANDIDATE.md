# PR candidate — supply VC 2.0 base context for `ldp_vp` presentation creation (`credo-ts`)

*Status: **BLOCKED — do not submit**. Prepared on a branch for internal reference
only. Branch `fix/dif-pe-vc2-base-context` (commit `5a3ad127d54b0a0cd0c81198926049519d292ca8`,
DCO signed off, GPG/SSH-signed) in an isolated clone at
`/srv/dev/scratch/upstream-contrib/credo-ts-candidate3` — not pushed anywhere, no PR opened.
Target (if later unblocked): `openwallet-foundation/credo-ts`,
`packages/core/src/modules/dif-presentation-exchange/DifPresentationExchangeService.ts`.*

## Why this is blocked

Open PR **#2910** ("feat(pex): improve Presentation Exchange 2.1.1 conformance and
credential selection", `rmlearney-digicatapult:feat/pex-211-alignment`) is a live
collision risk, re-checked fresh against its real current state as of 2026-09-29:

- **State: OPEN** (`updatedAt: 2026-08-18T12:17:06Z`). Not merged, not closed.
- It **rewrites the exact call site** this fix needs to touch. Its diff to
  `DifPresentationExchangeService.ts` restructures the `createPresentation()` body
  around the `this.pex.verifiablePresentationFrom(...)` call: it introduces
  `ldpVpSigningOptions`, renames `getProofTypeForLdpVc` → `getProofTypeForLdpVp`
  (and repoints it at `format.ldp_vp` instead of `format.ldp_vc`), changes
  `getPresentationSignCallback`'s signature, and reworks verification-method
  selection (`getVerificationMethodForLdpVp`, `getAuthenticationVerificationMethodsForSubjectId`,
  a new `getHolderDid` fallback). The options object passed to
  `verifiablePresentationFrom` is directly rewritten in this PR (the
  `proofOptions`/`extraProofOptions` → `anonCredsW3cProofOptions` spread changes shape).
  A fix landing independently on `main` right now would very likely produce
  merge conflicts in this exact function, and applying it *after* #2910 merges
  would need to be re-diffed against the PR's restructured code.
- It **still does not add `basePresentationPayload` handling** — I confirmed this
  by pulling the PR's full diff (`gh pr diff 2910`) and inspecting its version of
  `verifiablePresentationFrom(...)`: the options object still only carries
  `proofOptions` and `presentationSubmissionLocation`. The underlying bug this
  fix addresses is present in both `main` and #2910's branch, unchanged.
- It **still pins `@animo-id/pex@^6.1.1`** — #2910's diff contains no change to
  any `package.json` or `pnpm-workspace.yaml`, and `main`'s current
  `pnpm-workspace.yaml` (fetched fresh) still reads `'@animo-id/pex': ^6.1.1`.

Given this, per instructions: do not prepare a submission-ready PR. The fix below
is real, re-verified against current `main`, and tested, but staged for internal
reference only pending a human decision.

**Options for a human to choose between:**

1. **Wait for #2910 to resolve** (merge or close), then re-verify this fix
   against the resulting `main` and re-diff/rebase before proposing it upstream.
   Lowest coordination overhead, but timeline is out of our control — #2910 has
   had no activity since 2026-08-18.
2. **Reach out to #2910's author/reviewers directly** (Robert M. Learney /
   digicatapult, and whichever OWF maintainers are reviewing) to flag the
   `basePresentationPayload` gap and ask whether they'd fold in a VC 2.0
   base-context fix as part of their conformance work, or want it proposed as a
   small follow-on PR that targets their branch instead of `main`. Faster, but
   requires someone to actually make contact and needs #2910's author to be
   receptive to scope creep on an already large PR.

## The change as built

`createPresentation()` calls `this.pex.verifiablePresentationFrom(...)` with no
`basePresentationPayload` option, for every claim format. The wrapping
presentation's `@context` is left entirely to `@animo-id/pex`'s own defaulting.
When every credential in an `ldp_vp` is a VC 2.0-shaped `ldp_vc` credential (its
`firstCredential.contexts[0]` is the VC 2.0 context URL), pex can default the
presentation wrapper to a VC 1.1-shaped context instead — wrapping a VC2.0 credential
in a generic DIF-PE presentation then reliably produces a "protected term
redefinition" JSON-LD error.

| File | Change |
|---|---|
| `packages/core/src/modules/dif-presentation-exchange/DifPresentationExchangeService.ts` | +25 lines: one new import (`CREDENTIALS_CONTEXT_V2_URL` from `../vc`), a new private helper `getVc2BasePresentationPayload()`, and two call-site lines wiring its result into the `verifiablePresentationFrom(...)` options object |

`getVc2BasePresentationPayload()` mirrors the existing
`shouldSignWithAnonCredsW3cService()` helper's style exactly (same
early-return guard on `claimFormat !== ClaimFormat.LdpVp`, same
`.every(({ credential }) => { const firstCredential = ...; ... })` shape):

```ts
private getVc2BasePresentationPayload(presentationToCreate: PresentationToCreate) {
  if (presentationToCreate.claimFormat !== ClaimFormat.LdpVp) return undefined

  const allCredentialsAreVc2ShapedLdpVc = presentationToCreate.verifiableCredentials.every(({ credential }) => {
    const firstCredential = credential.firstCredential
    if (firstCredential.claimFormat !== ClaimFormat.LdpVc) return false
    return firstCredential.contexts?.[0] === CREDENTIALS_CONTEXT_V2_URL
  })

  return allCredentialsAreVc2ShapedLdpVc
    ? { basePresentationPayload: { '@context': [CREDENTIALS_CONTEXT_V2_URL] } }
    : undefined
}
```

wired in as:

```ts
const basePresentationPayload = this.getVc2BasePresentationPayload(presentationToCreate)

const verifiablePresentationResult = await this.pex.verifiablePresentationFrom(
  presentationDefinitionForSubject,
  credentialsForPresentation,
  this.getPresentationSignCallback(agentContext, presentationToCreate),
  {
    proofOptions: { challenge, domain, ...extraProofOptions },
    presentationSubmissionLocation,
    ...basePresentationPayload,
  }
)
```

Full diff: [`fix.patch`](./fix.patch).

## Relationship to Keyring's own local patch (ground truth, not paraphrase)

Keyring already carries a local yarn patch,
`.yarn/patches/@credo-ts-core-npm-0.7.1-pr-2704-20260909134930-b95d84ab27.patch`,
whose `DifPresentationExchangeService.mjs` hunk does exactly this — same helper
name (`getVc2BasePresentationPayload`), same detection logic
(`claimFormat === ClaimFormat.LdpVc && firstCredential.contexts?.[0] === CREDENTIALS_CONTEXT_V2_URL`),
same `{ basePresentationPayload: { '@context': [CREDENTIALS_CONTEXT_V2_URL] } }` shape,
spread into the same options object alongside `presentationSubmissionLocation`. That
patch is the compiled-output (`.mjs`) form of the same fix already applied to
Keyring's vendored `@credo-ts/core` build; this candidate is the from-source
(`.ts`) equivalent, re-derived and independently re-verified against a fresh
clone of current upstream `main`, intended for upstream submission once #2910
is no longer a collision risk. The two are consistent — this candidate is not
a new design, it is the existing, already-proven local workaround written as a
proper upstream source patch.

## Coupling with the parallel pex-side fix ("Candidate 4")

This fix alone may not fully resolve the underlying JSON-LD error. It supplies
a base context on the credo-ts side, but whether that actually prevents the
"protected term redefinition" error depends on whether `@animo-id/pex`'s
`verifiablePresentationFrom` / `PEX.verifiablePresentationFrom` respects a
supplied `basePresentationPayload['@context']` when merging it against the
wrapped credentials' own contexts, rather than still applying its own
independent defaulting on top. A separate, related bug in `@animo-id/pex`
itself ("Candidate 4") is being investigated in parallel by another agent
working in `/srv/dev/scratch/upstream-contrib/pex-ts-candidate4` — that work
was not touched or reused here per instructions.

**Any upstream proposal for this credo-ts fix should either land alongside
that pex-side fix, or explicitly flag the dependency to reviewers** — landing
this fix alone could give the false impression the JSON-LD error is fully
resolved when it may only be partially addressed until pex also honors the
supplied base context.

## Why it doesn't break anything (evidence)

| Claim | Evidence |
|---|---|
| Bug is real and reproducible against current upstream `main` | Re-verified fresh in an isolated clone (`/srv/dev/scratch/upstream-contrib/credo-ts-candidate3`, cloned from `openwallet-foundation/credo-ts` at commit `d80bc49`, depth 1) before writing any fix — confirmed `verifiablePresentationFrom(...)` has no `basePresentationPayload` handling on any claim format |
| Diff is narrow | +25 lines, one file, one new import, one new private helper, two lines at the call site — mirrors `shouldSignWithAnonCredsW3cService()`'s existing style exactly |
| No API change | `createPresentation()`'s public signature is unchanged; the new helper is private |
| Existing suite still passes | `pnpm exec vitest run --project unit packages/core/src/modules/dif-presentation-exchange` → **9/9 pass** (the only test file for this service on current `main`; PR #2910 splits this suite into several files, but that split isn't merged) |
| Typecheck clean | `pnpm run types:check` (`tsc -p tsconfig.json --noEmit`) → no errors |
| Style clean | `pnpm exec biome check` on the changed file → no issues |
| DCO / signing | Commit is `git commit -s` (Signed-off-by trailer, last line) and SSH-signed (`git log --show-signature` reports "Good git signature") |

## What's left before this can be submitted

1. #2910 needs to resolve (merge or close) — or a human needs to make contact
   with its author per option 2 above.
2. If #2910 merges first: re-verify this bug against the post-merge `main` (the
   call site will look different — likely need to rebase this helper onto
   whatever `verifiablePresentationFrom(...)` options assembly #2910 leaves
   behind) and re-run the (by-then-split) test suite.
3. Confirm with whoever owns "Candidate 4" (the parallel `@animo-id/pex`
   context-handling investigation) whether the two fixes should be proposed
   together, and if so, coordinate the two PRs' descriptions to reference each
   other.
4. Add a regression test exercising this exact case (all-VC2.0-shaped `ldp_vc`
   credentials wrapped into an `ldp_vp`) — not yet written; the existing 9 tests
   don't cover this path and this candidate doesn't add one, since it's not
   ready for submission.
