# ref-07c-predicate-coverage

Does the signature on a DTG credential actually cover its **predicate**?

[cred-spec #45](https://github.com/trustoverip/dtgwg-cred-spec/issues/45) proposes a
generic `StatementCredential` carrying a subject, a predicate term and an object,
with per-predicate **profiles** replacing per-predicate credential types. Its open
question 2 asks whether the predicate should be *"an IRI or a CURIE resolvable
through the DTG JSON-LD context"* or *"a plain string namespaced by the governing
community"*.

This rung answers that by measurement, using the two proof suites Keyring ships.

```sh
npm install && node run.mjs
```

No network. Deterministic keys. Six checks, all computed in-run.

## Why Keyring can answer this

Both suites a Keyring VWC is ever signed with are **RDF-canonicalized**:
`witness-server` mirrors the observed VRC's proof family
(`WitnessService.ts:274`), giving either `Ed25519Signature2018` or
`DataIntegrityProof`/`eddsa-rdfc-2022`. Both run JSON-LD expansion before hashing,
so **only members that expand to quads are covered by the signature**. The
contexts used here are the real shipped bytes from `@bifold/vrc-contexts` — the
same file the app signs with — plus one rung-local extension for the #45 terms
(`fixtures/statement-context-terms.json`). The shipped context is never edited:
it is bundled into the app and hot-reloaded from source in dev, so a byte-level
change there changes what the wallet signs. Same discipline `ref-06p` used.

## What it proves

**Check 0 — the control.** A predicate whose term resolves (`dtg:witnessed`)
contributes a quad and is tamper-evident: swapping it for `dtg:endorses` breaks
the signature. This is the case the spec intends, and it works.

**Check 1 — an unresolved prefix does not fail; it silently becomes a URI
scheme.** The hypothesis going in was that an unregistered CURIE would drop to
zero quads. It does not. `example:observedDocument` is a syntactically valid
absolute IRI whose *scheme* is `example`, so JSON-LD keeps it verbatim and the
credential is signed and tamper-evident — over an IRI its author did not mean.
Worse, the same bytes read by a verifier holding a context that **does** map
`example:` expand to `https://acme.example/vocab#observedDocument` instead. One
credential, two meanings, both signatures valid, and no way for either verifier
to know which was intended:

```
without the community context:  <example:observedDocument>
with it:                        <https://acme.example/vocab#observedDocument>
```

**Check 2 — the plain-string option is not signed at all.** `acme-observedDocument`
is neither an IRI nor a resolvable CURIE; under `@vocab` typing it expands to
**zero quads**. JSON-LD safe mode — which the Keyring DI signing path uses —
catches this one at signing time. It does **not** catch Check 1's case, because
nothing was dropped there.

**Check 3 — the consequence.** With safe mode off (what a lax verifier does), a
plain-string predicate can be replaced by its own negation and the signature still
verifies. `acme-observedDocument` → `acme-didNotObserveDocument`, byte-identical
canonical N-Quads, signature intact.

**Check 4 — member by member, what is actually in the signed dataset.**

| Member | Covered? | Why |
|---|---|---|
| `object.digestMultibase` | **signed** | defined by `credentials/v2` itself, and `@protected` |
| `predicate` (`dtg:witnessed`) | **signed** | term in the statement context |
| `witnessContext.event` | **signed** | term in the shipped Keyring context |
| `witnessContext.localityVerification.challenge` | **not signed** | no term, one level below a defined one |
| `observationContext.documentType` | **not signed** | no term — the shape a community profile adds |

The `digestMultibase` result is good news for #45 and was a surprise: the base
context already defines it (`security#digestMultibase`, typed `security#multibase`)
and **protects** it, so `object.digestMultibase` inherits a working standard
definition and cannot be redefined by anyone. Attempting to redefine it is a fatal
JSON-LD error — which is how this rung found out.

The last two rows are the cost of #45's profile mechanism as written: a profile
that "defines required and optional additional members" is defining members that
are unsigned until someone also writes their terms.

**Check 5 — `eddsa-jcs-2022` closes all of it.** The same predicate swap and the
same untermed-profile-member mutation both break a JCS signature. JCS covers every
member with no vocabulary at all. This is the second half of the proof set in
[cred-spec PR #18](https://github.com/trustoverip/dtgwg-cred-spec/pull/18).

**Check 6 — the fail-closed rule's stated justification names a mechanism that
does not exist.** The 2026-09-09 proposal on #45 says:

> a verifier MUST reject a statement credential whose `predicate` does not expand
> to an absolute IRI in a vocabulary it accepts. This matters because the VC 2.0
> base context sets `@vocab` to the issuer-dependent namespace, so an undefined
> `acme:` prefix doesn't error — it silently expands to
> `…/issuer-dependent#acme:mayActFor`.

The rule is right; the reason is not. The `credentials/v2` context defines **no
`@vocab`**, and the string `issuer-dependent` appears nowhere in it — verified
against both `https://www.w3.org/ns/credentials/v2` as served and
`w3c/vc-data-model` `contexts/credentials/v2` on GitHub, which are byte-identical
to each other **and to the copy Keyring bundles**. Geoff's own worked example
expands to:

```
<did:example:agent> <…/statement#predicate> <acme:mayActFor> .
```

A bare absolute IRI whose scheme is `acme` — kept verbatim, because IRI expansion
returns any value containing a colon before `@vocab` is ever consulted.

This makes the rule's first clause useless on its own: *"expands to an absolute
IRI"* is satisfied by every unresolved prefix, since a colon is all it takes. The
entire check rests on the second clause — *"in a vocabulary it accepts"* — which
is an allowlist the verifier must hold in advance, which is `ref-07d`'s subject
and open question 3.

## The answer to open question 2

Both options in the question are unsafe as stated, for different reasons, and
neither failure is visible to a verifier:

- **plain namespaced string** → not in the signed dataset; the verb can be swapped
- **CURIE** → safe *only if the prefix resolves*; if it doesn't, it degrades into
  an absolute IRI in a made-up scheme, which is signed but means the wrong thing,
  and means a *different* wrong thing to a verifier holding a different context

What is actually safe is a **full absolute IRI**, or a CURIE whose prefix the
verifier is guaranteed to resolve identically. That guarantee is not a property of
the CURIE — it is a property of whoever publishes the vocabulary, which is
question 3's subject.

## What it does NOT prove

- **Nothing about `Ed25519Signature2018`.** It is the other suite our VWCs carry
  and it is also RDF-canonicalized (URDNA2015), so the property should hold
  identically, but it is not exercised here — only `eddsa-rdfc-2022` and
  `eddsa-jcs-2022` are.
- **Not that any implementation verifies with safe mode off.** Check 3 is what
  happens *if* one does. Keyring's own signing path uses safe mode; what other
  verifiers do is unmeasured.
- **Nothing about whether #45 should be adopted.** The shape is assumed, not
  argued. This rung measures one property of one member.
- **No live exchange.** Fixtures are synthetic (`ref-07b` carries the real
  captured artifacts); the property under test is a property of expansion and
  does not depend on provenance.
- **Not a BBS+ claim.** Selective disclosure over statement credentials (#38, #9)
  would inherit the same vocabulary dependency, harder — an undefined term is not
  merely unsigned but undisclosable — but no BBS+ proof is produced here.

Pinned against: `dtgwg-cred-spec` @ `WD02` (6714971), read from the
`external/dtgwg-cred-spec-wd02` worktree; contexts from `@bifold/vrc-contexts` at
the current working tree.
