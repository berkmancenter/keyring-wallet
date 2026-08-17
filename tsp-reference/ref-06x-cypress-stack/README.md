# ref-06x — the full stack at the Cypress release, measured joint by joint

**Question this rung answers:** step 3 of the build-up phasing — *"Alice and
Bob with DIDComm 1 + Cypress VTA/VTI (affinidi mediator, webvh hosting)"* —
composed from the wallet side, with every joint measured rather than assumed.
14 checks, all pass.

**Run:** bring up a local VTA (see [`ref-05`](../ref-05-local-vta/), same
setup; the Cypress-built binary), then `npm install && node run.mjs`.

## The four acts

1. **The Cypress VTA** (release binary, local): alive; self-hosts its
   `did:webvh` log; the capability ladder is readable by wallet-side code
   (fresh VTA baseline = `VTARest`; enabling more is ref-05's territory).
2. **webvh at the wallet — FINDING:** Credo 0.6.3 **cannot resolve
   `did:webvh`** (`unsupportedDidMethod`). The workaround is ~20 lines —
   fetch `did.jsonl`, take the last entry's state — and this rung's own code
   is the existence proof. For Keyring: a small resolver adapter is needed
   before the app touches Cypress DIDs; possibly worth contributing to Credo
   as a resolver module (decide-together item).
3. **The mediator dialect — FINDING (measured, not assumed):** the Cypress
   mediator's own `did:webvh` resolves wallet-side and names its endpoint;
   the client package (`vti-didcomm-js`) is DIDComm **v2**
   (`didcomm-encrypted+json`) while Credo v1 emits `ssi-agent-wire`; a live
   v1 envelope POSTed at the mediator is refused (**404**). No shared
   dialect — by design, not defect. Consequence for Keyring: **v1 traffic
   keeps its own credo mediator** until the TSP transport lands (which the
   plan already says; now it is measured).
4. **The witnessed exchange, end-to-end on the current stack:** three Credo
   agents over the binding-0.2 dedicated `@type`, documents validated by
   `@openvtc/trust-tasks` **0.9.0** (real `payloadPolicy`), bilateral
   sessions with distinct challenges, the VWC carrying top-level
   `taskContext` + the **§4.9.3 task digest** (counterfeit-with-same-id
   fails the digest half, live), digest receipts on `issue`. The witness's
   issuer identity anchors on the Cypress-hosted `did:webvh`.

## What this does NOT prove

- No VTA *enrollment* of the Credo agents (admin DID, ACL, trust context) —
  that is the Prague onboarding flow, and it runs over DIDComm v2/VTARest,
  not v1; it belongs to the OpenVTC TS library integration.
- The mediator act measures dialect compatibility, not delivery through the
  Cypress mediator (there is nothing v1 to deliver — that is the finding).
- Proofs are structural stubs (`acceptUnverified`), as across the ladder;
  real DI verification is the Phase D suite's job.

## Findings ledger (for the decide-together queue)

| # | Finding | Candidate action |
|---|---|---|
| 1 | Credo 0.6.3: `did:webvh` → `unsupportedDidMethod` | Keyring resolver adapter (small); optionally upstream a Credo webvh resolver module |
| 2 | Cypress mediator refuses v1 (404; v2-only by design) | none upstream — validates the plan's dual-stack transport strategy |
