# Constraints — DTG Core Credentials, Working Draft 0.4.0

Quotes and citations only. **No design.** The design that satisfies these lives
in [`../vsc-migration-plan.md`](../vsc-migration-plan.md); this file exists so
that conformance can be checked without re-reading the source specification, and
so that the design half can churn while this half stays stable
([`../CLAUDE.md`](../CLAUDE.md), "Citing external specifications").

**Source.** `trustoverip/dtgwg-cred-spec`, **Document Status `Working Draft 0.4.0`**,
`_Version:_ 1.0` (`spec/header.md`). Read at commit **`994a3d63`** (2026-09-15,
"Adopt semantic versioning for Document Status, distinct from Version (#54)"),
which is **28 commits ahead of `external/`'s pin `b89f389`**. The pin is not
advanced by this document — see the plan's Baseline for why, and
[`scripts/openvtc/README.md`](../../../scripts/openvtc/README.md) for the policy.

Reproduce every quote below with:

```sh
git -C external/dtgwg-cred-spec show 994a3d63:spec/body.md
git -C external/dtgwg-cred-spec show 994a3d63:spec/header.md
git -C external/dtgwg-cred-spec show 994a3d63:spec/intro.md
git -C external/dtgwg-cred-spec show 994a3d63:spec/terms-definitions/verifiable_witness_credential.md
```

Section names, not ordinals, per the citation rule. Line numbers are given for
`spec/body.md` at `994a3d63` only, as a convenience; they are not stable.

---

## C1 — The VWC is no longer a credential type

> **Editor's note — this Working Draft.** The VSC replaces the concrete
> `EndorsementCredential` and `WitnessCredential` subtypes of Working Draft 02,
> which are now the `dtg:endorses` and `dtg:witnessed` profiles below. The names
> VEC and VWC are retained for those profiles. **The type strings
> `EndorsementCredential` and `WitnessCredential` are not retained:** a VSC
> carries exactly one channel of meaning, its `predicate`, so that a type string
> and a predicate can never disagree.

— *VSC (Verifiable Statement Credential)*, `spec/body.md:861`

Glossary, `spec/terms-definitions/verifiable_witness_credential.md`:

> A [[ref: VSC]] under the `dtg:witnessed` predicate profile, by which a third
> party issues a verifiable assertion that it observed a DTG edge — represented
> by a [[ref: VRC]] or a [[ref: VMC]] — being formed.

**The name VWC survives; the type string does not.** Prose, comments, file names
and identifiers that say "VWC" remain correct. Only the wire changes.

---

## C2 — The VSC schema

> - `type` (array, REQUIRED): MUST include `"StatementCredential"` and MUST NOT
>   include any other concrete `DTGCredential` subtype. The predicate, not the
>   type array, identifies the profile.
> - `issuer` (string, REQUIRED): DID of the party making the statement. Its
>   [[ref: correlation scope]] is declared by the holder; a profile MAY state the
>   minimum scope its issuer can truthfully declare […]
> - `taskContext` (string, OPTIONAL unless the profile requires it) […]
> - `credentialSubject` (object, REQUIRED):
>   - `id` (string, REQUIRED): DID of the [[ref: DTG node]] the statement is about
>   - `predicate` (string, REQUIRED): the term that fixes the statement's meaning,
>     expressed as an absolute IRI […] **Compact forms (CURIEs, JSON-LD terms) are
>     not permitted on the wire**, so that a predicate has exactly one
>     representation and matching it never depends on context processing […]
>   - `object` (object, REQUIRED): what the statement says about the subject,
>     **carrying exactly one of**:
>     - `id` (string): a DID or other IRI, when the object is a party or a named thing
>     - `digestMultibase` (string): when the object is another credential […]
>     - `value` (any): a literal or structured payload […]
>   - further members as the profile defines

— *VSC (Verifiable Statement Credential)*, `spec/body.md:880-890`

> A VSC is **unilateral**: its issuer alone signs it, and it is complete without
> any counterparty's participation.

— ibid., `spec/body.md:892`

`taskContext` is a **top-level member of the credential**, a sibling of
`credentialSubject`, not a member of it:

> - `taskContext` (string, OPTIONAL unless a credential type requires it):
>   identifier (`threadId`) of the trust task exchange in which this credential
>   was issued.

— *Base Structure*, `spec/body.md:330` (listed between `credentialSubject` and `proof`)

---

## C3 — Base Structure `@context` and `type`

> - `@context` (array, REQUIRED): MUST include `"https://www.w3.org/ns/credentials/v2"`
>   and **`"https://firstperson.network/credentials/dtg/v1"`**, plus any
>   additional contexts required by the proof type
> - `type` (array, REQUIRED): MUST include `"VerifiableCredential"`,
>   `"DTGCredential"`, and **exactly one** concrete subtype

— *Base Structure*, `spec/body.md:322-323`

The DTG `@context` at that URL **is not published**:

> **Editor's note — context terms.** The DTG `@context` is not yet published (see
> the editor's note in *Declaring scope*). When it is, `predicate` is expected to
> be defined with `"@type": "@id"` […]; `object.value` with `"@type": "@json"`
> […]; and `object.id` as the node identifier it is. **Until the context is
> published, verifiers apply *Predicate Handling* to the `predicate` value as
> written.**

— *Statements in the Graph*, `spec/body.md:957`

---

## C4 — Predicate Handling (the verifier's algorithm)

> A predicate is an identifier, and it is matched as one. A verifier MUST process
> `predicate` as follows:
>
> 1. If the value is **not an absolute IRI**, the verifier MUST reject the
>    credential. No expansion is performed: a compact form is malformed, not
>    unknown.
> 2. If the IRI is **not a term in a vocabulary the verifier accepts**, the
>    verifier MUST reject the credential. The set of accepted vocabularies is the
>    **verifier's configuration**, informed by the governance frameworks and trust
>    registries it relies on. **It is never derived from the credential.**
> 3. Otherwise, apply the constraints of the predicate's profile, which the
>    verifier holds as part of the same configuration.
>
> Because the value is matched as written, this procedure needs **neither the
> credential's `@context` nor a JSON-LD processor**, and gives the same result
> under every securing mechanism.

— *Predicate Handling*, `spec/body.md:900-903`

> **Rejection is the only conforming outcome for an unrecognized predicate.** A
> verifier MUST NOT process such a credential as a generic statement, MUST NOT
> infer meaning from the predicate's spelling, and MUST NOT accept a predicate on
> the strength of an equivalence (`owl:sameAs`, `skos:exactMatch`, or any similar
> assertion) published by anyone.

— ibid., `spec/body.md:906`

> - A predicate IRI MUST be in **Unicode Normalization Form C** […] Two predicates
>   that render identically but differ as byte strings are two predicates.
> - A predicate IRI MUST resolve to its definition […] **Resolution is for the
>   parties configuring a verifier, not for the verifier at verification time**: a
>   verifier MUST NOT need to dereference a predicate in order to verify a
>   credential […]
> - A published predicate MUST NOT change meaning. A vocabulary is additive […]
>   **adding a term leaves every other term's IRI untouched, so the namespace
>   carries no version segment.** A JSON-LD `@context` that credentials list MUST
>   NOT change once published; additions to it are made under a new context
>   version IRI.

— ibid., `spec/body.md:910-913`

---

## C5 — The `dtg:witnessed` profile

> **Predicate:** `dtg:witnessed`
> (`https://firstperson.network/credentials/dtg/v1#witnessed`) — the issuer
> attests that it observed the subject issue the credential the object names,
> under the conditions of a specific trust task exchange.

— *The `dtg:witnessed` Profile (VWC)*, `spec/body.md:1000`

> - **Classification:** evidence, weighed by the community whose witnessing policy
>   the attestation is issued under.
> - **Object:** `digestMultibase` — the witnessed edge credential, computed over
>   that credential **excluding its top-level `proof` member** and encoded as
>   specified in *Digest Encoding*.
> - **Subject–object relationship:** […] `credentialSubject.id` **MUST** be the
>   DID of that credential's `issuer`, and a verifier holding the referenced
>   credential **MUST check that it is**. […]
> - **Additional members:**
>   - `witnessContext` (object, OPTIONAL): context of the witnessing event
>     - `event` (string, OPTIONAL): human-readable event name
>     - `sessionId` (string, OPTIONAL): session or nonce identifier
>     - `method` (string, OPTIONAL): verification method used
> - **`taskContext`:** REQUIRED.
> - **Issuer scope:** `directed` at minimum. […]
> - **Issuer:** a member, or a [[ref: VTA]] acting according to VTC policy.

— ibid., `spec/body.md:1008-1020`

> - **Verification establishes:** that the issuer attests that, in the exchange
>   identified by `taskContext`, it observed the subject issue the credential whose
>   claims digest to `object.digestMultibase`.
> - **Verification does not establish:** that the referenced credential is
>   currently valid or unrevoked […]; that the referenced credential's claims are
>   true; **that the exchange reached its terminal state, which requires the outcome
>   evidence of *Outcome Interpretability***; that the witness is a member of any
>   community; or that any consequential action is authorized.

— ibid., `spec/body.md:1019-1020`

> A witnessed exchange of a complete [[ref: DTG edge]] is bidirectional […] For
> such exchanges the witness **SHOULD issue one VWC per direction**.

— ibid., `spec/body.md:1004`

> A VWC's `credentialSubject.id` and `taskContext` alone identify only the observed
> party and the trust task exchange, **not the edge being witnessed**. Binding a
> VWC to a specific edge therefore requires `object.digestMultibase` […] This
> binding is only as strong as the verifier's access to that credential — a digest
> without the referenced credential to hand is an opaque hash, not an identified
> edge. Issuers and holders presenting a VWC as evidence of a specific edge SHOULD
> make the referenced edge credential available alongside it.

— ibid., `spec/body.md:1006`

**What changed from WD02**, in the spec's own words:

> **Editor's note — direction binding.** In WD02 the requirement that the subject
> be the issuer of the referenced credential was stated **only for bidirectional
> exchanges** […] **This profile makes it unconditional**, because the condition is
> not in the credential […] The other normative content of the WD02 VWC section is
> **carried over unchanged**: one VWC per direction, `taskContext` REQUIRED,
> `directed` minimum scope, making the referenced credential available, and the
> outcome-evidence obligation of *Outcome Interpretability*, which applied to the
> VWC before and is not narrowed by its becoming a profile.

— ibid., `spec/body.md:1022`

---

## C6 — Digest Encoding

> A digest value MUST be produced as follows:
>
> 1. Take the referenced credential's JSON representation **excluding its
>    top-level `proof` member**, and canonicalize it with the JSON Canonicalization
>    Scheme (JCS, RFC 8785). Excluding the proof means a digest binds to the
>    credential's claims rather than to one signature over them, so a re-proofed
>    credential carrying identical claims still satisfies an existing reference.
> 2. Compute the **SHA-256** hash of the resulting UTF-8 bytes.
> 3. Form a **Multihash** value by prefixing the digest with the `sha2-256`
>    algorithm header (`0x12`) and the digest length in bytes (`0x20`), each
>    encoded as a varint […]
> 4. Encode the resulting 34 bytes with the **base-58-btc** alphabet and prefix
>    the **Multibase** header `z` […]

— *Digest Encoding*, `spec/body.md:398-401`

> Issuers MUST use base-58-btc so that a single canonical form exists for any given
> digest. **Verifiers MUST NOT rely on string comparison** to determine whether two
> digest values refer to the same credential: a conforming verifier decodes the
> Multibase value, decodes the Multihash to recover the algorithm identifier and
> the raw digest, and **compares those**.

— ibid., `spec/body.md:409`

> Verifiers MUST reject a digest whose Multihash identifies an algorithm they do
> not accept, rather than treating it as a mismatch.

— ibid., `spec/body.md:411`

A digest of the empty string, given as a worked value:

```
zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n
```

---

## C7 — Trust task binding and outcome evidence

> A credential whose meaning depends on a trust task completing MUST carry a
> `taskContext` property containing the `threadId` of the originating trust task
> exchange. **This requirement is a property of the credential type, not a
> per-issuer choice** […]

— *The `taskContext` Property*, `spec/body.md:1527`

> A verifier MUST NOT interpret a `taskContext`-bearing credential as proof that
> the associated trust task or ceremony completed **unless the matching trust task
> outcome evidence is also present and verified**. That outcome evidence MUST be
> reachable by the verifier — either it travels with the presentation, or the
> `taskContext` value enables the verifier to locate it.

— *Outcome Interpretability*, `spec/body.md:1535`

> **Minimum compatible version:** […] As of this release, that is Document Status
> **`0.4.0`** of the Trust Tasks specification, currently a Working Draft — the
> version at which that specification defined how an external citation, such as
> this one, binds to the document it names.

— *Credentials versus Trust Task Artifacts*, `spec/body.md:1523`

---

## C8 — What a VSC never establishes (the type-level bound)

> **The type-level bound.** A VSC attests; it never establishes. Whatever its
> predicate says, a verifier MUST NOT treat a VSC as conferring representation,
> authority, membership, admission, or a governed status such as personhood, and
> MUST NOT treat it as proof that a trust task or ceremony completed. […] **A
> predicate named `mayActFor` is a string.**

— *What Verification Establishes*, `spec/body.md:921`

> A profile classifies a statement's shape. **It does not narrow any obligation
> that applies to a DTG credential independently of its type**: the `taskContext`
> and outcome-evidence requirements […], the correlation scope requirements, and
> the status and validity checks of *Security Considerations* all apply to a VSC
> exactly as they apply to a concrete subtype.

— ibid., `spec/body.md:924`

---

## C9 — Statements keep their attribution

> A VSC's issuer is part of the statement. An implementation that assembles VSCs
> into a graph — for display, for query, or as input to a governance decision —
> MUST keep **each credential as the unit of attribution**, so that no statement
> about a node is ever separated from the identifier that made it and the proof
> that supports it. **Flattening statements into bare subject–predicate–object
> facts is not a conforming representation of the DTG.**

— *Statements in the Graph*, `spec/body.md:953`

---

## C10 — Predicate Profiles: the nine members a profile MUST state

> A profile MUST state:
>
> 1. the predicate IRI and its meaning, with `rdfs:label` values in the languages
>    the defining community uses;
> 2. whether the statement is **evidence** […] or an **assertion of status** […];
> 3. which `object` kind or kinds are permitted, and for `value` the schema of the
>    payload;
> 4. any relationship required between subject, object and issuer […];
> 5. any additional `credentialSubject` members, whether each is REQUIRED or
>    OPTIONAL, and its schema. **A verifier MUST ignore additional members a
>    profile does not define**, so that a profile can add optional members without
>    invalidating credentials for older verifiers; strictness lives in the
>    predicate, not in the payload;
> 6. whether `taskContext` is REQUIRED;
> 7. the minimum correlation scope the issuer can truthfully declare, if the
>    predicate constrains it;
> 8. who may issue the statement […];
> 9. **what successful verification establishes, and what it explicitly does not.**

— *Predicate Profiles*, `spec/body.md:932-940`

> A [[ref: VTC]] or [[ref: VTN]] MAY define profiles for predicates **in a
> namespace it controls**, in its governance framework or in a vocabulary document
> that framework references.

— ibid., `spec/body.md:930`

---

## C11 — The vocabulary registry does not exist yet

> **Editor's note — where profiles live.** This specification defines the mechanism
> above and, for this Working Draft, the two core profiles that replace the WD02
> VEC and VWC sections […] Profiles for further predicates are defined in the **DTG
> Predicate Vocabulary**, a repo-driven registry on the model of the ToIP glossary
> rather than a specification […] governed by pull request under stated admission
> criteria, on its own cadence (see *Related Specifications* and issue #52). **The
> two core profiles move there once it has a release. Nothing on the wire changes
> when a profile's text moves**: the predicate IRIs live in the DTG namespace
> either way.
>
> […] **Admission is a convenience, not a gate**: because a predicate is an
> absolute IRI that a verifier accepts by configuration, a community that publishes
> a predicate under a namespace it controls can issue under it, and verifiers can
> accept it, **without waiting on or ever seeking admission to the registry**.

— *Predicate Profiles*, `spec/body.md:947`

> - **DTG Predicate Vocabulary** *(planned)* — a repo-driven registry rather than a
>   specification […] **None has been published yet**; this section will be updated
>   with references as they become available.

— *Related Specifications*, `spec/intro.md`

**Verified absent.** `gh repo list trustoverip --limit 100` on 2026-09-16 returns
sixteen `dtgwg-*` repositories; `dtgwg-predicate-vocab` is not among them.

---

## C12 — The namespace is a placeholder and will change

> **Notation.** In this document `dtg:` abbreviates the DTG namespace
> `https://firstperson.network/credentials/dtg/v1#` […] This is documentation
> notation only; **on the wire a predicate is always the absolute IRI. The
> namespace shown is a placeholder**: its home is decided in issue #48, and **the
> final form carries no version segment**, since predicate IRIs are compared
> byte-exact and must not change when a term is added (see issue #52).

— *VSC (Verifiable Statement Credential)*, `spec/body.md:863`

`trustoverip/dtgwg-cred-spec` **[#48](https://github.com/trustoverip/dtgwg-cred-spec/issues/48)**,
*"Decide the home of the DTG namespace before the Implementers Draft"* (OPEN as of 2026-09-16):

> Changing the namespace later is a find-and-replace in the spec but a **migration
> for every credential issued under it**: a predicate IRI is compared byte-exact
> […] That cost is zero today and grows with every issued credential. **This should
> be settled as soon as possible, and at the latest before the specification bumps
> to an Implementers Draft** […]
>
> The same question applies to the `@context` IRI itself, which Base Structure
> already requires and which **is not yet published either**; the two should be
> decided together.

Its two options: keep `https://firstperson.network/credentials/dtg/v1#`, or move
to a ToIP-controlled origin.

---

## C13 — The registry's published shape, as proposed

`trustoverip/dtgwg-cred-spec` **[#52](https://github.com/trustoverip/dtgwg-cred-spec/issues/52)**,
*"Create the DTG predicate vocabulary as a repo-driven registry"* (OPEN as of
2026-09-16). It specifies the repository layout, the per-predicate definition
format, and the generated artifacts. The two that a verifier consumes:

> | `accept-list.json` | verifiers | the active IRIs with their machine-checkable
> constraints (object kinds, `taskContextRequired`, minimum scope, schema URLs),
> for import into verifier configuration **at configuration time** |
> | `context/v1.jsonld` | credentials under core profiles | the JSON-LD terms for
> additional members such as `witnessContext`; **frozen per version**, as VC
> contexts must be |

An `accept-list.json` entry, quoted verbatim from the issue:

```json
{
  "https://trustoverip.org/dtg/vocab#witnessed": {
    "status": "active",
    "objectKind": ["digestMultibase"],
    "taskContextRequired": true,
    "minimumIssuerScope": "directed",
    "additionalMembers": { "witnessContext": { "required": false } }
  }
}
```

And the `witnessed` predicate definition file, verbatim:

```json
{
  "@context": "https://trustoverip.org/dtg/vocab/meta-context.jsonld",
  "id": "https://trustoverip.org/dtg/vocab#witnessed",
  "type": "Predicate",
  "status": "active",
  "since": "2026-10-01",
  "label": { "en": "witnessed", "de": "bezeugt", "nl": "getuige geweest van" },
  "definition": {
    "en": "The issuer observed the subject issue the credential the object names, under the conditions of a specific trust task exchange."
  },
  "classification": "evidence",
  "weighedBy": "The community whose witnessing policy the attestation is issued under.",
  "objectKind": ["digestMultibase"],
  "subjectObjectRelationship": "credentialSubject.id MUST be the issuer of the credential object.digestMultibase names; a verifier holding that credential MUST check it.",
  "additionalMembers": {
    "witnessContext": {
      "required": false,
      "schema": "https://trustoverip.org/dtg/vocab/schemas/witness-context.schema.json"
    }
  },
  "taskContextRequired": true,
  "minimumIssuerScope": "directed",
  "issuer": "A member, or a VTA acting according to VTC policy.",
  "establishes": "That the issuer attests that, in the exchange identified by taskContext, it observed the subject issue the credential whose claims digest to object.digestMultibase.",
  "doesNotEstablish": [
    "that the referenced credential is currently valid or unrevoked",
    "that the referenced credential's claims are true",
    "that the exchange reached its terminal state (Outcome Interpretability applies)",
    "that the witness is a member of any community",
    "that any consequential action is authorized"
  ],
  "definedIn": "https://trustoverip.github.io/dtgwg-cred-spec/#the-dtgwitnessed-profile-vwc",
  "governedBy": null
}
```

The IRIs in #52 are themselves placeholders pending #48 — the issue says so:
*"Assumption for this issue: ToIP is amenable to hosting the namespace and the
published artifacts, at least for now. The IRIs below are placeholders until #48
is decided."* **The two artifacts' *shapes* are stable; their *IRIs* are not.**

Two governance statements the plan relies on:

> **Predicate IRIs are unversioned and term-immutable.** […] So the namespace IRI
> decided in #48 **must carry no version segment**. The current placeholder in #47
> (`https://firstperson.network/credentials/dtg/v1#witnessed`) has one and should
> not be the final form.

> **Not a gate.** The registry curates a shared, trusted default set; it does not
> decide who may define or use a predicate. […] a community that publishes a
> predicate under a namespace it controls can issue under it, and verifiers can
> accept it, **without waiting on or ever seeking admission here**.

---

## C14 — Correlation scope does not bind yet

The `dtg:witnessed` profile requires `directed` as the issuer's minimum scope
(C5). That requirement is **not actionable at this Document Status**, because the
property that would carry a declaration has no name:

> **Editor's note:** The property that carries the declaration, and its `@context`
> term, **are not yet named**. Until they are, the requirements of this section
> **bind a declaration that has been made and do not require one**; the examples
> in this specification carry no declaration.

— *Declaring scope*, `spec/body.md:309`

> - A declaration is a property of the identifier, not of a credential. **All
>   credentials issued under one identifier MUST declare the same scope**; a
>   contradiction between two of them falsifies the declaration […]
> - […] for [[ref: VPCs]], [[ref: VICs]] and [[ref: VSCs]] **no credential declares
>   the subject's scope at all.**

— ibid., `spec/body.md:299-306`

---

## C15 — Version compatibility obligations

> A holder or verifier conformant to Document Status `M.N` MUST accept a credential
> issued under any earlier Document Status `M.K` where `K ≤ N`, and **SHOULD accept
> a credential carrying an OPTIONAL property it does not recognize** […] rather
> than rejecting the credential solely for that property's presence.

— *Compatibility Rules*, `spec/body.md`

> This specification does not currently embed its own version number in a
> credential's `@context` or `type`; a MAJOR revision is expected to be accompanied
> by a new `@context` version so that a credential issued under incompatible
> semantics is also structurally distinguishable, **but until that mechanism is
> defined, a verifier implementing one MAJOR version MUST NOT assume it can safely
> interpret a credential issued under a different one.**

— ibid.

Note the asymmetry this creates for us: WD02's `WitnessCredential` and WD 0.4.0's
`StatementCredential` are **structurally distinguishable by their `type` arrays**,
which is what makes a dual-read window implementable at all.

---

## C16 — The worked example the spec gives

Reproduced verbatim from *The `dtg:witnessed` Profile (VWC)*, `spec/body.md:1029-1052`,
as the target shape:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://firstperson.network/credentials/dtg/v1",
    "https://w3id.org/security/suites/ed25519-2020/v1"
  ],
  "type": ["VerifiableCredential", "DTGCredential", "StatementCredential"],
  "issuer": "did:webvh:QmVzTd9hRkPqLu4WgXyN...:witness-service.example",
  "validFrom": "2026-01-06T10:00:00Z",
  "taskContext": "thread-abc-123",
  "credentialSubject": {
    "id": "did:key:z6MkpTHR8VNs...",
    "predicate": "https://firstperson.network/credentials/dtg/v1#witnessed",
    "object": {
      "digestMultibase": "zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n"
    },
    "witnessContext": {
      "event": "EthDenver 2024",
      "sessionId": "session-abc-123",
      "method": "in-person-proximity"
    }
  },
  "proof": { "//": "..." }
}
```
