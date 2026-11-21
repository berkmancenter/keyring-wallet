# Witnessed VRC Exchange Flow

A peer-to-peer credential exchange with third-party witness attestation and hardware-backed biometric proof.

## Participants

| Party | Role |
|-------|------|
| **Alice** | Mobile wallet (iOS/Android) |
| **Bob** | Mobile wallet (iOS/Android) |
| **Witness** | Local server that attests the exchange occurred |

## Credentials Produced

| Credential | Issuer | Purpose |
|------------|--------|---------|
| **VRC** (Verifiable Relationship Credential) | Each peer issues to the other | Proves relationship between two DIDs |
| **VWC** (Witnessed Verifiable Credential) | Witness server | Third-party attestation that exchange occurred |

## Flow Diagram

![Witnessed Exchange Flow](witnessed-exchange-flow.png)

<details>
<summary>Mermaid source</summary>

```mermaid
sequenceDiagram
    participant A as Alice
    participant W as Witness
    participant B as Bob

    %% 1. Discovery & Connection
    A->>W: Connect (via mDNS)
    B->>W: Connect (via mDNS)
    A->>B: Connect (via QR/link)
    A-->B: Exchange R-DIDs

    %% 2. Witnessed Session Request
    A->>W: session-request (my R-DID, counterparty R-DID)
    B->>W: session-request (my R-DID, counterparty R-DID)
    W->>W: Match DIDs, create session
    W->>A: challenge
    W->>B: challenge

    %% 3. Hardware Attestation (triggered by challenge)
    Note over A: Biometric prompt (FaceID)
    A->>A: Sign VRC with Secure Enclave
    Note over B: Biometric prompt (Fingerprint)
    B->>B: Sign VRC with StrongBox/TEE

    %% 4. Submit & Verify
    A->>W: VP (signed VRC + challenge proof)
    B->>W: VP (signed VRC + challenge proof)
    W->>W: Verify VP, VRC, freshness

    %% 5. Credential Issuance
    W->>A: VWC (attesting Bob)
    W->>B: VWC (attesting Alice)
    A->>B: VRC credential
    B->>A: VRC credential

    %% 6. Hardware Verification (on mobile) - soft verification
    Note over A,B: *Soft verification (incomplete)
    A->>A: Verify Bob's cert chain (Google root)
    B->>B: Verify Alice's cert chain (Apple root)
```

</details>

## Verification Layers

### Witness Server Verifies (before issuing VWC):

| Check | What it verifies |
|-------|------------------|
| **Context** | VP challenge/domain matches session |
| **Identity** | VRC signature matches claimed R-DID |
| **Freshness** | VRC issued within time window |

*Note: Witness does NOT verify hardware certificates - it only notes if attestation evidence is present.*

### Mobile App Verifies (when receiving VRC):

| Check | What it verifies |
|-------|------------------|
| **Certificate Chain** | Roots to Apple/Google attestation CA |
| **Signature** | Hardware signature over VRC content is valid |

⚠️ *Note: Certificate verification is currently **soft verification** (not fully complete - no revocation checks, limited chain validation).*

## Hardware Attestation

Each VRC includes evidence proving biometric approval:

| Platform | Key Storage | Biometric | Root CA |
|----------|-------------|-----------|---------|
| iOS | Secure Enclave | FaceID/TouchID | Apple App Attestation |
| Android | StrongBox/TEE | Fingerprint | Google Hardware Attestation |

## Result

After the flow, each wallet has:
- **1 VRC** from the other party (proves the relationship)
- **1 VWC** from the witness (third-party attestation)
- **Hardware evidence** in both credentials (proves biometric approval)
