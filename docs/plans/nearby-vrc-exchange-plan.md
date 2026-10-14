# Nearby VRC exchange — two phones, Bluetooth, no witness

**Scope.** Two people standing together form a relationship by finding each
other's phone over Bluetooth Low Energy instead of scanning a QR code. Each confirms
a short code on both screens, then exchanges Verifiable Relationship Credentials
through the ceremony Keyring already runs. No witness is needed; when one is
available, the exchange hands off to the witnessed ceremony (§4.1). The plan keeps
the principles of the witnessed exchange:

- a live ceremony bound to a challenge;
- hardware-key signatures;
- binding in both directions between the radio leg and the task channel;
- nothing stable on the air.

It does not claim what only a witness can provide.

**What this plan does not do, and why.** It makes **no co-presence (locality)
claim** that a third party could rely on, and it emits no `locality*` member. That
is an existing decision, not a choice made here. The locality plan settles it:

> "In a two-party exchange with no witness, **the set of observers is exactly the
> set of interested parties** … both parties can produce the same artifact by
> agreement, from anywhere." … "Keyring does **not** offer a witness-free locality
> claim, and does not emit an evidence member that could be read as one."
> — [`locality-plan.md`](./locality-plan.md) §2.1, and §11 ("Not open, recorded so
> it is not reopened: witness-free peer-to-peer locality")

What Bluetooth buys here is different and still real:

- **For the two people:** they reach the right phone, the one in front of them,
  with no QR code to show or scan. The code comparison defeats a remote attacker
  who tries to sit between them.
- **For the exchange:** the evidence the locality plan says an unwitnessed exchange
  still carries, "ceremony (live, simultaneous, challenge-bound) and device
  (hardware attestation)" (§2.1).

**Dependencies.**

| What this plan needs | Owner | Status |
|---|---|---|
| The Trust Task relationship ceremony: `vrc/relationships/propose`/`#response`, `vrc/relationships/issue`, deterministic proposer, the unwitnessed path | [`openvtc-integration-plan.md`](./openvtc-integration-plan.md), shipped in `bifold/packages/core/src/modules/trust-tasks/ceremony.ts` | Shipped. The unwitnessed path is the default whenever no witness is connected (`openRelationshipExchange`, `witnessed: false`) |
| Hardware-key VRC evidence, one biometric prompt per exchange | [`docs/HARDWARE_ATTESTATION_FLOW.md`](../HARDWARE_ATTESTATION_FLOW.md) | Shipped. Keyring verifies it on the receiving phone only; nothing verifies it server-side |
| A BLE peripheral on the phone: advertising, a GATT server, long reads across two characteristics, a hardware-key signature inside the radio window | [`locality-plan.md`](./locality-plan.md) §10.3, `bifold/packages/react-native-locality-peripheral` | Shipped for Android. The iOS peripheral is proven on a device (locality-plan companion 2026-09-13-al) |
| A BLE **central** on the phone (scan, connect, write, read) | this plan, Phase 0 | **Does not exist.** No phone scans today; the only central is the witness server |
| The Android Bluetooth runtime permissions helper | keyring-bifold #327 (`bluetoothPermissions.ts`) | Open draft. Asks for `BLUETOOTH_ADVERTISE` + `BLUETOOTH_CONNECT`; this plan adds `BLUETOOTH_SCAN` |

**Reviews.** See [`nearby-vrc-exchange-plan/`](./nearby-vrc-exchange-plan/):

| Companion | Contents |
|---|---|
| [2026-10-11-al.md](./nearby-vrc-exchange-plan/2026-10-11-al.md) | The request, the conflict with the locality plan's closure and how this plan stays inside it, the three shapes considered (rendezvous, offline carriage, phone-as-witness) and why rendezvous comes first |
| [2026-10-14-al.md](./nearby-vrc-exchange-plan/2026-10-14-al.md) | The product owner's answers on the two open questions: the offline carriage is wanted but optional (Phase 3, later, blocking nothing), and Nearby hands off to the witnessed ceremony when a witness is available (§4.1) |

---

## 1. Today's exchange, and what changes without a witness

### 1.1 The flow today (QR + optional witness)

1. **Connect.** One person shows a QR code (`QRCodeExchangeSlider`, "Generate QR
   Code") holding an out-of-band invitation. The other scans it. The two wallets
   establish a DIDComm connection through their mediators.
2. **Discover and propose.**
   - The side whose connection DID sorts lower proposes (`isDeterministicProposer`).
   - It first asks `trust-task-discovery/0.1`, then sends `vrc/relationships/propose/0.1`
     with `{relationshipDid, witnessed}`.
   - The responder sees `RelationshipProposalModal`. That is the ceremony's one
     consent question.
3. **Sign.** Each side builds its VRC (`buildVrcCredential`). It signs the
   credential under one biometric prompt with the hardware key (Secure Enclave /
   StrongBox / TEE) and attaches the `HardwareAttestationEvidence` block
   (`prepareVrcCredentialWithEvidence`).
4. **Witness (optional).** Each party runs its own `witness/session` with a
   connected witness. The witness issues a challenge and, if it offers locality, a
   sensor directive. The phone advertises a per-session ephemeral identifier (EID)
   derived from that challenge. The witness's sensor scans for it, writes a
   `sensorNonce` over GATT, and reads back a hardware-key signature over
   `{taskDigest, challenge, sensorNonce, sensorDid}`. The witness then returns a
   Verifiable Witness Credential (VWC) carrying `locality*` members.
   (`locality-plan.md` §5.1–§5.4, `witnessCeremony.ts`.)
5. **Issue.** Each side sends `vrc/relationships/issue/0.1 {vrc, vrcDigestMultibase}`
   under a document proof by its relationship DID. The peer verifies and stores the
   credential. Witnessed pairs then exchange their VWCs (`witness-share`).

Every leg except the witness's sensor leg runs over the network, through the
mediators.

### 1.2 What the witness contributes, and what is lost without one

The witness supplies all of the following (`locality-plan.md` §1, §5):

- an observer "with no stake in the meeting";
- the challenge from which the EID is derived;
- the `sensorNonce`;
- the timing and RSSI measurements on its own clock;
- the venue claim;
- a signed observation;
- the VWC itself, bound to the session (`taskContext`, `taskDigestMultibase`).

**Without a witness, every one of these is gone, and nothing in this plan stands in
for it.** In particular:

- **No third-party co-presence evidence.** Two phones can produce any proximity
  transcript by agreement, from anywhere (§2.1). Adding hardware attestation raises
  that only to "two genuine attested apps produced this".
- **No `locality*` members, no VWC, no venue.**
- **No independent clock.** Any round-trip time one phone measures, it measures for
  itself, and it does not bind the other party.

### 1.3 What a nearby exchange keeps, and what it adds

The nearby exchange keeps the following:

- **Device evidence.** It is unchanged: the same `HardwareAttestationEvidence` block
  in each VRC, verified by the receiving phone.
- **Ceremony evidence.** The exchange is live and simultaneous, and it is bound to
  challenges that both phones contribute over the radio (§2.4).
- **The consent model.** It is unchanged: one relationship question (§4).

It adds:

- **A local rendezvous.** The phones find each other over BLE. Nothing is shown or
  scanned.
- **Human-verified channel authentication.** Both screens show the same
  short-authentication string (SAS). Each person confirms the code matches.
- **A binding from the confirmed BLE session to the network ceremony.** The `propose`
  that follows must carry the digest of the BLE session the two people confirmed, or
  it is refused.

The default carriage stays the mediator (`didcomm-v1` / `didcomm-v2` / `tsp`).
Bluetooth replaces the QR code and authenticates the start of the connection. It
does not replace the network. Carrying the exchange itself over Bluetooth, so it
works offline, is an optional later phase (Phase 3, §5).

---

## 2. Security and proximity properties

### 2.1 What "nearby" means here, stated honestly

The claim the app may make is **"you confirmed the code with the phone you were
talking to"**. It is not "this phone was within N metres". BLE range runs from a few
metres to a few tens of metres, and it can be relayed. That limits what this plan
can promise:

- **For the two people:** proximity is something they establish themselves, by seeing
  each other and seeing the same code.
- **For anyone else:** there is no proximity evidence at all (§1.2).

Copy follows the same discipline as the locality plan's "at the venue, never at the
table" (§1). The UI says **"Exchanged nearby"**, never "Confirmed in person". The
second phrase is reserved for a witness-confirmed exchange (`locality-plan.md` §8.4).

### 2.2 Pairing and the confirmation code

**Bluetooth link-layer pairing is not used.** LE Secure Connections numeric
comparison would need the OS bonding dialog. That creates a persistent bond, and the
app does not control the code. Authentication is done at the application layer over
an unbonded GATT connection, with the same commit-then-reveal shape the locality
survey specified for SAS (locality-plan companion 2026-07-20-bam §4.4, §8.5), as
used in ZRTP (RFC 6189, the Short Authentication String):

1. The **host**, the phone in "Show" mode, generates:
   - an ephemeral X25519 key pair `(eH, EH)`;
   - a 32-byte nonce `nH`.

   Its `hello` characteristic exposes `{v, EH, commitH = SHA-256(nH)}`.
2. The **joiner**, the phone in "Find" mode, connects. It writes
   `{EJ, nJ}` to `join`, where `nJ` is its own fresh 32-byte nonce.
3. The host now reveals `nH` on `reveal`. The joiner checks it against `commitH`.
   Because the host committed before it saw `nJ`, neither side can search for a
   colliding code.
4. Both sides derive the following, where `t = SHA-256(JCS({v, EH, EJ, nH, nJ}))` is
   the transcript hash:
   - `k = HKDF-SHA256(X25519(e, E'), salt=t, info="keyring-nearby-v1")`;
   - `sas = first 20 bits of HKDF(k, info="sas")`, shown as **6 digits**.

   20 bits gives a one-in-a-million chance per attempt. The ceremony allows one
   attempt per session.
5. Each person compares the code on their own screen with the other phone's and taps
   **Match** or **Doesn't match**.
   - A mismatch, a cancel, or no confirmation within the window ends the session. The
     app offers no retry with the same keys.
   - The code is never sent over the air. Only humans compare it.
6. After both taps, every further GATT payload travels under AEAD (ChaCha20-Poly1305,
   key `k`). This includes the host's out-of-band invitation, the binding (§2.4) and
   the acknowledgements.

**Rejected:** comparing an emoji or word list instead of digits. It is a display
choice for later, not a design choice. The 20-bit entropy and the single attempt are
what matter.

**Rejected:** confirming on one phone only. A one-sided match leaves the other person
unable to detect a man-in-the-middle on their own link.

### 2.3 Discovery: what is on the air

- **The host advertises.** It advertises one 128-bit service UUID: a fixed 4-byte
  prefix (`KRN1`) followed by a 12-byte random session id, fresh for every "Show".
  The advert carries **no name, no DID and no profile**. iOS allows only a local name
  and service UUIDs in an advert (`locality-plan.md` §5.3), and the name is left
  empty.
- **The joiner finds the host.** It scans for the prefix and lists hosts in order of
  signal strength. Each entry is labelled only by a two-symbol tag derived from the
  session id. The host's screen shows the same tag ("Look for 🦊🌵 on their phone").
  Tags help pick the right phone in a crowded room. **They are not a security
  control**: the code in §2.2 is.
- **Advertising is limited to the open screen.** The host advertises only while the
  "Show" screen is open, and stops after 120 s. No GATT fields carry identity before
  the code is confirmed.

### 2.4 Binding the BLE session to the network ceremony

Without a witness, the challenge comes from the two phones themselves. After both
confirm the code, the radio leg and the task leg are bound in both directions,
mirroring `locality-plan.md` §5.4:

- **From the radio to the task.** Under AEAD, the host sends its out-of-band
  invitation. The joiner accepts that invitation, and only that invitation, by the
  usual mediator route. A QR code does the same job physically. The connection that
  results is the one the two people confirmed.
- **From the task to the radio.**
  - Each side keeps the nearby session digest `t`.
  - The proposer's `propose` carries an extension member
    `ext["edu.harvard.seas.atl.keyring"].nearby = {sessionDigest: t}`, in the same
    namespace the locality extension uses.
  - The responder refuses a `propose` on that connection whose `sessionDigest` does
    not equal its own `t`, with `trust-task-error` code `nearby:mismatch`.
  - The exchange is single-use. Once `issue` completes, `t` cannot be presented
    again.
- **Signed by hardware.** Inside the one biometric window the ceremony already opens,
  each phone signs `JCS({context:"keyring-nearby-v1", t, exchangeId})` with the
  hardware key that signs its VRC evidence. It sends the signature in `issue`'s
  `ext`. The receiver verifies it against the `hardwareBinding.publicKey` in the
  sender's VRC evidence. This ties the credential to the confirmed session and the
  same device key. It is **ceremony evidence**, not a location claim.

**Conditional: whether this signature goes into the credential.** The signature and
`t` are retained locally as outcome evidence, alongside the propose/issue pair
(openvtc §8.1). **Not decided:** whether any member derived from them goes into the
VRC.

- If one ever does, it must be a `ceremony*` member that a verifier cannot read as
  co-presence. It must also be reviewed against §2.1 of the locality plan, whose
  wording forbids "an evidence member that could be read as one".
- Until that review happens, Phases 1–2 put nothing new in the credential.

### 2.5 Threats

| Threat | Status | Why |
|---|---|---|
| A remote attacker inserts itself between the two phones (BLE man-in-the-middle) | **closed** | The code on both screens differs. The commit-then-reveal design stops the attacker searching for a match (§2.2) |
| Wrong phone selected in a crowded room | **closed** | The code differs, and the two people see it |
| A passive listener records the BLE session | **closed for content** | Everything after the code is AEAD-encrypted under an ephemeral key. Before it, only the ephemeral keys, the nonces and the commitment are visible |
| Replay of a recorded session or binding | **closed** | Fresh keys and nonces each session. `t` is bound to the `exchangeId` and consumed by `issue` |
| An attacker relays a genuine `propose` over the network on another connection | **closed** | `sessionDigest` must equal the responder's own `t` for this connection (§2.4) |
| **An accomplice relays the radio for a party who is not present** | **open, by design** | Without a witness nothing measures distance on an independent clock (§1.2). It is the same residual the locality plan prices as open even with a witness (§9.2) |
| **Both parties agree to fake a "nearby" exchange** | **open, by design** | It is why no third-party claim is made (§2.1) |
| A modified app | as strong as App Attest / Play Integrity | Device evidence is unchanged. Nothing server-side verifies it (HARDWARE_ATTESTATION_FLOW, "Known limitations") |
| Denial of service: a host flooded with joiners, or a jammed radio | **accepted** | The host serves one joiner per session. The person cancels and retries; a new session means new keys |
| A genuine phone used by someone else | out of scope | It is the same position as the locality plan (§9.2). The biometric prompt is the existing control |

### 2.6 What a BLE peer or bystander can learn

- **Before the code is confirmed.** They learn that a Keyring phone is in "Show" mode,
  from the fixed prefix, together with a random per-session id, an ephemeral public
  key, and signal strength. They learn no name, no DID, no profile and nothing stable.
  The OS rotates the device's Bluetooth address.
- **A joiner that fails the code** learns the same, plus `nH`. It learns nothing about
  the person.
- **After the code is confirmed,** only the confirmed peer can read anything. That
  peer receives the out-of-band invitation, which today's QR code already gives them.
- **Residual.** The fixed prefix shows "someone here has Keyring's nearby screen open"
  for up to 120 s. **Rejected:** removing the prefix by deriving the UUID from a
  shared secret. The phones have no shared secret before they meet, and a joiner must
  recognise the advert.
- **Unchanged.** No location is recorded or sent. RSSI is used only to order the list
  on the joiner's screen and is not kept.

---

## 3. What this plan reuses

| Existing piece | Where | How it is reused |
|---|---|---|
| The peripheral: advertising, a GATT server, two-characteristic long reads under the 512-byte attribute limit, signing with the hardware key inside the window (Android `CryptoObject`, iOS App Attest assertion) | `bifold/packages/react-native-locality-peripheral` (Android `LocalityPeripheralModule.kt`, iOS `LocalityPeripheral.swift`); `locality-plan.md` §10.3 item 9 | The host role. It gains new characteristics (`hello`, `join`, `reveal`, `sealed`) and a new service prefix. It keeps the chunking, the pacing and the retry rules already learned on devices (`readFullValue()`, the cap of 80 iterations, the stale-`Device` eviction) |
| Ephemeral identifiers derived with HKDF, carried as a 128-bit UUID, one per session | `trust-tasks/deviceLocality.ts` (`deriveEid`, `serviceUuidFromEid`) | Same construction. Here the input is a fresh random value, not a witness challenge |
| JCS-canonical bindings, with parity tests across Kotlin, Swift, Hermes and Node | `deviceLocality.ts` `bindingFor`, `jcsBindingParity.test.ts` | The nearby binding in §2.4 gets a parity fixture of its own |
| Hardware-key VRC evidence and the one-prompt window | `vrc-hardware-signing.ts`, `EvidenceBuilder`; HARDWARE_ATTESTATION_FLOW | Unchanged. The nearby binding is signed inside the same window, adding no second prompt |
| The unwitnessed ceremony | `ceremony.ts` (`openRelationshipExchange`, `deliverVrcViaTrustTaskForExchange`) | Unchanged, apart from carrying and checking `ext.nearby` (§2.4) |
| The Android permission helper and the diagnosis of a missing permission (`lastFailure: permissionMissing`) | keyring-bifold #327 (`bluetoothPermissions.ts`) | Extended with `BLUETOOTH_SCAN`, declared with `android:usesPermissionFlags="neverForLocation"` (API 31+). Below API 31, location is required to scan; that gap is already noted in `locality-plan.md` §10.3 |
| A sheet that asks for permission before the flow starts, once per install | `LocalityPreflightModal`, `hasSeenLocalityPreflight` | The same pattern on the first "Show" or "Find", so the OS dialog never lands mid-exchange. This was the iOS failure the 2026-09-13 run found |
| A status store that drives the flow | `witnessStatusStore.ts` (`VrcFlowStatus`) | New states `nearby-searching`, `nearby-confirm`, `nearby-connecting` placed before `connecting` |
| Retaining outcome evidence | `trust-tasks/outcomeEvidence.ts` | Retains `t` and both binding signatures with the propose/issue pair |

**A central library, not a new native module.** The joiner role is a plain BLE
central, so `react-native-ble-plx` covers it. The locality survey ruled that library
out only because it "does not do peripheral mode" (locality-plan companion
2026-07-20-bam §8.3). The host role keeps the native peripheral module. **Not
decided:** whether to adopt ble-plx, or to add a central to the native module so both
roles share one dependency. Phase 0 measures both on devices before the choice.

---

## 4. The UI flow

The consent model stays the same. The code confirmation replaces showing or scanning
a QR code; it is not an extra question. The relationship proposal remains the one
consent question (`locality-plan.md` §8.4: locality "must not add a second question
to the ceremony"; the same rule holds here).

```
Contacts → Add contact
  ├─ QR code            (unchanged)
  └─ Nearby  ──────────────────────────────────────────────────────────────
       First time only: the Bluetooth sheet (why, what is sent, "never your
       location") → OS permission dialog.

       Person A: [Show]                        Person B: [Find]
       "Look for 🦊🌵 on their phone"          "Nearby Keyring phones"
       (advertising, 120 s)                     🦊🌵 ▂▄▆  (strongest first)
                                                ↓ tap
       ┌──────────────────────────────┐       ┌──────────────────────────────┐
       │ Does their screen show       │       │ Does their screen show       │
       │        482 913 ?             │       │        482 913 ?             │
       │  [Match]   [Doesn't match]   │       │  [Match]   [Doesn't match]   │
       └──────────────────────────────┘       └──────────────────────────────┘
                     both Match → "Connecting…" (invitation over the
                     encrypted BLE session; connection through the mediator)
                                     ↓
       Relationship proposal (the existing RelationshipProposalModal, one question)
                                     ↓
       Biometric prompt (the existing single prompt; it also signs the nearby binding)
                                     ↓
       "Relationship credential exchanged" · note: "Exchanged nearby · no witness"
```

- **Failure copy:**
  - Mismatch: "The codes didn't match. Nothing was shared. Try again."
  - Timeout: "Couldn't finish nearby. Try again, or use a QR code."
  - Bluetooth off or no permission: a direct link to Settings. The existing #327
    "Nearby devices" text applies.
- **Contacts badge.** The contact shows **"Exchanged nearby"**. A nearby exchange
  never shows the witness's "Confirmed in person" (`locality-plan.md` §8.4) unless a
  witness took part (§4.1), in which case the witness's result decides the badge.
- **Accessibility.** The code is read out by the screen reader digit by digit, and it
  can be enlarged.

### 4.1 When a witness is available

**Nearby hands off to the witnessed ceremony whenever a witness is available.**
The code confirmation and the session binding (§2.2–§2.4) run exactly as above.
Then the proposer sends `propose` with `witnessed: true`, as the ceremony already does
whenever a witness is connected and witnessing is preferred (`openRelationshipExchange`).
Each party runs its own `witness/session`, including the locality leg if the witness
offers or requires one (`locality-plan.md` §5).

- **The nearby binding still applies.** `propose` carries both `witnessed: true` and
  `ext.nearby.sessionDigest`. The responder checks the digest before anything else, so
  a witnessed ceremony cannot start on a connection the two people did not confirm.
- **The witness decides any co-presence claim.** If the witness confirms locality, the
  contact shows "Confirmed in person"; otherwise the witness's existing outcome note
  applies (keyring-bifold #327: unwitnessed, or nearby not confirmed). The nearby code
  adds nothing to that claim.
- **A witness that fails or drops out** leaves the exchange unwitnessed, as today
  ("continuing unwitnessed"), and the badge falls back to "Exchanged nearby".
- **The phone keeps one radio role at a time.** The host stops advertising its nearby
  service once both people confirm the code, before the witness's locality leg starts
  its own advert. The two adverts never overlap.

---

## 5. Phases

Each phase lists what must be true for it to be done. Every BLE phase needs
physical phones (§6).

### Phase 0 — a reference rung for the radio leg (no wallet changes)

- **Build** a standalone reference app or a developer screen, in the style of the
  `tsp-reference/` ladder. It runs the host and joiner roles of §2.2: advertising with
  the prefix and the random session id, scanning, the `hello`/`join`/`reveal`
  characteristics, the SAS derivation, and an AEAD echo once both confirm.
- **Acceptance:**
  - Code derivation, commit/reveal and the AEAD round-trip pass unit tests with frozen
    vectors, shared by TypeScript and every native side that computes them (a parity
    fixture, as with `jcsBindingParity`).
  - **Real-device runs** succeed for Android↔Android, iPhone↔Android and
    iPhone↔iPhone, in both host/joiner directions. The time from tap to code is
    recorded; the target is under 5 s at the median.
  - A third phone, injected as a man-in-the-middle relay, produces mismatched codes.
  - The choice between ble-plx and a native central (§3) is recorded in a dated
    companion with the measured numbers.

### Phase 1 — Nearby connect (Bluetooth replaces the QR code)

- **Build:**
  - The UI flow of §4 up to "Connecting…": the out-of-band invitation is carried under
    AEAD, and the joiner accepts it through the mediator.
  - The VRC exchange then runs unchanged and unwitnessed.
  - Both permission paths: Android 12+ with `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`
    and `BLUETOOTH_CONNECT`, and iOS `NSBluetoothAlwaysUsageDescription`.
  - The status states from §3 and the "Exchanged nearby" note.
  - The hand-off to the witnessed ceremony when a witness is available (§4.1).
- **Acceptance:**
  - Jest tests cover the flow store, the permission gating, and the failure paths
    (mismatch, timeout, permission missing, Bluetooth off) with a mocked radio.
  - A **two-device e2e** (Appium, physical phones, in the style of
    `e2e:vrc:devices`) completes Nearby, then a credential on both sides, then the
    contact badge reads "Exchanged nearby", for one Android+iPhone pair.
  - Nothing new appears in the VRC beyond today's unwitnessed credential: a fixture
    diff test.
  - With a witness connected, a Jest case shows that `propose` carries
    `witnessed: true`, and that a failed witness falls back to the unwitnessed path
    with the "Exchanged nearby" badge.

### Phase 2 — Bind the session to the ceremony

- **Build:**
  - `ext.nearby.sessionDigest` on `propose`, and the responder's `nearby:mismatch`
    refusal.
  - The hardware-signed binding in `issue.ext`, verified against the sender's VRC
    evidence key.
  - Retention in outcome evidence (§2.4).
- **Acceptance:**
  - `ceremony.test.ts` gains cases for a matching digest (accepted), a wrong digest
    (refused with `nearby:mismatch`), a missing digest on a nearby connection
    (refused), and a replayed `t` (refused).
  - The binding fixture passes on every runtime that signs or checks it.
  - The real-device e2e from Phase 1 passes again, with both bindings verified in the
    log.

### Phase 3 — optional, later: an offline carriage over Bluetooth

A nearby exchange that works with no network at all is **wanted but optional**. It
comes after Phases 0–2, and none of them depends on it. When it is opened, it will:

- add a `ble-gatt` carriage beside `didcomm-v1`, `didcomm-v2` and `tsp` in
  `selectCarriage`;
- carry `propose`/`#response`/`issue` over the AEAD session, chunked.

Without a mediator connection, the contact cannot be messaged later until both phones
are online. The design of that deferred connection belongs in this phase's own
subtask. Acceptance is defined when the phase is opened.

### Not in this plan

- Any co-presence or locality claim, and any `locality*` member (§2.1).
- A phone acting as witness for other people's exchanges. The locality plan rules out
  the phone as sensor, because "it inherits background-execution restrictions and
  raises the question of who attests the *sensor*" (§5.6).
- NFC or UWB. NFC between two phones is not open to iOS apps, and UWB ranging is not
  exposed to apps (`locality-plan.md` §2).

---

## 6. What needs real devices to prove

Emulators and simulators cannot run any of the BLE legs. The iOS Simulator has no
CoreBluetooth radio, and Android emulators expose no BLE controller by default. They
also produce no hardware attestation (HARDWARE_ATTESTATION_FLOW, "Implementation
Status"). Physical phones must prove:

1. Discovery, connection and the code on every platform pair, in both roles
   (Phase 0).
2. That a relaying third phone breaks the code (Phase 0).
3. Long GATT reads of the invitation under the 512-byte attribute limit. Invitation
   size grows with DIDComm v2 and routing keys (Phase 1).
4. The OS permission dialogs appear on the pre-flight sheet, not mid-exchange. On
   Android 12+ that includes `BLUETOOTH_SCAN` with `neverForLocation` (Phase 1).
5. Both apps in the foreground. On iOS a backgrounded advertiser moves its service
   UUIDs into an overflow area that non-Apple scanners cannot read
   (`locality-plan.md` §5.3). Behaviour must be defined if either person locks the
   phone mid-session.
6. The hardware-signed nearby binding verifies against the VRC evidence key on both
   platforms: App Attest assertions on iOS, `CryptoObject` signatures on Android
   (Phase 2).
7. With a witness available, the hand-off of §4.1: the nearby advert stops before
   the witness's locality advert starts, and the witnessed ceremony completes after a
   nearby code confirmation (Phase 1).
8. Low-end Android: the slow devices that needed a release build and a fixed
   mediator pickup in the locality runs (locality-plan companion 2026-09-13-al).

Unit tests with a mocked radio, and the existing simulator e2e for the unwitnessed
ceremony, cover everything above the radio.

---

## 7. Open questions

1. **Ceremony evidence in the credential.** Should any member derived from §2.4 enter
   the VRC, and under what name? It needs review against `locality-plan.md` §2.1
   before it is proposed. (Reviewer.)
2. **Central dependency.** ble-plx, or a native central in the existing module?
   (Decided by Phase 0 measurements.)
