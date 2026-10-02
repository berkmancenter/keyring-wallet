# Issue candidate: credo-ts

Draft only — not filed. Nothing here is to be posted to GitHub without separate explicit approval.

---

## Title

DIDComm JSON-LD credential issuance still can't accept a VC 2.0 credential (`W3cCredential` requires the 1.1 shape)

## Body

### Summary

The DIDComm `jsonld` credential-issuance format (issue-credential v2, `aries/ld-proof-vc-detail@v1.0` / `aries/ld-proof-vc@v1.0`) cannot issue, request, accept, or process a W3C VC Data Model **2.0** JSON-LD credential at all. Every credential that passes through `DidCommJsonLdCredentialFormatService` is parsed with the 1.1-only `W3cCredential` model, and that model rejects a 2.0-shaped credential outright — independent of whether the signature suite underneath (Data Integrity, Ed25519Signature2018, etc.) would otherwise handle it fine.

This isn't a matter of missing a feature flag; two concrete validation rules in `@credo-ts/core` reject the 2.0 shape before anything else runs:

1. **`packages/core/src/modules/vc/validators.ts`, `IsCredentialJsonLdContext`** — with no `credentialContext` override (which is how `W3cCredential.context` uses it), it hardcodes `value[0] !== CREDENTIALS_CONTEXT_V1_URL` as a rejection. A VC 2.0 credential's first `@context` entry is `https://www.w3.org/ns/credentials/v2`, so it fails immediately.
2. **`packages/core/src/modules/vc/models/credential/W3cCredential.ts`** — `issuanceDate` is a required, non-optional property (`@IsRFC3339()` with no `@IsOptional()`). VC 2.0 replaced `issuanceDate`/`expirationDate` with `validFrom`/`validUntil`, so a spec-conformant 2.0 credential fails validation for lacking a field 2.0 doesn't have.

`packages/didcomm/src/modules/credentials/formats/jsonld/DidCommJsonLdCredentialFormatService.ts` never touches the newer `W3cV2*` model classes at all — every credential-detail parse and every request/offer/proposal validation goes through `JsonTransformer.fromJSON(..., W3cCredential)` (used in `acceptRequest`, `deriveVerificationMethod`), and the received-credential path uses `W3cJsonLdVerifiableCredential` (`processCredential`). Both are entirely on the 1.1 side of the codebase.

Re-verified directly against `openwallet-foundation/credo-ts@main` on 2026-09-29 — both files are still in exactly this state; nothing has changed here since this was first reported (see "Related" below).

### Why this isn't already covered by the VC 2.0 work

`#2827` ("feat(vc2): implement VC 2.0 support", merged 2026-09-04) added full, spec-compliant VC 2.0 support — but as a parallel model (`W3cV2CredentialService`, `W3cV2JsonCredential`/`W3cV2VerifiableCredential`, new JSON-LD context bundles, JWT/SD-JWT/DI routing) that the DIDComm JSON-LD format service never calls into. The PR's own description explicitly scopes this path out, under its "DCQL, PEX, OIDC" section:

> Guards and hardening for `di_*` paths because not yet supported.

`#2704` ("feat: initial DIDComm V2 support", still open) is the other PR that might plausibly touch this — confirmed it does not: its changed-files list (282 files) contains no match for `W3cCredential.ts` or `DidCommJsonLdCredentialFormatService.ts`. Its scope is the DIDComm protocol-version negotiation, not the credential model.

So as of today, there is no code path — old or new — that lets a VC 2.0 credential travel through DIDComm's `jsonld` issue-credential format.

### Related — this was already reported once

We (this is a second report from the same team) opened `#2864` ("Support VCDM 2.0 credentials in the DIDComm JSON-LD credential format (W3cCredential model)") on 2026-07-08, describing this identical gap and the identical two blockers above. It received no maintainer response and was self-closed as `not_planned` by its author 25 minutes after opening.

That report predates `#2827`'s merge by about two months. We think it's worth re-raising now because `#2827` gives concrete, maintainer-authored confirmation that this exact path (`di_*` / non-enveloped JSON-LD credentials through paths like DIDComm) was a deliberate, known scope cut rather than an oversight — which changes the question from "is this a bug" to "which of two shapes should the fix take." We'd rather ask that directly than silently re-file. Whoever triages this should feel free to close this as a duplicate of `#2864` and reopen that one instead, if that's the cleaner path — we don't have a preference on which issue number survives.

### What we did locally (a workaround, not a proposed fix)

We patch `@credo-ts/core` (currently pinned via `patch:` at `0.7.1-pr-2704-...`) with two small changes, both confined to `packages/core/src/modules/vc/`:

- `validators.ts`: `IsCredentialJsonLdContext` accepts `https://www.w3.org/ns/credentials/v2` as an additional valid first `@context` entry, but **only** when the caller is using the default v1 `credentialContext` (i.e. this doesn't loosen validation for callers who explicitly pinned a different expected context).
- `models/credential/W3cCredential.ts`: `issuanceDate` gets `@IsOptional()` added alongside its existing `@IsRFC3339()`, on both the class property and the constructor options interface.

No changes to `@credo-ts/didcomm` were needed for this — `DidCommJsonLdCredentialFormatService` already delegates entirely to `W3cCredential`/`W3cJsonLdVerifiableCredential`, so once that model tolerates the 2.0 shape, the existing DIDComm call sites pick it up for free.

With this in place, plus a document loader that serves the v2 context offline, the full DIDComm issue-credential v2 flow (offer → request → issue → ack) works end-to-end for VC 2.0 Data Integrity credentials, verified two-device (Android emulator + iOS simulator). 1.1 credentials keep working unchanged.

We're explicitly **not** presenting this as "here's the fix, merge it." It's the minimal change that makes the *old* model tolerate the *new* shape, which is a different design choice than routing this path through `W3cV2*` the way `#2827` did for JWT/SD-JWT/DI elsewhere, and we don't think that choice is ours to make.

### Question for maintainers

Which fix shape would you want here?

- **(a)** Make `W3cCredential` (and the validators it uses) tolerant of a VC 2.0 shape, roughly as our patch above does — keeps one model, adds conditional acceptance.
- **(b)** Teach `DidCommJsonLdCredentialFormatService` to dispatch VC 2.0 credentials to `W3cV2*` (dual-dispatch based on detected `@context`/shape), consistent with how `#2827` handled routing for the enveloped formats.

Happy to share our patch (`.yarn/patches`, diff form) as a reference or starting point if that's useful — it's a workaround shaped for our own constraints, not something we're asking to be merged as-is.

### Environment

- `@credo-ts/core` / `@credo-ts/didcomm`, current `main` as of 2026-09-29 (also reproduced against the `0.7.1`-based build we track, which includes `#2704`)
