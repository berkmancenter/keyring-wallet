# TSP Rev 3 — packing one revision, reading two

**Status:** Proposal for review. Not a commitment to implement.
**Parent:** [`keyring-on-the-vta-farm.md`](../keyring-on-the-vta-farm.md) — parented here because the Prague work is what forces the question, not because Rev 3 is Farm-specific.
**Siblings:** [`openvtc-integration-plan.md`](../openvtc-integration-plan.md) owns TSP as a transport and keeps that ownership; this subtask owns only the Rev 2 → Rev 3 migration of the stack it already built. [`community_vetting_subtask.md`](./community_vetting_subtask.md) §3.6 defers this work here and is designed not to depend on it.
**Reasoning:** [`2026-09-15-bm.md`](./2026-09-15-bm.md) Part 2 — the measurements behind §2–§3, the executable demux check behind §3.3, and the positions they supersede. This document states current design only; see [`CLAUDE.md`](../CLAUDE.md).
**Dependency direction:** nothing in the vetting path, the PNM client or the VRC/witness stack waits on this. Rev 3 lands when upstream ships it.
**Baseline (read 2026-09-15):** `vta-browser-plugin` branch `feat/tsp-rev2-rev3-dual-handler` **78cfbf96** (`@openvtc/vti-tsp-js` 0.3.0, unreleased) · `@openvtc/vti-tsp-js` **0.2.0** latest on npm, Rev 2, published 2026-08-17 · `vti-didcomm-js` pinned **2365c86** · our TSP stack on `vti-tsp-js` **0.1.0** plus a local Hermes patch. Re-measure before acting, per [`scripts/openvtc/README.md`](../../../scripts/openvtc/README.md).

**References:**

- **[[REV3-MIGRATION]]** — *TSP Rev 3 Migration*, `docs.fpp.storm.ws/tsp-rev3-migration.html`. Written against the Rust `tsp-sdk`.
- **[[TSP-JS-CHANGELOG]]** — `packages/tsp-js/CHANGELOG.md` @ `78cfbf96`, entry *[0.3.0] — Trust Spanning Protocol specification Rev 3*. The JS package's own account of the same cutover, and the one our code consumes.
- **[[REVISION-TS]]** — `packages/tsp-js/src/revision.ts` @ `78cfbf96`, the keyless discriminator.

---

## 1. What this subtask is for

Rev 3 is a wire-level cutover, not a version bump: [[TSP-JS-CHANGELOG]] — *"Rev 3 changed the crypto mode, the version byte, the long count-code prefix, the ciphertext code and layout, the `-E` count's meaning, the signature code and every payload layout at once, so the two revisions share no frame either side can classify."*

Keyring's TSP stack is Rev 2 throughout: the HPKE-Auth crypto in `bifold/packages/trust-tasks/src/tsp/hpke.ts`, the CESR framing in `.../tsp/direct.ts`, the fixtures in [`ref-00…04`](../../../tsp-reference/), and the carriage in `bifold/packages/core/src/modules/trust-tasks/module/TspCarriage.ts`. This subtask says what changes, in what order, and what we do about the two things upstream's migration does not cover: **a mediator ingress classifier that Rev 3 breaks (§3.3)**, and **relationship gating that Rev 3 makes mandatory (§3.4)**.

---

## 2. Positions

### 2.1 Pack one revision, read both

Upstream's shape, adopted unchanged: [[TSP-JS-CHANGELOG]] — *"This package now packs Rev 3, and a Rev 2 peer cannot read what it sends. There is no negotiation and no fallback. … Reading is dual."* An inbound message is dispatched on the version marker; a Rev 2 message is read by a frozen decode-only codec.

We adopt it rather than invent our own because the asymmetry is sound and the reason is stated: *"an inbound message says what it is, an outbound one has nothing to read, and a dual **packer** could only be a guess dressed as a protocol."*

### 2.2 There is no negotiation, and we do not build one

No capability advertisement, no per-message revision choice. Reading both revisions is not compatibility — it is the difference between an honest error and a crypto-layer failure. [[REVISION-TS]]: *"`peekRevision` exists so that a Rev 2 message we are given is read correctly and reported as such, rather than dying at the ciphertext selector with 'missing F ciphertext field' — a crypto-layer error for a problem that is nothing of the sort."*

**What we do build is the record, not the choice.** `unpack` returns the peer's revision, and [[TSP-JS-CHANGELOG]] places the rest with us: *"How a caller learns what a peer speaks; persisting it per peer belongs above this package."* Keyring stores the observed revision per VID and surfaces it as a diagnostic — which peer cannot yet read us, and since when. It never feeds back into what we pack.

### 2.3 The cutover is a build-time wiring choice

Which packer is wired is a property of a build, decided at the DI registration in `vti-client`/`trust-tasks`, not a user-facing setting and not a runtime toggle. A wallet setting that changed wire revision would be a support burden with no user meaning — a user cannot know what their counterparty speaks. The reference rungs take the packer as a parameter so both revisions stay testable from one tree.

### 2.4 Rev 3 is what makes hardware custody reachable on the send path

Under HPKE-Auth the sender performs a static-key DH; `hpke.ts:110` (`authEncap`) is the only place the send path consults `senderKeyAgreement.agree()`, and X25519 cannot live in the Secure Enclave or StrongBox. [[TSP-JS-CHANGELOG]]: *"HPKE-Auth → HPKE-Base. The sender's key leaves the KEM."* After the cutover a sending device needs only an Ed25519 signing key, which both platforms can hold. This is a consequence to record, not a reason to rush: [`community_vetting_subtask.md`](./community_vetting_subtask.md) §2.4 chooses a hardware target by measurement under Rev 2, and that choice should be revisited here rather than pre-empted there.

---

## 3. Constraints

### 3.1 What changes on the wire

From [[TSP-JS-CHANGELOG]], each item a change we must make rather than receive from the package:

| Change | Quoted | Ours or theirs |
| --- | --- | --- |
| HPKE mode | *"HPKE-Auth → HPKE-Base. The sender's key leaves the KEM"* | **ours** — `hpke.ts` |
| `info` / AAD | *"`info` is the fixed code `YTSP-`; the AAD is `TSP_Version ‖ VID_sndr ‖ VID_rcvr`, where Rev 2 passed the envelope frame as `info` with empty AAD"* | **ours** — two call sites in `direct.ts` |
| Ciphertext | *"Ciphertext code `G` → `F`, and the field is `enc ‖ ct`; Rev 2 put `enc` last"* | **ours** — `packWithHops`/`unpack` |
| Signature | *"The signature is indexed (`B#`) under length-based counts `-C23 -K22`"* | **ours** — `encodeSignatureFrame`/`decodeSignatureFrame`, which hardcode `SIG_QUADLETS = 22` |
| Frame assembly | *"`encodeEnvelope` is gone; Rev 3's `encodeFields` + `finalizeFrame` replace it, and the split is where the AAD boundary falls"* | **ours** — `direct.ts` imports `encodeEnvelope`/`decodeEnvelope` by name |
| Thread digest | *"self-addressing over the message's own envelope and payload with its own slot filled by 33 dummy bytes, carried on the wire, and recomputed by the receiver, which refuses the message on a mismatch"* | **ours** — replaces `sha256(payloadFrame)` |
| Version marker, count codes, master table, trailing marker, payload layouts | *"Version `YTSP-AAB` → `YTSP-AAC`"*, *"Long count codes `-0X#####` → `--X#####`"*, *"The trailing `X 00 00` marker is deleted"* | **theirs** — arrives with the package |

`ports.ts`, `credo-tsp-adapter` and `TspCarriage` are revision-agnostic and unchanged. `PackKeys`/`UnpackKeys` lose `senderEncryptionKey`, which *"survives on `UnpackKeys` as an optional, Rev 2-only member, because HPKE-Auth cannot open a message without it."*

### 3.2 The revision is readable without keys

[[REVISION-TS]]: *"the revision is readable without any keys, at a fixed offset, before anything else is parsed"* — `peekRevision` reads at most nine bytes. MAJOR gates processability; MINOR never refuses a message.

### 3.3 The mediator ingress classifier breaks above 12,285 bytes

**This is the one finding that is ours, and it is not in [[REV3-MIGRATION]].**

Rev 2's `-E` count covered only the envelope header, so it was always short-form and a TSP frame always began `0xF8` / base64url `"-E"`. Rev 3 widens that count to cover the ciphertext, so any message past the 12-bit count limit is framed long — leading byte `0xFB`, text `"--"`. [[TSP-JS-CHANGELOG]] fixes `isTsp` in `tsp-js` to accept both, but the classifier Keyring actually rides is in a **different package**: `vti-didcomm-js`'s `mediator-transport.js:536` routes an inbound frame to the TSP consumer with `text.startsWith("-E")`, and falls through to the DIDComm unpacker otherwise.

Upstream names the consequence in `wire.ts`: *"An ingress classifier that knows only `0xF8` starts dropping large messages the moment Rev 3 is switched on."*

Measured, not inferred — the check in [`2026-09-15-bm.md`](./2026-09-15-bm.md) reproduces the count-code encoding from `wire.ts` and runs the classifier's own predicate over it. R1 turns it into a runnable rung, so the boundary is asserted on every ladder sweep rather than re-derived by hand:

```
demuxed as TSP   text="-EBk…" byte0=0xf8    300 bytes — Rev 2, any size
demuxed as TSP   text="-EPo…" byte0=0xf8   3000 bytes — Rev 3, small
demuxed as TSP   text="-E__…" byte0=0xf8  12285 bytes — Rev 3, at the limit
MISROUTED        text="--EA…" byte0=0xfb  15000 bytes — Rev 3, long form
```

**The threshold is inside our range.** Our attestation fixtures are ~7.3 KB (`ref-06p5-attestation-binding/fixtures/attestation-production.json`) and a captured witnessed edge ~6.6 KB (`ref-07-dtg-edge-semantics/`); a witnessed exchange carrying both parties' hardware attestation chains plus the task envelope crosses 12,285 bytes. The failure is silent at the protocol layer and arrives as a DIDComm decode error, so it would be diagnosed as a message-format bug rather than a size threshold.

**Consequence:** the transport fix is a precondition for switching the packer on, and P1 proves it before any crypto work starts.

### 3.4 Rev 3 gates application messages on a relationship

[[TSP-JS-CHANGELOG]]: *"Rev 3 gates application messages on a relationship, so without these a peer enforcing §7.2.2 drops everything a client sends — silently, since a dropped message answers nothing."* `packInvite` / `packAccept` / `packCancel` and the §7.2/§7.3 state machine are new in 0.3.0.

This supersedes a position in a sibling: [`pnm_cnm_subtask.md`](../openvtc-integration-plan/pnm_cnm_subtask.md) §6 item 5 records TSP's relationship control FSM as *"declared-but-dead (`XRFI`/`XRFA`/`XRFD` markers exist … with no reader or writer)"*. True at that pin; under Rev 3 the markers are load-bearing and a client that ignores them is silently mute.

### 3.5 The version marker's MINOR encoding is contested upstream — conditional

Three implementations disagree on how to read the three version characters. `tsp-js` packs `YTSP-AAC` (MAJOR.MINOR, MINOR = 2); the published §9.1 text reads MAJOR, MINOR, PATCH and gives `YTSP-ABA` (MINOR 64); `affinidi-tsp` emits `AAC`. Upstream's resolution is to ignore MINOR entirely, which makes all three interoperate.

**Conditional design:** we follow the same rule — match Rev 2's MINOR exactly, read everything else at MAJOR 0 as Rev 3 — and do not enumerate known-good MINORs. If the argument resolves toward MINOR carrying meaning, §3.2 and the dispatcher change together. §5 asks for the resolution.

### 3.6 No Rev 3 release exists

`@openvtc/vti-tsp-js` on npm is 0.1.0 and 0.2.0, last published 2026-08-17, both Rev 2. 0.3.0 exists only on `feat/tsp-rev2-rev3-dual-handler`. We are pinned to **0.1.0 with a local patch** (`.yarn/patches/@openvtc-vti-tsp-js-npm-0.1.0-*.patch`) working around Hermes throwing on `TextDecoder`'s `fatal` option; any Rev 3 upgrade re-derives it, which is an argument for upstreaming it (§5).

Note the asymmetry: [[REV3-MIGRATION]] tracks the Rust `tsp-sdk`'s `rev3` branch; our framing comes from the JS package. Different release trains, and the migration document does not cover the JS one.

---

## 4. Phases

No dates. This work is gated on an upstream release, and the parent's Prague path is designed not to wait for it.

### R0 — Record the positions

§2 adopted, this document and its companion merged, and the superseded positions corrected in place: `pnm_cnm_subtask.md` §6 item 5 (§3.4) and `community_vetting_subtask.md` §2.4's hardware-custody sequencing (§2.4).

**Done when:** both siblings carry a one-line correction pointing here.
**Blocked on:** nothing.

### R1 — The demux regression, as a runnable rung

The check in [`2026-09-15-bm.md`](./2026-09-15-bm.md)'s appendix is evidence in a document, which is the wrong place for something the next person needs to re-run after every upstream bump. It becomes a reference rung, `tsp-reference/ref-2x-rev3-demux/`, in the ladder's existing shape — `run.mjs` plus a `package.json` exposing `start` (verbose walk-through) and `check` (quiet pass/fail), so it joins the sweep `for d in ref-*/; do (cd "$d" && npm run -s check); done` (`tsp-reference/README.md`).

**Two modes, because they have different dependencies:**

- **Offline (the default, and what `check` runs).** Synthesise Rev 2 and Rev 3 `-E` count codes from upstream's own constants, above and below the 12,285-byte boundary, and assert the classifier's verdict on each. Deterministic, no network, no mediator, no Rev 3 crypto — so it stays green in the ladder sweep and fails loudly the day `vti-didcomm-js` changes the predicate or `tsp-js` changes the framing. The constants are pinned in the rung rather than imported, with the upstream file and SHA cited beside each, so the test reports *what changed* rather than silently tracking it.
- **Live (opt-in, `npm start -- --mediator <url>`).** The same messages through a real VTI mediator over `vti-didcomm-js`'s transport, recording the outcome of each. Gated behind the flag because the ladder must stay runnable without infrastructure.

**Done when:** `npm run check` passes offline and is part of the sweep; the boundary is asserted, not printed; the live mode has been run once against a real mediator and its outcome recorded in the rung's README — the failure reproduced end to end, or shown not to occur with the reason measured; §5 request 2 is filed with that evidence either way.
**Blocked on:** nothing. This needs no Rev 3 crypto and no Rev 3 release — only Rev 3 *framing bytes*, which the rung synthesises.

### R2 — Build against 0.3.0

Track `feat/tsp-rev2-rev3-dual-handler`; re-derive the Hermes patch against it; add the branch to `setup-external.mjs` pins with a logged reason.

**Done when:** the workspace resolves a 0.3.0 build, `yarn typecheck` names every one of our call sites that the API break invalidates (`encodeEnvelope`, `TSP_HPKEAUTH_CIPHERTEXT`, `PackKeys.senderEncryptionKey`), and the patch applies.
**Blocked on:** upstream publishing 0.3.0 or tagging the branch (§5 request 1).

### R3 — HPKE-Base

`hpke.ts`: `MODE_AUTH` → Base, `authEncap`/`authDecap` collapse to single-DH `encap`/`decap`, `kem_context` becomes `enc ‖ pkRm`, and the `info`/AAD arguments swap construction at both call sites.

**Done when:** known-answer tests pass against RFC 9180 **A.2 base-mode** vectors (the same suite our constants already name — KEM `0x0020`, KDF `0x0001`, AEAD `0x0003`); the send path no longer calls `keyAgreement.agree()`, asserted by a test double that throws if it is called.
**Blocked on:** R2.

### R4 — Framing and the self-addressing digest

`direct.ts` onto `encodeFields`/`finalizeFrame`, the `F` ciphertext code, `enc ‖ ct`, the indexed signature, and `TSP_Digest` computed, carried and verified.

**Done when:** a round trip matches upstream's Appendix A vectors (`tests/interop.spec-vectors.mjs` shape); a tampered digest is refused; `threadDigest`'s meaning change is recorded — it has no consumers outside `direct.ts` today, and this is the phase that makes it a verified on-wire field rather than a local hash.
**Blocked on:** R3.

### R5 — Relationship control

`packInvite`/`packAccept`/`packCancel` and the §7.2/§7.3 state machine wired into the carriage, so a peer enforcing §7.2.2 accepts our application messages.

**Done when:** an application message sent without a formed relationship is refused locally rather than silently dropped by the peer; invite/accept round-trips against upstream's own state machine; the race and cancel resolutions are covered.
**Blocked on:** R4.

### R6 — Cutover and the per-peer record

The packer wired by DI (§2.3); the observed revision stored per VID and surfaced as a diagnostic (§2.2); the Rev 2 codec kept read-only.

**Done when:** a Rev 2 message is read and reported as Rev 2 rather than failing in the ciphertext selector; the per-VID record survives a restart; no code path selects a packer from it.
**Blocked on:** R5, and R1's transport fix being in place.

### R7 — Interop

Against upstream's own client and a running VTA/mediator on Rev 3.

**Done when:** a Trust Task round-trips both directions with upstream's implementation; a message above 12,285 bytes survives the mediator; the Rev 2 fixtures in `ref-00…04` are marked with the revision that produced them and retained rather than regenerated.
**Blocked on:** R6 and upstream's services running Rev 3.

---

## 5. Requests to upstream

1. **Publish 0.3.0**, or tag `feat/tsp-rev2-rev3-dual-handler`, so consumers can build against Rev 3 before the flag day.
2. **`vti-didcomm-js`'s mediator transport classifies TSP with `text.startsWith("-E")`** (`mediator-transport.js:536`) and so misroutes Rev 3's long-framed messages — everything above 12,285 bytes. `tsp-js` already fixed its own `isTsp` to accept `0xFB`; the transport needs the same fix, or should import that predicate. Evidence: §3.3.
3. **Does the mediator *server* share the classifier?** Our measurement covers the JS client transport only. If ingress or storage on the mediator classifies the same way, the fix is needed on both sides before either endpoint can switch.
4. **Resolve the MINOR encoding** (§3.5) — `AAC` vs `ABA` — or state that MINOR is permanently unjudged, so implementations stop carrying three readings.
5. **Take our Hermes `TextDecoder` patch upstream** (§3.6), with the React Native portability items in [`community_vetting_subtask.md`](./community_vetting_subtask.md) §9.
