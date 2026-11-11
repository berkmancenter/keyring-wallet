# sedi/webs: verify-only did:webs key state

The phone fetches a State root's did:webs artifacts, replays the KEL with this package's own reader and verifier
(`../cesr`, `../guardian/kel.ts`: there is no second KEL verifier, as DBI plan Phase 2 requires), and checks that the
published `did.json` carries exactly the keys that KEL implies. It is the "go fetch it" step the Guardian check was
missing: `verifyGuardianWithWebs` reads each listed root's KEL from where the state publishes it, instead of from the
holder's presentation, so a holder cannot show the root's history cut short.

It is behind the state-verified approvers switch (and so the SEDI/KERI remote kill), like the Guardian check.

## One seam: `resolveRootKel(did)`

The Guardian check and the screens call only `resolveRootKel(did)` (`./rootKel.ts`), which returns the verified bytes
of the root's KEL, `{ ok: true, aid, kel }`, or a refusal. They never call `resolveWebs` directly. Ours is the
default, an **interim for the 2026-11-14 demo**. Alberto said yes (IN-665) to the VTI maintainer's TypeScript did:webs
resolver, for compatibility with the VTA/VTC work. It replaces ours with `setRootKelResolver(adapter)`, touching nothing
else; `null` restores ours. An adapter must return the exact keri.cesr bytes it verified.

Whatever resolver is behind the seam, the Guardian check replays those bytes again with this package's own reader
(`../guardian`, `build()`), so a resolver's answer is never the only check. That replay keeps its own limits: notably,
it refuses a KEL that declares witnesses (receipts are not read), even if the replacement accepted it. Reading receipts
in our replay comes before a witnessed state root can verify here.

On Who approves (`trust-tasks/guardianEvidence.ts`), each root a card names that has a `webs` DID on our list is
resolved at most once per open, however many cards name it. Nothing is kept past the open, so a failure is never
remembered. A root that does not resolve shows "Couldn't reach the state" (`stateNotResolved`, its own line), never
"Couldn't verify" and never the card's own copy.

## What it checks

1. The identifier: `did:webs:<host>[%3A<port>]:<path…>:<AID>`. Labels are Base64url/unreserved characters only, the AID
   is a qb64 primitive, and no URL is built from anything else.
2. Both artifacts, `https://<host>/<path…>/<AID>/keri.cesr` and `…/did.json`:
   - HTTPS only, never http;
   - no redirect: a 3xx, or a response served from another URL, is refused;
   - a timeout (10 s);
   - size caps: `did.json` 64 KiB, `keri.cesr` 512 KiB (about a thousand events);
   - a 2xx answer only.
3. Witnesses: a KEL that declares any (`bt` > 0 or a witness list) is refused as `witnessesUnsupported`, because this
   package does not read witness receipts yet.
4. The KEL replay, through `replayKel`: SAIDs, priors, pre-rotation, controller signatures, duplicity.
5. The AID: the KEL's prefix must be the DID's AID.
6. The published document, compared against the replayed keys, never trusted on its own:
   - it names this DID (or its did:web twin) as its subject;
   - it has exactly one JsonWebKey method per current key, and no other, with each JWK equal to the key's own (P-256 as
     DBI §5.1 has it: `kty` EC, `crv` P-256, uncompressed x/y; Ed25519 as OKP) and its `kid` the key's qb64;
   - its relationships reference only those keys;
   - `alsoKnownAs` may list did:keri only for this AID.

Every refusal has its own reason:

- `notWebs`
- `notHttps`
- `redirectRefused`
- `unreachable`
- `timeout`
- `tooLarge`
- `witnessesUnsupported`
- `unsupportedCesr`
- `malformedCesr`
- `kelNotReplaying`
- `aidMismatch`
- `didDocMismatch`
- `aliasMismatch`
- `switchedOff`

`verifyGuardianWithWebs` turns any of them into `stateNotResolved` and never falls back to a presented or stored copy.

## What it does not check (not a full did:webs resolver)

- **Designated-alias attestations.** The did:webs specification's resolver requires a valid, unrevoked
  designated-aliases ACDC, anchored in the KEL, that names the DID being resolved. Without it, resolution fails
  (affinidi-did-webs `resolver.rs`, step 3). This package does not read it. For our use this is not a trust gap: the
  trust anchor is the AID on the phone's own root list, and an AID is self-certifying wherever it is hosted. It does
  mean this is not a conformant did:webs resolver. Other aliases in `alsoKnownAs` are returned as `unverifiedAliases`,
  and nothing relies on them. The K0 root's KEL carries no such attestation, so a conformant resolver would refuse it
  today (see "Cross-check" below).
- **Witness receipts** (refused, above), and so no duplicity detection beyond the events served. "Valid" means "matches
  the history this host publishes", not "no one holds a newer one".
- `versionId` queries, delegated KELs (`dip`/`drt`), weighted thresholds, services, key agreement, designated key roles.
  A document carrying any of these is refused, never partly accepted.

## Fixtures

`../__tests__/fixtures/webs-k0-root.gen.mjs` writes the K0 root's two artifacts, laid out as a host serves them, under a
placeholder host (`did:webs:example.org:keyring-demo-state:<AID>`). Its JWK conversion is independent of
`document.ts` (straight from `@noble/curves`), so the committed `did.json` is a second derivation that the resolver's
own is checked against. Re-run it from `packages/core`; `git diff` on the output must be clean unless `kel-roy.cesr`
changed. When a real host is chosen, only the host label changes; the bytes a host must serve are those two files.

## Cross-check (not run on the MacBook)

affinidi-did-webs (affinidi-tdk-rs, `crates/identity/did-methods/did-webs`) has `resolve_from_artifacts(did,
keri_cesr, did_json)`, which verifies offline. Running it on the two fixture files is a conformance oracle.
**Expectation:** it refuses them today, because they have no designated-aliases attestation (above). The useful check
is that its KEL verification passes and its only objection is the missing attestation. To run (CI or a Linux box, not
the MacBook; it builds the Rust workspace):

    cd external/affinidi-tdk-rs/crates/identity/did-methods/did-webs
    # a scratch example that reads the two files and prints resolve_from_artifacts' result
