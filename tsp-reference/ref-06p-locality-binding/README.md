# ref-06p — the locality binding: what proves co-presence, and what only points at it

The witnessed exchange proves a witness ran a ceremony ([ref-06w4](../ref-06w4-package-truth/),
[ref-06x](../ref-06x-cypress-stack/)). This rung proves the machinery by which
that witness can also attest **where** it ran: an observation the witness makes
itself, bound to the session tightly enough that it cannot be moved, copied,
replayed, or claimed by a party that did not earn it.

Design under test: [`docs/plans/locality-plan.md`](../../docs/plans/locality-plan.md)
§5–§7. **26 checks.**

**Run:** `npm install && npm start` (`npm run check` for quiet, `node run.mjs --freeze`
to re-cut fixtures).

```
  witness/session ─────────────────────────► wendy       ext: locality offered
       ◄──────── #response {challenge, domain}            ext: sensor directive
                                                          (sensorDid, uuid prefix,
                                                           EID salt, window)
   ┌─ the radio, which the task channel never touches ────────────────────┐
   │  alice advertises  EID = HKDF(challenge, info=taskDigest(session))   │  LOCATES
   │  wendy's sensor scans for the EIDs it expects, connects, writes a    │
   │  nonce it minted here and nowhere else                              │
   │  alice signs {taskDigest, challenge, sensorNonce, sensorDid}         │  BINDS
   │            with her hardware attestation key                        │
   └─────────────────────────────────────────────────────────────────────┘
  witness/session/submit ──────────────────► wendy       ext: the transcript
       ◄──────── #response {vwc, vwcDigest}               ext: wendy's observation
                                                          └─ summarized in the VWC
```

## The one idea

**The advert locates; the transcript binds.** The advertised EID is visible to
every scanner in the room, so copying it is free — it can make a device
*findable*, never *believed*. That is the same locator/binder split
[ref-06w3](../ref-06w3-taskcontext-binding/) forced at the document layer, where
a `taskContext` id turned out to be forgeable and needed a digest beside it.
Here it is one layer down, at the radio.

The second idea is a direction: **the witness observes; the device does not
report.** Neither platform will attest a Bluetooth observation, so a device's
"I heard the beacon" is a software claim and cannot be third-party evidence. The
device's only cryptographic job is to prove, over the radio, that it holds the
key that signs the credential.

## What it proves

- **The EID is derived, per-session, and unlinkable.** `HKDF-SHA256(ikm =
  challenge, salt, info = taskDigest(sessionDoc), L = 12)`, carried as a 128-bit
  service UUID — the one advertisement field iOS lets an app control. The two
  bilateral sessions of one exchange derive **different** EIDs, because
  `witness/session` 0.1 forbids reusing a challenge across them.
- **Four forgeries, each rejected by a named check.** Replay across sessions
  (`taskDigestMismatch`), EID copy by a passive listener (`unknownKey`, then
  `signatureInvalid` when the copier borrows the victim's key id), a counterfeit
  session document reusing a genuine `id` (ref-06w3's forgery, `taskDigestMismatch`),
  and a transcript lifted from the other party's exchange.
- **Binding runs both ways.** The transcript covers the session digest and the
  challenge, so it cannot move between sessions; the witness cross-checks the
  *submitted* transcript against what its own sensor recorded, so a session
  cannot claim an observation it did not earn (`sensorNonceMismatch`).
- **`ext` is the whole wire story.** All four documents carry locality in
  `ext` under `edu.harvard.seas.atl.keyring`, through the published
  `@openvtc/trust-tasks` 0.9.0 §7.2 pipeline, byte-identically. **No upstream
  spec change is needed**, and a locality-blind peer accepts the same documents
  and ignores the namespace, as SPEC.md §7.2 requires.
- **The evidence is typed, negatives are explicit, and the assertion is shaped
  for selective disclosure.** `localityConfirmed: false` with a reason, an absent
  member, and a confirmed assertion are three states a verifier can tell apart.
  The assertion is **flat** (no nested object survives — bbs-2023 discloses at
  the quad level and a nested object is a blank node whose path must be
  revealed), **tiered** (a tier-1-only show is a complete claim — "a witness
  says co-present, BLE tier" — carrying no venue, no time, no sensor, no
  corroboration, and it canonicalizes on its own), and it carries **predicates
  rather than identifiers**: `localityKeyMatchesCredentialSigner` is asserted
  while the device key id stays on the artifact side, because a stable key id
  across ceremonies is a correlation vector. `residuals` is deliberately absent —
  it is a function of the method, and as a disclosable set it would let a holder
  reveal only the flattering half of a threat list.
- **Which canonicalization covers what** — the finding that shaped the design:

  | Artifact | Suite | Covers |
  |---|---|---|
  | Trust Task documents (the `ext` transcript) | `eddsa-jcs-2022` | every member, no vocabulary needed |
  | The credential | proof set: `eddsa-jcs-2022` **+** `bbs-2023` | the JCS half covers everything; **the bbs half covers only members with defined JSON-LD terms** |

  The credential is a **proof set** ([cred-spec #18](https://github.com/trustoverip/dtgwg-cred-spec/pull/18),
  ours): JCS for offline verification, `bbs-2023` as the selective-disclosure
  base. `bbs-2023` is RDF-canonicalized, so the vocabulary is **mandatory work,
  not conditional** — and an undefined term is worse than unsigned, it is
  *undisclosable*, because it is not in the dataset to disclose from. The
  extensibility argument this act produced is drafted for #18 in
  [`PR-CANDIDATE.md`](./PR-CANDIDATE.md).

  Run without term definitions and the assertion is *not signed*, in two ways:
  JSON-LD **safe mode — what the DI signing path uses — rejects the document
  outright**, and with safe mode off the members silently drop to **zero quads**
  while still sitting in the JSON. Today's shipped `LocalityEvidence` members
  (`challenge`, `proofs`, `did`, `sig`) have no terms in
  `witnessedExchangeContext.ts`; the defect has never fired only because the
  sole provider is `NullLocalityProvider`. This rung authors the missing terms
  as `fixtures/locality-context-terms.json` — fourteen definitions, which are
  the implementation's input, not a demonstration.
- **What it costs, measured:** **1,887 bytes per session** — transcript 523,
  witness observation 515, VWC assertion 511, sensor directive 235 — on top of
  ref-06w's 2,213-byte retained pair.

## What it does NOT prove

- **Nothing about radios.** No BLE, no GATT, no RSSI, no round-trip timing. The
  honest RTT distribution is `ref-06p2` (real adapters) and the relay-detection
  threshold is `ref-06p4` (a staged relay with injected latency). **The timing
  bound in the design is a placeholder until those two rungs measure it** — and
  it is a long-distance discriminator, not a distance bound: a local relay adds
  single-digit milliseconds and the parking lot is already inside BLE range.
- **No BBS+.** The assertion is *shaped* for `bbs-2023` selective disclosure and
  act 6 shows a tier-1 subset canonicalizing on its own, but no BBS+ proof is
  produced or derived here — that needs BLS12-381 tooling we have not yet
  surveyed, and whether it runs on Hermes is an open question of its own.
- **No proof verification.** Task-layer proofs are stubbed
  (`acceptUnverified`), as in every rung — real `eddsa-jcs-2022` verification is
  Phase D of the OpenVTC plan. The credential proof is not computed either; act
  6 demonstrates the canonicalization property directly on the dataset, which is
  what the signature is taken over.
- **A minimal JSON-LD document.** Act 6 uses an inline context with the terms
  under test, not a full VWC with `credentials/v2` (which would need a document
  loader and fixture bytes for someone else's context). The property it
  demonstrates — undefined term, no quad — is a property of expansion and does
  not depend on the surrounding document.
- **Nothing about willing collusion.** Two parties who agree in advance to fake
  a meeting are not stopped by any of this. Only the NFC kiosk tier
  (locality-plan §4.4) closes that, and it is not built.
- **Node only.** Hermes is ref-08.

Pinned against: `@openvtc/trust-tasks` 0.9.0, `dtgwg-trust-tasks-tf` @ `7e0d755`
(binding 0.2, framework SPEC.md 0.3), `dtgwg-cred-spec` @ `b89f389`.
