# PR candidate — DCQL `ldp_vc` query branch never matches any credential

*Status: drafted locally in an isolated scratch clone
(`/srv/dev/scratch/upstream-contrib/credo-ts-candidate2`, branch
`fix/dcql-ldp-vc-format-mismatch`, commit `3b419a0d59fd2296c93e6f949d024079aca0f3e4`),
not pushed to any fork, not submitted upstream — awaiting review. Target:
`openwallet-foundation/credo-ts`, `packages/core/src/modules/dcql/DcqlService.ts`.*

## The bug

`DcqlService.queryCredentialsForDcqlQuery` builds a wallet query for each
credential format present in a DCQL request. The `ldp_vc` branch's `$or`
filter is copy-pasted from the `jwt_vc_json` branch immediately above it and
never updated to match its own format:

```ts
if (formats.has('ldp_vc')) {
  const w3cRecords = await w3cCredentialRepository.findByQuery(agentContext, {
    claimFormat: ClaimFormat.LdpVc,

    // For LDP_VC we query the expanded types
    $or: dcqlQuery.credentials
      .flatMap((c) => (c.format === 'jwt_vc_json' ? c.meta.type_values : []))
      .map((typeValues) => ({
        expandedTypes: typeValues,
      })),
  })
  allRecords.push(...w3cRecords)
}
```

Every `DcqlCredentialQuery` reaching this branch has `format === 'ldp_vc'`
(that's what put it in `formats`), so `c.format === 'jwt_vc_json'` is false
for all of them, `flatMap` always produces `[]`, and `$or: []` matches
nothing. A DCQL query that asks for an `ldp_vc` (W3C JSON-LD) credential by
type therefore never finds a matching credential in the wallet, even when
one is present and would otherwise satisfy the query.

Verified directly against upstream `main` at commit
`d80bc49a815d5fa8de11eb27955b55a24e091687` (2026-09-28) in a fresh, isolated
clone — the bug is present in the current codebase, not a stale reading.

## Why this is a real, general functional gap (not Keyring-specific)

This isn't specific to our wallet's usage pattern. `ldp_vc` is one of three
formats DCQL supports as first-class citizens (`jwt_vc_json`, `ldp_vc`,
`vc+sd-jwt`), and it's the only one of the three whose "query the wallet for
matching records" path is unconditionally broken — `jwt_vc_json` and
`vc+sd-jwt` both work correctly. Any verifier that issues a DCQL/OpenID4VP
request selecting credentials by W3C JSON-LD type, against a Credo-based
holder wallet, gets zero results back regardless of what's actually in the
wallet. That silently breaks presentation for an entire credential format,
which is a correctness bug in the library, not an integration detail.

We independently confirmed this is a real, live gap: **Keyring (this repo)
already carries this exact fix as a local patch**, applied because we hit it
in practice. Both `.yarn/patches/@credo-ts-core-npm-0.6.3-28b59086b0.patch`
and `.yarn/patches/@credo-ts-core-npm-0.7.1-pr-2704-20260909134930-b95d84ab27.patch`
contain the identical one-line change (`c.format === "jwt_vc_json"` →
`c.format === "ldp_vc"` in the `ldp_vc` branch), each with a `KEYRING PATCH`
comment describing the same root cause independently arrived at:

```
// KEYRING PATCH: upstream copy-pastes the jwt_vc_json branch's
// condition here (c.format === "jwt_vc_json"), so this $or filter
// is always empty for ldp_vc queries and no W3C JSON-LD credential
// is ever found — fixed to check ldp_vc, matching the branch it's in.
```

This candidate proposes upstreaming that same fix (independently re-derived
and re-verified against current `main`, not copied from the patch file)
so the local patch can eventually be retired.

## Fix

One-line change, nothing else in the file:

```diff
         // For LDP_VC we query the expanded types
         $or: dcqlQuery.credentials
-          .flatMap((c) => (c.format === 'jwt_vc_json' ? c.meta.type_values : []))
+          .flatMap((c) => (c.format === 'ldp_vc' ? c.meta.type_values : []))
           .map((typeValues) => ({
             expandedTypes: typeValues,
           })),
```

## Evidence it's safe

| Claim | Evidence |
|---|---|
| Bug reproduces on current upstream `main` | Confirmed by reading `DcqlService.ts` at commit `d80bc49a815d5fa8de11eb27955b55a24e091687` in a fresh clone before making any change |
| Fix matches an independent, production-tested local workaround | Byte-identical one-line change already carried in Keyring's own `@credo-ts/core` patches (two versions, both applying it against real usage) |
| New regression test fails without the fix | Added a test to `DcqlService.test.ts` that calls `queryCredentialsForDcqlQuery` directly with a mocked `AgentContext`/`dependencyManager` and asserts the `ldp_vc` `$or` is built from the `ldp_vc` query entry's `type_values`. Verified it fails (`$or: []`, matching the bug) when the one-line fix is reverted, and passes with the fix in place |
| No regressions in the surrounding suite | `packages/core/src/modules/dcql/__tests__/` (all 3 files, 47 tests) run via `vitest` from the repo root: 46 passed, 1 expected-fail (pre-existing, unrelated to this change) |
| Change is minimal and scoped | `git diff` touches exactly one line in `DcqlService.ts` (source) plus the added test; nothing else in the file changes |

Test commands used (pnpm, per the repo's `packageManager` field):

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm exec vitest run packages/core/src/modules/dcql/__tests__/
```

## Prior PRs in this neighborhood — neither one touches this line

Two merged PRs touch `DcqlService.ts`'s format-handling logic without fixing
this bug — worth flagging explicitly to a reviewer who might otherwise
assume this area was already gone over:

- **#2400** ("Dynamic VP format support not correctly mapping ldp_vc",
  merged 2025-09-04) — despite the title, its diff touches only
  `packages/openid4vc/src/openid4vc-verifier/OpenId4VpVerifierService.ts`
  and a changeset file. It never touches `DcqlService.ts` at all.
- **#2617** ("correctly extract authority of vc when verifying presentations
  against DCQL query", merged 2026-01-13) — this one does touch
  `DcqlService.ts`, including a comment-only fix two lines above the bug
  (`exapnded` → `expanded` in the `jwt_vc_json` branch's comment, line 128 in
  the pre-fix file), but its changes are all about computing `authority`
  (AKI values) for presentation credentials and getters — it never changes
  the `ldp_vc` branch's `$or` filter itself. Confirmed via `gh pr diff 2617`.

Neither PR is a near-miss that almost caught this; #2400 isn't in the right
file, and #2617 edits the adjacent comment and unrelated logic in the same
method without ever touching the actual filter line.

## Notes for our own review

- Kept intentionally lean: this is a one-line correctness fix with a direct
  regression test, not a design proposal, so there's no alternatives-considered
  section or open design questions.
- `git commit -s` sign-off and SSH commit signing were applied in the scratch
  clone per this repo's git conventions; the commit is not pushed anywhere.
