# Witness privacy hardening — a witness that cannot follow relationships by default

**Scope.** The witnessed VRC exchange as the witness-server and the wallet run it:
what the witness sees, logs and retains; what its public endpoints expose; what the
VWC and the witness-share bundle reveal to peers and verifiers; and which stable
identifiers ride along with otherwise pairwise DIDs. The goal is the principle below.
The largest single step toward it is removing the legacy witness dialect, so that the
Trust Task ceremony is the only witnessing path.

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
owns what is disclosed and retained, and the removal of the legacy dialect.

**Status.** Proposed. No code written. Phase 0 is unblocked; Phase 2 step 2.9 and
Phase 3 wait on decisions listed under *Not decided*.

---

## 1. Standing facts an implementer needs

- **Two dialects are served today.** The Trust Task ceremony (`witness/session`,
  `witness/session/submit`) is the current path. The legacy basic-message dialect
  (`session-request`, `session-challenge`, `submit-presentation`, `witness-grant`,
  `reporting-did-registration`, `verify-credential`) holds most of the exposure: a
  credential registry, public activity and network feeds, a shared challenge across both
  parties, the reporting graph, and a chat/LLM reply branch on the same listener. The Trust
  Task path persists almost nothing beyond the witness's connection record and stdout log.
- **The wallet picks the dialect per peer pair, never by fallback.** When both peers announce
  an RCE protocol version of 4 or more, the exchange and its witnessing run on Trust Tasks;
  below that, the legacy witness flow runs. A failed Trust Task witness ceremony logs and
  continues unwitnessed; it does not retry on the legacy dialect. Witness discovery is used
  only for the locality preflight.
- **`witness-announcement` is not part of the dialect to remove.** It is the wallet's only
  witness discovery: it sets the connection's witness metadata and the active witness, and
  the Trust Task ceremony reads that to decide an exchange is witnessed. The plain-text
  `vrc:relationshipDid:` announcement that carries the RCE version is likewise not
  witnessing and stays.
- **The Trust Task path is not yet a superset.** It lacks the event start/end window and the
  VRC freshness check that the legacy path enforces (Phase 0 ports both). It has no registry,
  reporting edge or verification endpoint, by design (Phase 1 removes them).
- **The Trust Task path takes nothing from legacy code.** Its coupling to the service is by
  injection: the issuer, the VWC builder, the hardware-attestation key extractor, the
  credential shape, the locality policy, the venue claim and the locality provider.
- **The VWC shape is configurable on the Trust Task path too.** The server config defaults to
  the `vsc` shape; the builder's own default, and the Trust Task host's default when omitted,
  is the deprecated WD02 shape. A new call site without a shape silently emits WD02.
- **Reporting is a test aid.** It defaults on today in the wallet and the server and is never
  to ship on; the plan removes it with the legacy dialect (§2).
- **The witness always learns the pair.** A submitted VRC names both relationship DIDs
  (the presenter is the issuer, the counterparty is the subject), and the witness needs the
  VRC to compute the VWC's object digest. Hiding the pair from the witness is not
  achievable without selective disclosure; the plan therefore limits what the witness
  retains and exposes, and what the artifacts it signs carry onward.
- **Relationship DIDs are pairwise** (`did:peer:0`, a fresh key per counterparty, no
  service endpoint). What is reused across relationships is the wallet's connection to
  the witness and the device hardware key.
- **A response is signed after its handler returns.** A member the witness should not
  emit must be removed at the source; redacting a shared bundle afterwards breaks the
  witness's proof.
- **Green unit tests are weak evidence for the removal.** Most of the witness-server's
  service tests re-implement logic inline instead of calling the service, so deleting
  legacy code mostly will not fail them. The removal steps are accepted by search checks
  and an end-to-end witnessed exchange, not by a passing suite alone.

## 2. Design positions

Each is standing rationale: the constraint that rules the alternative out.

- **The legacy dialect is removed, not hardened.** It carries every exposure the audit
  found beyond the Trust Task path's own: the public activity and issued-credential feeds,
  the registry of relationship-DID pairs, the unauthenticated `session-request`, the
  logging error path, the leftover exchange records and the reporting residue. It uses one
  challenge shared by both parties, which the witness session spec forbids because either
  party's presentation can then satisfy the other's session. It cannot emit the `vsc`
  credential shape, which needs a session document. It is the larger code path (the service
  file is roughly four times the Trust Task ceremony), so every fix would be made and tested
  twice. *Rejected: hardening it in place* — it spends effort on a path with no future and
  leaves the spec conflict.
- **Removal is safe because:**
  - nobody outside this repository depends on the legacy dialect (an assumption of this
    plan, owned by the maintainers);
  - inside the repository, a pair of peers that both speak RCE 4 or more already runs on
    Trust Tasks, and a failed ceremony never falls back to the legacy dialect, so removal
    changes no v4 behaviour; the only loss is witnessing with a peer below v4, which then
    completes the VRC exchange unwitnessed;
  - the Trust Task path imports nothing from the code being removed;
  - the witnessed end-to-end scripts already exercise the Trust Task ceremony;
  - what exists only on the legacy path either has no internal caller (the verification
    endpoint, the issued-credentials feed, the dashboards) or is ported first (the event
    window, VRC freshness — Phase 0); and
  - each removal step is accepted by a search check and a build, in an order that keeps
    both green, with a device end-to-end run before the last wallet-facing step is
    accepted.
- **Reporting is removed with the legacy dialect and is not rebuilt as part of it.** The
  reporting graph and the wallet's reporting setting exist only for the legacy flow. If
  cross-session aggregation is ever wanted, it returns on the Trust Task path as an opt-in
  extension, agreed by both parties, using a per-witness pseudonym (Phase 3).
- **A verification endpoint is not rebuilt.** A VWC verifies by its own signature. The
  endpoint and registry lookup had no internal caller; if one is wanted, it is a Trust Task
  handler backed by a small log of issued VWC ids, designed on its own.
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

## 3. Phase 0 — port what the Trust Task path lacks

Nothing is removed until these land, so no behaviour is lost.

| # | Step | Acceptance |
|---|---|---|
| 0.1 | **Event window.** `handleSession` on the Trust Task path refuses a session before the configured event start or after its end, with a Trust Task error code; the wallet maps the code to the existing "event not started" / "event ended" dialogs. | A session opened outside the window is refused, and the wallet shows the dialog; inside the window it opens; both tested. |
| 0.2 | **VRC freshness.** `handleSubmit` applies the existing VRC freshness check (the `validFrom` window with its clock-skew allowance). | A stale VRC is refused; a fresh one, and one within the skew allowance, is accepted. |
| 0.3 | **Builder tests.** Move the VWC-builder, hardware-attestation-key and freshness tests out of the service test file into a `credentialBuilder` test file, vsc only. | No builder test imports the service; the moved tests pass. |

## 4. Phase 1 — remove the legacy dialect

Each step leaves the build and tests green. "Search check" means a grep over the package,
returning nothing outside the named exceptions. Steps 1.1–1.2 (wallet) precede 1.3–1.6
(server) so no wallet sends to a handler that is gone.

| # | Step | Acceptance |
|---|---|---|
| 1.1 | **Wallet stops sending the legacy dialect.** Remove the legacy witnessed-exchange manager, the flow-decision branches (use witness, use reporting, fall back without witness), session-challenge handling and its timeouts, the pending-VRC maps, the VWC auto-accept and routing for the legacy witness's credential offers (keep the relationship-card auto-accept in the same handler), and the `reporting-did-registration` send. Delete the matching suites (the witness reporting flow suite and the witness blocks of the manager error-handling and witness-integration suites). | A search of the wallet core for the legacy message types finds none; wallet tests and typecheck pass; an exchange with a peer below RCE 4 still completes, unwitnessed. |
| 1.2 | **Wallet drops reporting.** Remove the reporting setting and screen, the settings row, the chat pseudonym bubble and its icon type, the pseudonym utility, the locale keys in every language, and the `legacy` default of the flow dialect. The settings reducer tolerates the persisted legacy keys. | A search for the reporting setting and `reportingDid` across core and app finds none; locale files carry no orphan keys; stored settings from a previous build load; the app builds. |
| 1.3 | **Server drops the dispatcher.** Remove the basic-message dispatcher and its handlers, the shared-challenge session state, the registry and reporting wiring, the pending-request and session cleanup timers, and the credential and proof agent modules. Keep the `witness-announcement` send, the connection-completed listener, the issuer DID and key handling, the reusable invitation and the mediator pickup. | A search of the server for the legacy handlers, the registry and the reporting graph finds none; server tests pass; a local witnessed exchange completes end to end. |
| 1.4 | **Server drops the legacy surface.** Remove the verification, issued-credentials, activity-log, network, dashboard, mock-control and live-socket routes; the broadcaster; the dashboard pages and assets; the pseudonym modules; the legacy locality challenge service; the registry and reporting files; and the invitation-page links to them. `/api/issuer` stays without its statistics. | The QR page, `/connect` and `/api/issuer` are served; a search for the removed routes finds none; the package and its container image build; the staging health check on `/` passes. |
| 1.5 | **One credential shape.** Remove the WD02 branch of the builder, the proofed-VRC digest helper, the shape parameter and the host's shape field, `WITNESS_CREDENTIAL_SHAPE`, and the nested legacy locality evidence; make `vsc` the only output. Update the reference-implementation capture test that imports the builder. | A search of the server and the reference implementation for `wd02`, `credentialShape` and `WITNESS_CREDENTIAL_SHAPE` finds none; the vsc capture test passes. |
| 1.6 | **Config and operations.** Remove the reporting, reporting-directory, message-retention, locality-verification-required and legacy locality settings; the chat/LLM settings if the chat reply is dropped (see *Not decided*); and their entries in the environment sample, compose file and ignore file. Trim the config tests. | A search for the removed variable names finds none outside historical documents; config tests pass. Deployed environment files that still set removed variables are harmless and are noted in the change description. |
| 1.7 | **Reference implementation.** Delete the legacy reference witness, the participant's witness methods, the demo, and the legacy witnessed-flow and frozen-WD02 capture tests; keep the vsc capture test and the context and proof-mirroring tests. | The reference implementation's tests pass; its dependency on the witness-server build for the vsc capture remains. |
| 1.8 | **End to end.** The locality scripts set the Trust Task locality policy, not the removed legacy variable, and assert the policy they claim; stale comments describing the legacy flow are corrected. Run one real-device witnessed exchange. | The witnessed end-to-end run passes on devices; the locality scripts fail if the witness policy is not applied. |
| 1.9 | **Documents.** Rewrite the witness-server README to the remaining surface; update its environment sample; delete the network and chat/LLM documents with their code; retire or re-point the reference implementation's witnessed-flow document to the Trust Task specs; record the removal in a dated companion to the affected living plans and amend their sections that describe the removed flag and flow; add the change-log entries. | A search of non-plan documentation for the legacy message types and removed variables finds none. |

The wallet's read side for already-issued WD02 VWCs (type recognition, nested locality
reads, the legacy digest branch, the `digest` and `localityVerification` context terms) is
kept through Phase 1 and removed separately (*Not decided*).

## 5. Phase 2 — harden the Trust Task path

Each step is done when its acceptance test passes and the two-wallet witnessed exchange
still completes with badges and witness-share.

| # | Step | Acceptance |
|---|---|---|
| 2.1 | **Logging.** Log the session id only, never relationship DIDs or connection labels, at the default level. Trim the credential validation text, and drop the device MAC from failure logs. | A log-capture test over a full exchange and over injected failures finds no relationship DID, label, VP or VRC content at the default level. |
| 2.2 | **Locality observation.** Remove `deviceKeyId`, round-trip time and signal strength from the signed observation, and the timing members from the VWC assertion. Keep the digest and the two predicates. | The submit response and the VWC contain none of them; the locality tests assert the digest and predicates; the witnessed flow passes. |
| 2.3 | **`parties` out of the VWC.** Stop emitting `parties`; keep it in the session request. Depends on step 2.7. | A VWC has no `parties`; a receiving wallet verifies and stores it using the session document's parties; a share whose session names other parties is refused. |
| 2.4 | **Bind `parties`; enforce expiry.** At submit require `parties` to equal the VRC's issuer and subject. Check session age at submit and sweep expired sessions on a timer. | A submit naming a third DID is refused; a submit after the session TTL is refused; stale sessions are gone without a new session opening. |
| 2.5 | **Hardware attestation claim.** Have the witness verify the evidence chain before reporting `verified`, or report the member as unverified. | A VRC with a self-reported but invalid chain does not produce `verified`. |
| 2.6 | **Remaining endpoints.** The routes left after Phase 1 expose only the invitation, the issuer DID and the event name; document TLS and the plain-HTTP default. | The README lists the remaining routes and their content; no route returns a relationship DID. |
| 2.7 | **Edge binding on receipt.** In the inbound witness-share handler, check that the VWC's object digest equals the digest of the VRC held for that exchange. | A share whose digest matches no held VRC is refused; a matching share is stored; both are tested. |
| 2.8 | **Consent before witness-share.** Sending the bundle requires a consent step or a "share witness details" setting, not only the witnessing preference. | With consent withheld, no bundle is sent and the exchange still completes. |
| 2.9 | **Per-ceremony witness connection.** A fresh connection or connection DID per ceremony and a generic label, so the witness-side DID pair is not a cross-relationship correlator and does not ride in the bundle. *Conditional on the connected-witness model changing* (see *Not decided*). | Two ceremonies at one witness share no wallet-side connection DID in the session documents or the bundle. |
| 2.10 | **Comment and test cleanup** after step 2.3. | The stale comment about `parties` is corrected; share-verification tests cover a VWC without `parties`. |

Order: 2.1, 2.4 and 2.5 first; then 2.2; 2.7 before 2.3; then 2.6, 2.8 and 2.10.

## 6. Phase 3 — design, then build

- **Hardware key linkage.** Decide between a per-relationship or per-ceremony attested key
  (costs a fresh attestation per key — seconds on iOS, and per-key attestation on
  Android), an on-demand transcript disclosure tier, or documenting that locality and
  hardware evidence link. Acceptance for any choice: two VRCs from one device carry no
  common key in what a witness or verifier receives by default, or the linkage is
  documented where the setting is offered.
- **Locality default.** Whether locality confirmation is on by default in the wallet.
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
- **Opt-in reporting on the Trust Task path.** Only if wanted: an extension agreed by both
  parties, a per-witness pseudonym, off unless both opt in. Not part of the removal.
- **Selective disclosure (bbs-2023)** stays a target, not a task in this plan.

## 7. Documents to correct

Phase 1 step 1.9 rewrites the witness-server README and removes the statements that
reporting is opt-in and that no message history is retained. Remaining:

- `locality-plan.md` §7.1 rule 3 and §9.1 ("the device key id stays on the artifact side",
  "the witness learns nothing new") against what the witness receives and signs until
  step 2.2 lands.
- `vsc-migration-plan.md` §3.6 against `issuerScope: 'directed'`, and its description of the
  shape flag that step 1.5 removes.

## 8. Compatibility and rollout

- Wallets below RCE 4 lose witnessing and keep the unwitnessed VRC exchange. The plan
  accepts this because nothing outside the repository depends on it.
- Persisted wallet settings carry the legacy reporting keys; the reducer tolerates them
  (step 1.2).
- A wallet without the session-document fallback for `parties` refuses a VWC that lacks it.
  The pinned wallet has the fallback; confirm the minimum supported wallet before step 2.3,
  or ship it behind a witness configuration flag.
- Changes to `witness-server` and `core` land in keyring-bifold first, then a pin bump in
  keyring-wallet. The wallet steps (1.1, 1.2) and the server steps (1.3–1.6) are separate
  pull requests in that order.

## 9. Not decided

| Question | Recommendation | Waiting on |
|---|---|---|
| Keep the witness's plain-text chat and LLM reply (it lives on the basic-message listener being removed) | Drop it; it has no Trust Task equivalent and sends message content to a third party when enabled | Brendan |
| Remove the wallet's read side for already-issued WD02 VWCs | Keep until stored test VWCs are gone, then remove as a final separate step | Brendan |
| Locality confirmation default | Off until the key question is resolved | Brendan |
| Per-ceremony witness connection: accept changing the connected-witness model | Needed for step 2.9; larger wallet change | Brendan |
| `issuerScope`: `public`, or keep `directed` and amend the plan | — | Brendan |
| VWC timestamp coarsening | — | Brendan |
| Rebuild opt-in reporting on the Trust Task path | Only if a use case appears | Brendan |
| Session-issuer check for spec 0.2 | Raise upstream: the check as written cannot pass for a connection-DID issuer | Upstream (trust-tasks) |

## 10. Working setup

Work in a fresh worktree from `origin/main` with the bifold submodule at the pinned
commit, not in a checkout whose submodule is off its pin. Run tests with `umask 002`,
after checking available memory, with `TMPDIR` under `/var/tmp`. Each package's test
gate is its own `yarn test`; run the root typecheck for the wallet.

## Review index

| Companion | Concluded |
|---|---|
| [`2026-10-19-bam.md`](./witness-privacy-hardening-plan/2026-10-19-bam.md) | The disclosure audit at the pin, the positions on independence and opt-in tracking, the two-witness-kinds distinction, the public reply posted to the OpenVTC witnessing discussion, and the decision to remove the legacy dialect with the inventory behind it |
