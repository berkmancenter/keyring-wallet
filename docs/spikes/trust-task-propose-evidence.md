# Trust Task propose exchange — first live evidence (2026-08-18, e2e run 3)

Captured from Android logcat (inviter side, `Pixel_6_API_33` emulator) during the
passing `run-vrc-exchange.js` run at 16:40 local against the production mediator
(`credo-mediator.asml.berkmancenter.org`). Timestamps are local (UTC-6).

## The propose task (inviter → invitee)

Sent over binding-0.2 carriage (`~attach` on the generic task message), threaded
by exchange id:

```json
{
  "@type": "https://trusttasks.org/binding/didcomm-v1/0.2/trust-task/1.0/task",
  "@id": "624a5fc2-78ce-41b5-8ff4-ed9f05d7ddf1",
  "~attach": [{
    "@id": "trust-task",
    "mime-type": "application/json",
    "data": { "json": {
      "id": "30a50e97-18c9-402d-b26f-27fcae84705b",
      "type": "https://trusttasks.org/spec/vrc/relationships/propose/0.1",
      "threadId": "30a50e97-18c9-402d-b26f-27fcae84705b",
      "issuer": "did:peer:4zQmYAAABn22LunAU6UjMEoJMPoRurbnXceDwf3e4AvfyWuJ:…",
      "recipient": "did:peer:4zQmZhv6kuXa2Ub8Po9BJz3FN2TRPfWS4Pcpg9YXo1sbuZez:…",
      "issuedAt": "2026-08-18T22:40:48.519Z",
      "payload": {
        "relationshipDid": "did:peer:0z6Mkfs1TrvFUYGZcPhy47RBPPKoMGHKqHrQSeRh3o1kd589e",
        "witnessed": false
      }
    }}
  }],
  "~thread": { "thid": "30a50e97-18c9-402d-b26f-27fcae84705b" }
}
```

## The response (invitee → inviter)

```json
{
  "@id": "6c971bec-e4f9-4cec-8b4d-7dd7d448bc79",
  "~attach": [{
    "@id": "trust-task",
    "data": { "json": {
      "id": "649bcfd4-648d-4cd2-b191-8a5ca75b5b2b",
      "threadId": "30a50e97-18c9-402d-b26f-27fcae84705b",
      "type": "https://trusttasks.org/spec/vrc/relationships/propose/0.1#response",
      "issuer": "did:peer:4zQmZhv6kuXa2Ub8Po9BJz3FN2TRPfWS4Pcpg9YXo1sbuZez:…",
      "recipient": "did:peer:4zQmYAAABn22LunAU6UjMEoJMPoRurbnXceDwf3e4AvfyWuJ:…",
      "issuedAt": "2026-08-18T22:40:49.056Z",
      "payload": {
        "accept": true,
        "relationshipDid": "did:peer:0z6MksLF2Etvo2VwpKsriorBEneKmgxKvC4LwPc1r1BvddJsE",
        "witnessed": false
      }
    }}
  }]
}
```

Each side proposes/accepts with its own relationship DID; the thread id ties the
pair into one exchange.

## Timeline — propose interleaved with legacy issuance

```
16:40:04.485  [TrustTasks:Ceremony] inbound carriage handler registered (binding 0.2)
16:40:05.162  [DI self-test] PASS — eddsa-rdfc-2022 sign 509ms, verify 68ms, tamper rejected
16:40:48.832  [issueVrcCredential] Step 4: Offering credential
16:40:48.832  [issueVrcCredential] Hardware attestation disabled — skipping biometric evidence   (emulator)
16:40:48.836  [issueVrcCredential] Offering with proofType=DataIntegrityProof/eddsa-rdfc-2022
16:40:49.321  [TrustTasks:Ceremony] propose sent (exchange 30a50e97…)
16:40:49.373  [issueVrcCredential] ✓ Credential offer sent
16:40:49.975  [TrustTasks:Ceremony] propose#response consumed; relationship established
16:40:51.911  incoming credential proof: DataIntegrityProof / eddsa-rdfc-2022
16:40:51.984  [validateCredential] Relationship credential validation passed
16:40:54.102  [VRC:IssuedCredentialJSON] side=RECEIVER … (credential stored)
```

Propose round trip: **654 ms** (sent 49.321 → response consumed 49.975), fully in
parallel with the legacy offer — zero wall-clock cost to the exchange.

Run verdict: `✅ E2E PASSED — vrc-exchange`, credentials in both wallets,
contacts visible both sides. Raw logs: session scratchpad
(`android-logcat.log`, `e2e-run3.log`) — logcat also archived the two earlier
runs (16:25 pass without propose; 16:32 the race failure).

## Second slice: the issue leg, live (same day, ~18:13 local, roles flipped)

`PLATFORMS=ios,android` (Android pastes/sends; iOS was the deterministic
proposer). The complete exchange on one thread, from Android's logcat:

```
18:13:03.098  didexchange/1.1/request created and packed (Android as invitee — clean send)
18:13:04      didexchange response → complete   (connection in ~1.2 s)
18:13:05.393  [TrustTasks:Ceremony] propose accepted; response sent (exchange d353d1f2…)
18:13:10.744  [TrustTasks:Ceremony] issue sent (exchange d353d1f2…)
18:13:10.898  [TrustTasks:Ceremony] issue receipt sent        (receipting iOS's delivery)
18:13:11.063  [TrustTasks:Ceremony] issue receipt matched — VRC delivery acknowledged
```

Both directions' `vrc/relationships/issue/0.1` documents carried real
`DataIntegrityProof / eddsa-jcs-2022` proofs (signed with each sender's
relationship DID via the KMS; the spec declares the request proof REQUIRED and
the framework enforces presence) and distinct `vrcDigestMultibase` values
(e.g. `zQmQ3xjFCyC…` / `zQmYpENScrx…`), with receipts recomputing the digest
over the credential as accepted. The e2e runner itself asserted all four
ceremony markers before declaring PASS:
`android: trust-task exchange markers all present (propose + issue legs)`.

Shadow-mode boundaries in force: legacy issue-credential 2.0 remains the
storage authority, proofs are produced but consumed under `acceptUnverified`
until milestone 3 wires the verifier, and the RCard stays off the task.
