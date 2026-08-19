# Comment candidate — the extensibility argument for `eddsa-jcs-2022`, offered to cred-spec #18

*Status: **drafted, not posted**. Target: a comment on
[trustoverip/dtgwg-cred-spec#18](https://github.com/trustoverip/dtgwg-cred-spec/pull/18)
(Alberto's, open, updated 2026-08-18). **Nothing goes to an external repository
without review** — this is held for Alberto, whose PR it is.*

## Why a comment and not a commit

#18 already recommends `eddsa-jcs-2022` for DTG credentials and names `bbs-2023`
as the selective-disclosure path. The argument below **supports a conclusion the
PR already reached**; it does not change it. Pushing it into an open PR would
grow a review that is already in flight, for a rationale addition that loses
nothing by landing in a later revision. So it is offered as a comment, with a
suggestion that a future update fold it in if the editors find it useful.

The two arguments #18 makes are about *verification*: no `@context` resolution,
so credentials verify offline; and one canonicalization shared with
`digestMultibase`, so a digest and a proof cannot disagree. The argument below is
about *authoring* — what happens to a credential's own extension members — and it
has running evidence behind it.

## The comment, as drafted

> Adding a third argument for `eddsa-jcs-2022` that we measured this week, in
> case it is useful for a future revision — it supports the recommendation
> already in the PR rather than changing it, so it is offered here rather than
> as a commit.
>
> **Under RDF-canonicalized suites, credential members whose terms are not
> defined in the `@context` are not secured by the proof** — and this bites
> exactly where this specification invites extension.
>
> `witnessContext` is an open object: this specification defines `event`,
> `sessionId` and `method`, and issuers legitimately add more (we carry a
> locality-verification member for co-presence evidence). Under
> `eddsa-rdfc-2022` those additional members fail in one of two ways, and we hit
> both in a runnable trial:
>
> - **JSON-LD safe mode — which the Data Integrity signing path uses — refuses
>   to canonicalize the credential at all.** Loud, at signing time. Recoverable.
> - **With safe mode off, the members drop out of the RDF dataset entirely**,
>   producing **zero quads** while remaining in the JSON the holder sees and the
>   verifier reads. The credential verifies. The evidence in it was never
>   signed. Silent, and it is the mode that ships.
>
> The second is the one worth a sentence in the specification. A verifier
> checking such a credential gets a valid signature over a document that does
> not include the member it is relying on, and nothing in the artifact says so.
>
> `eddsa-jcs-2022` removes the failure mode rather than mitigating it: JCS
> canonicalizes the JSON, so an extension member is covered whether or not
> anyone remembered to define a term for it. For a credential specification that
> expects issuers to extend `witnessContext` — and that is heading toward
> richer evidence generally — that seems worth naming alongside the offline and
> digest-agreement arguments.
>
> Two things this does **not** argue:
>
> - It does not apply to the `bbs-2023` path, which is RDF-canonicalized. An
>   issuer producing the proof set this PR describes still needs term
>   definitions for anything it wants covered by the derivation base. If
>   anything that strengthens the case for stating the property explicitly,
>   since a proof set makes both regimes present in one credential.
> - It is not an argument against RDF canonicalization in general. It is an
>   argument that *extension members* are where it costs, and this
>   specification's extension points are the place a reader would want to be
>   told.
>
> Possible shape, if it is wanted later — a Security Considerations item rather
> than a change to Base Structure:
>
> > **Extension members and canonicalization.** Under RDF-canonicalized
> > cryptosuites, members whose terms are undefined in the credential's
> > `@context` are not part of the canonicalized dataset and are therefore not
> > secured by the proof, though they remain visible in the credential. Issuers
> > extending `witnessContext` or any other open object under such a suite MUST
> > define terms for every added member; issuers using `eddsa-jcs-2022` are not
> > exposed to this.
>
> Evidence: `tsp-reference/ref-06p-locality-binding` in the Keyring repository —
> act 6 runs both failure modes and the corrected case (23 checks). Happy to
> point at the exact assertions, or to open a follow-up PR with the wording
> above if you would rather have it as a diff.

## Evidence behind it

[`run.mjs`](./run.mjs) act 6, three assertions:

| Case | Result |
|---|---|
| Assertion members with **no** term definitions, safe mode (the signing path) | canonicalization **throws** — the credential cannot be signed |
| Same, safe mode off | **zero locality quads**; `ble-challenge-response` absent from the canonical form while present in the JSON |
| Terms defined | canonicalizes cleanly; members in the dataset; **one mutated value changes the canonical form** |

The term list this rung had to author to make the third case work is
[`fixtures/locality-context-terms.json`](./fixtures/locality-context-terms.json)
— eighteen definitions for one evidence member, which is itself the cost the
argument is about.

## Before posting

- [ ] Alberto reviews — it is his PR and his call whether a rationale addition
      helps or noises up an open review.
- [ ] Confirm the framing stays "supports what you already concluded". It must
      not read as a competing proposal.
- [ ] Decide whether to offer the Security Considerations wording as a
      follow-up PR or leave it as a comment for the editors to take or drop.
