# Witness privacy hardening — a witness that cannot follow relationships by default

**Scope.** The witnessed VRC exchange as the witness-server and the wallet run it:
what the witness sees, logs and retains; what its public endpoints expose; what the
VWC and the witness-share bundle reveal to peers and verifiers; and which stable
identifiers ride along with otherwise pairwise DIDs. The goal is the principle below,
not new protocol features.

**Principle.** A witness must not be able to track relationships in a community by
default. Any tracking — cross-session aggregation, reporting graphs, retained
identifier pairs — is opt-in, by both parties, and uses a per-witness pseudonym.

**Companion.** Findings, evidence at the pin, decisions and the public positions
taken are in [`witness-privacy-hardening-plan/2026-10-19-bam.md`](./witness-privacy-hardening-plan/2026-10-19-bam.md).
Read it before changing a step's scope; it holds the file and line evidence this
plan deliberately leaves out.

**Related plans.** Builds on [`vsc-migration-plan.md`](./vsc-migration-plan.md)
(the VWC shape), [`locality-plan.md`](./locality-plan.md) (the locality evidence and
its key rules) and [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) with its
[Trust Tasks subtask](./openvtc-integration-plan/trust_tasks_subtask.md) (the
ceremony). Where they overlap, those plans own the shape and the ceremony; this plan
owns what is disclosed and retained.

**Status.** Proposed. No code written. Phase 0 is unblocked; Phase 1 step 1.4 and
Phase 2 wait on decisions listed under *Not decided*.

---

## 1. Standing facts an implementer needs

- **Two dialects are served.** The Trust Task ceremony (`witness/session`,
  `witness/session/submit`) is the current path. The legacy basic-message dialect
  (`session-request`, `submit-presentation`, …) is still served for interop and holds
  most of the exposure: a credential registry, a public activity feed, a shared
  challenge across both parties and the reporting graph. The Trust Task path persists
  almost nothing beyond the witness's connection record and stdout log.
- **Reporting is a test aid.** The reporting graph (`enableReporting` in the wallet,
  `WITNESS_REPORTING_ENABLED` on the witness) defaults on only for test builds; production
  builds ship it off. Everything below assumes it is off. Residue that persists with it
  off is in scope (step 0.3).
- **The witness always learns the pair.** A submitted VRC names both relationship DIDs
  (the presenter is the issuer, the counterparty is the subject), and the witness needs
  the VRC to compute the VWC's object digest. Hiding the pair from the witness is not
  achievable without selective disclosure; the plan therefore limits what the witness
  retains and exposes, and what the artifacts it signs carry onward.
- **Relationship DIDs are pairwise** (`did:peer:0`, a fresh key per counterparty, no
  service endpoint). What is reused across relationships is the wallet's connection to
  the witness and the device hardware key.
- **A response is signed after its handler returns.** A member the witness should not
  emit must be removed at the source; redacting a shared bundle afterwards breaks the
  witness's proof.

## 2. Design positions

Each is standing rationale: the constraint that rules the alternative out.

- **`parties` is in the session request and not in the VWC.** The witness needs it to
  authorize a submit (the VP holder and the submit proof must be one of the `parties`),
  and the bundle needs the session document that names it for the digest check. The
  `witnessed/1` profile does not define `parties` in the credential, and verifiers
  ignore members a profile does not define (cred-spec, additional members; paraphrased —
  quote the operative sentence when implementing). Carrying it in the VWC duplicates
  unverified data on the artifact most often shown. *Rejected: a holder option to
  withhold `parties` from the VWC after issuance* — the VWC is signed with an RDF
  canonicalization suite and there is no derivation code, so a holder cannot redact it
  without breaking the proof; omission has to happen at issuance.
- **`parties` is checked against the VRC.** The witness requires
  `parties == {VRC issuer, VRC credentialSubject.id}` at submit, and the receiving
  wallet checks the VWC's object digest against the VRC it holds for that exchange.
  Without both, `parties` and the edge are a holder's claim countersigned only as "this
  is what you told me".
- **Locality observation carries no device key and no timing.** `deviceKeyId`,
  round-trip time and signal strength are informational: nothing verifies them, and the
  plan for locality calls corroboration "never a security boundary" (locality-plan §7.1).
  The commitment `transcriptDigestMultibase` and the witness-signed predicates stay; they
  are the integrity anchor and need no key id. *Limit, stated so it is not oversold:*
  removing the key id from the witness's response does not hide the device key from
  holders of a VRC that carries it as hardware evidence.
- **The device key is per relationship or per ceremony, or locality and hardware evidence
  are documented as linking.** *Rejected: a salted or blinded key id in the observation* —
  unlinkable across sessions but unverifiable against the VRC unless the holder reveals
  the salt, which is the opt-in disclosure option under a different name.
- **Independence from the community is not required of a witness.** A community is
  authoritative over its own governance and membership. A witness must not be a party to
  the event it witnesses. Beyond that, independence is verifier policy (an accepted-witness
  list), not a credential member: a witness declaring its own independence proves nothing,
  and `witnessContext` is frozen at `witnessed/1`.
- **Two kinds of witness have different defaults.** A community witness sits inside the
  community's trust boundary and may gate on membership. A third-party witness for hire
  sees relationships across communities and carries the strictest retention defaults and a
  stable public identity. The ceremony is the same; the policy differs.
- **Revocation is short validity, not a status list.** VWCs expire in seven days;
  status checks add their own correlation. Revisit only if a use case needs earlier
  revocation.

## 3. Phase 0 — witness-server only

Each step is done when its acceptance test passes and the two-wallet witnessed exchange
still completes with badges and witness-share on both the Trust Task and legacy paths.

| # | Step | Acceptance |
|---|---|---|
| 0.1 | **Legacy public feeds.** Forward credential entries to the broadcaster only when reporting is on. Remove the issuer R-DID and recipient connection DID from the issued-credentials API, the log page and the live socket payloads (counts only), or put operator views behind a token or a localhost bind. Remove CORS `*`. Add a switch that turns the legacy dialect off. | With reporting off, a test that issues a legacy VWC finds no relationship DID in any response from the issued-credentials API, the log page or the socket; a request from another origin gets no CORS grant; with the dialect switch off, legacy messages are refused. |
| 0.2 | **Logging.** Log the session id only, never relationship DIDs or connection labels, at the default level. Route handler exceptions away from the legacy plain-text branch that logs (and may send to an LLM) the whole message. Trim the credential validation text and drop the device MAC from failure logs. | A log-capture test over a full Trust Task and legacy exchange, plus injected handler failures, finds no relationship DID, label, VP or VRC content at the default level, and nothing sent to the LLM provider. |
| 0.3 | **Reporting residue.** Gate the whole reporting block — the `reportingDid` log, the stored reporting DIDs and the broadcaster edge call — on the reporting setting. | With reporting off, a legacy exchange where both parties send a `reportingDid` leaves no reporting DID in logs, session state or broadcaster output. |
| 0.4 | **Locality observation.** Remove `deviceKeyId`, round-trip time and signal strength from the signed observation, and the timing members from the VWC assertion. Keep the digest and the two predicates. | The submit response and the VWC contain none of them; the locality tests assert the digest and predicates; the vrc-reference witnessed flow passes. |
| 0.5 | **`parties` out of the VWC.** Stop emitting `parties` on both credential shapes; keep it in the session request. Depends on step 1.1. | A VWC has no `parties`; a receiving wallet verifies and stores it using the session document's parties; a share whose session names other parties is refused. |
| 0.6 | **Bind `parties`; enforce expiry.** At submit require `parties` to equal the VRC's issuer and subject. Check session age at submit and sweep expired sessions on a timer. | A submit naming a third DID is refused; a submit after the session TTL is refused; stale sessions are gone without a new session opening. |
| 0.7 | **Hardware attestation claim.** Have the witness verify the evidence chain before reporting `verified`, or report the member as unverified. | A VRC with a self-reported but invalid chain does not produce `verified`. |
| 0.8 | **Operator surface.** Authenticate or remove the mock-control routes; escape identifiers rendered into the activity page; decide the verification endpoint's exposure; document TLS. | The routes need a credential or are absent; a crafted identifier renders as text; the endpoint decision is recorded in the README. |
| 0.9 | **Legacy persistence.** Delete credential-exchange and message records after delivery; prune the in-memory relationship registry; refuse to start in production mode with message retention or verbose logging on, or warn loudly. | After a legacy exchange, the witness's wallet holds no exchange record naming the parties; the registry is bounded; the production start check is tested. |

Order: 0.1 and 0.2 first; then 0.3, 0.4, 0.6 and 0.7; 0.5 after step 1.1; then 0.8 and 0.9.

## 4. Phase 1 — wallet

| # | Step | Acceptance |
|---|---|---|
| 1.1 | **Edge binding on receipt.** In the inbound witness-share handler, check that the VWC's object digest equals the digest of the VRC held for that exchange. | A share whose digest matches no held VRC is refused; a matching share is stored; both are tested. |
| 1.2 | **Defaults.** Reporting off in production builds and on in test builds, driven by build configuration. Decide the default for locality confirmation. Correct the UI text that calls reporting opt-in. | A production build starts with reporting off; the setting text matches behaviour. |
| 1.3 | **Consent before witness-share.** Sending the bundle requires a consent step or a "share witness details" setting, not only the witnessing preference. | With consent withheld, no bundle is sent and the exchange still completes. |
| 1.4 | **Per-ceremony witness connection.** A fresh connection or connection DID per ceremony and a generic label, so the witness-side DID pair is not a cross-relationship correlator and does not ride in the bundle. *Conditional on the connected-witness model changing* (see *Not decided*). | Two ceremonies at one witness share no wallet-side connection DID in the session documents or the bundle. |
| 1.5 | **Comment and test cleanup** after step 0.5. | The stale comment about `parties` is corrected; share-verification tests cover a VWC without `parties`. |

## 5. Phase 2 — design, then build

- **Hardware key linkage.** Decide between a per-relationship or per-ceremony attested key
  (costs a fresh attestation per key — seconds on iOS, and per-key attestation on
  Android), an on-demand transcript disclosure tier, or documenting that locality and
  hardware evidence link. Acceptance for any choice: two VRCs from one device carry no
  common key in what a witness or verifier receives by default, or the linkage is
  documented where the setting is offered.
- **VWC timestamps.** Whether to round `validFrom` down and `validUntil` up to day
  granularity, compatible with the existing clock-skew backdate. Acceptance: the
  wallet's validity checks still pass for a VWC issued seconds earlier.
- **`issuerScope`.** The witness emits `directed`; the VSC plan states the witness
  "declares nothing" while the witness DID is public. Decide and align code and plan.
- **Spec 0.2 alignment.** The code targets witness session and submit 0.1. Moving to 0.2
  (the refusal document, the session-issuer check, `memberPresentation`) needs the session
  issuer to be a relationship DID, which the wallet's session issuer — the connection DID —
  is not, and needs the VWC issuer, session recipient and response signer to be one
  identity; today the responses are signed with the per-connection DID and the VWC with
  the dedicated issuer DID. Raise the first upstream before changing it.
- **Selective disclosure (bbs-2023)** stays a target, not a task in this plan.

## 6. Documents to correct

- The witness-server README: the Redis registry variables are not wired; the statement
  that reporting is disabled unless users enable it; the statement that no message
  history is retained, against connection records, exchange records and stdout logs.
- `locality-plan.md` §7.1 rule 3 and §9.1 ("the device key id stays on the artifact side",
  "the witness learns nothing new") against what the witness receives and signs today.
- `vsc-migration-plan.md` §3.6 against `issuerScope: 'directed'`.

## 7. Compatibility and rollout

- A wallet without the session-document fallback for `parties` refuses a VWC that lacks
  it. The pinned wallet has the fallback; confirm the minimum supported wallet before
  step 0.5, or ship it behind a witness configuration flag.
- The legacy WD02 shape and dialect remain for interop. Steps 0.1 and 0.9 reduce their
  exposure without changing the wire protocol; the dialect switch lets an operator turn
  them off.
- Changes to `witness-server` and `core` land in keyring-bifold first, then a pin bump in
  keyring-wallet.

## 8. Not decided

| Question | Waiting on |
|---|---|
| Locality confirmation default (off until the key question is resolved, or on) | Brendan |
| Per-ceremony witness connection: accept changing the connected-witness model | Brendan |
| Legacy dialect: off by default, or on with the feeds locked down | Brendan |
| `issuerScope`: `public`, or keep `directed` and amend the plan | Brendan |
| VWC timestamp coarsening | Brendan |
| Session-issuer check for spec 0.2 | Upstream (trust-tasks): the check as written cannot pass for a connection-DID issuer |

## 9. Working setup

Work in a fresh worktree from `origin/main` with the bifold submodule at the pinned
commit, not in a checkout whose submodule is off its pin. Run tests with `umask 002`,
after checking available memory, with `TMPDIR` under `/var/tmp`. Each package's test
gate is its own `yarn test`.

## Review index

| Companion | Concluded |
|---|---|
| [`2026-10-19-bam.md`](./witness-privacy-hardening-plan/2026-10-19-bam.md) | The disclosure audit at the pin, the positions on independence and opt-in tracking, the two-witness-kinds distinction, and the public reply posted to the OpenVTC witnessing discussion |
