<h1 align="center"><b>VRC Reference Implementation</b></h1>

<p align="center">
A reference implementation of <b>Verifiable Relationship Credentials (VRCs)</b> and <b>Witnessed VRC Exchange</b> using DIDComm v2 and JSON-LD credentials.
</p>

---

## Overview

This demo implements:

1. **VRC (Verifiable Relationship Credential)** - A credential establishing a directional relationship between two entities
2. **Witnessed VRC Exchange** - A third-party attestation protocol where a trusted Witness verifies and attests to mutual credential exchanges

### Key Concepts

| Term      | Description                                                                                |
| --------- | ------------------------------------------------------------------------------------------ |
| **R-DID** | Relationship DID - A unique `did:peer:0` generated for each relationship                   |
| **VRC**   | Verifiable Relationship Credential - A signed credential from issuer → subject             |
| **VP**    | Verifiable Presentation - A VRC wrapped with a challenge/domain for submission             |
| **VWC**   | Verifiable Witness Credential - Attestation from a Witness that it observed a VRC exchange |

---

## Prerequisites

- Node.js v22+
- Yarn package manager

```sh
# Install dependencies
cd vrc_reference
yarn install
```

---

## Wallet Management

Wallet data persists between runs. Use these commands to manage wallet state:

```sh
# Delete all wallets (alice, bob, witness) for a clean start
yarn fresh

# Start an agent with a fresh wallet
yarn alice --fresh
yarn bob --fresh
yarn witness --fresh

# Or use the shorthand scripts
yarn alice:fresh
yarn bob:fresh
yarn witness:fresh
```

### Wallet Storage Location

- **Default:** `./.wallets/<agent-name>/` (local to the vrc_reference folder)
- **Custom:** Set `VRC_WALLET_PATH` environment variable

```sh
# Use custom wallet location
VRC_WALLET_PATH=/tmp/test-wallets yarn alice

# The .wallets folder is gitignored, so wallet data won't be committed
```

### Startup Messages

When an agent starts, it reports wallet state:

| Message                                 | Meaning                             |
| --------------------------------------- | ----------------------------------- |
| `🆕 Starting with FRESH wallet`         | Wallet was deleted, starting clean  |
| `Wallet loaded (empty - no prior data)` | Using existing empty wallet         |
| `⚠️ Wallet loaded with EXISTING data`   | Prior connections/credentials exist |

---

## Demo 1: Basic VRC Exchange (2 Terminals)

A simple credential exchange between Alice and Bob.

### Setup

Open **2 terminals** side by side:

```sh
# Terminal 1 - Alice
yarn alice

# Terminal 2 - Bob
yarn bob
```

### Steps

1. **Create Connection**

   - Bob: Select `Create connection invitation`
   - Copy the invitation URL
   - Alice: Select `Receive connection invitation` → paste URL
   - ✓ Connection established, R-DIDs exchanged automatically

2. **Issue Credential**

   - Bob: Select `Offer credential`
   - Alice: Select `Yes` to accept
   - ✓ VRC issued and stored

3. **View Credentials**
   - Alice: Select `List stored credentials`

---

## Demo 2: Witnessed VRC Exchange (3 Terminals)

A witnessed exchange where both parties submit VRCs to a trusted Witness who attests to the mutual exchange.

### Setup

Open **3 terminals**:

```sh
# Terminal 1 - Alice
yarn alice

# Terminal 2 - Bob
yarn bob

# Terminal 3 - Witness
yarn witness
```

### Steps

#### Step 1: Connect Everyone to the Witness

```
┌─────────┐         ┌─────────┐         ┌─────────┐
│  Alice  │◄───────►│ Witness │◄───────►│   Bob   │
└─────────┘         └─────────┘         └─────────┘
```

1. **Witness** → Select `Create connection invitation`
2. Copy the URL
3. **Alice** → Select `Receive connection invitation` → paste URL
4. Wait for connection to complete

5. **Witness** → Select `Create connection invitation` (again)
6. Copy the URL
7. **Bob** → Select `Receive connection invitation` → paste URL
8. Wait for connection to complete

#### Step 2: Connect Alice and Bob

```
┌─────────┐◄───────────────────────────►┌─────────┐
│  Alice  │         R-DID Exchange      │   Bob   │
└─────────┘                             └─────────┘
```

1. **Bob** → Select `Create connection invitation`
2. Copy the URL
3. **Alice** → Select `Receive connection invitation` → paste URL
4. Wait for R-DIDs to be exchanged (you'll see the confirmation messages)

#### Step 3: Create Witnessed Session

1. **Witness** → Select `Create witnessed session`
2. Select the connection for **Alice** (enter number)
3. Select the connection for **Bob** (enter number)
4. ✓ Session created and challenge sent to both participants

Both Alice and Bob will see:

```
[alice/bob] received session challenge from Witness!
  Session ID: <uuid>
  Challenge: <nonce>
  Domain: witnessed-exchange
[alice/bob] Use "Submit VP to Witness" to participate in the witnessed session.
```

#### Step 4: Submit VPs to Witness

Both participants submit their VRCs wrapped in Verifiable Presentations:

1. **Alice** → Select `Submit VP to Witness`

   - Auto-selects Bob as counterparty
   - Confirm with `Yes`
   - ✓ VP submitted

2. **Bob** → Select `Submit VP to Witness`
   - Auto-selects Alice as counterparty
   - Confirm with `Yes`
   - ✓ VP submitted

#### Step 5: Receive Witness Credentials

Once **both** presentations are received, the Witness automatically:

1. Verifies each VP (challenge, signatures, freshness)
2. Issues VWCs to both Alice and Bob

Both participants will see a credential offer. Accept it:

- **Alice** → Select `Yes` to accept
- **Bob** → Select `Yes` to accept

#### Step 6: View Witness Credentials

1. **Alice** → Select `List stored credentials`
2. **Bob** → Select `List stored credentials`

Each party now has a VWC attesting to the witnessed exchange!

---

## What the Witness Verifies

When a VP is submitted, the Witness performs 4 checks:

| Check         | What It Verifies                                 |
| ------------- | ------------------------------------------------ |
| **Context**   | Challenge and domain match the session           |
| **Type**      | Credential is a `RelationshipCredential`         |
| **Identity**  | VRC signature is valid (issuer controls the key) |
| **Freshness** | VRC was issued within the last 5 minutes         |

---

## Understanding the VWC Structure

```json
{
  "@context": ["https://www.w3.org/2018/credentials/v1", "https://trustoverip.org/credentials/witnessed-exchange/v1"],
  "type": ["VerifiableCredential", "WitnessedCredential"],
  "issuer": "<witness-did>",
  "credentialSubject": {
    "id": "<witness-did>",
    "session": {
      "id": "<session-uuid>",
      "witnessId": "<witness-did>",
      "startTime": "...",
      "expirationTime": "..."
    },
    "witness": {
      "nonce": "<challenge-used>"
    },
    "witnessedCredentials": [
      {
        "id": "<vrc-issuer-did>",
        "digest": "sha256:<hash-of-vrc>",
        "issuer": "<who-issued-the-vrc>",
        "subject": "<who-received-the-vrc>",
        "type": ["VerifiableCredential", "RelationshipCredential"]
      }
    ]
  }
}
```

### What This Proves

- **Alice's VWC** → Alice issued a VRC to Bob, witnessed in session X
- **Bob's VWC** → Bob issued a VRC to Alice, witnessed in session X
- **Same Session** → Both VWCs share the same `session.id` and `nonce`
- **Bidirectional** → The cross-referenced DIDs prove mutual acknowledgment

---

## Troubleshooting

### "No active witnessed session"

Wait for the Witness to create a session and send the challenge before selecting "Submit VP to Witness".

### "No R-DID found for counterparty"

Ensure Alice and Bob are connected to each other (Step 2), not just to the Witness.

### Credential offer not appearing

Check that both parties submitted their VPs. The Witness auto-issues VWCs only after receiving **both** presentations.

---

## Testing

### Running Tests

```sh
# Run all tests (including mediated connection tests)
yarn test

# Run specific test suites
yarn test __tests__/integration/witnessedFlow.test.ts
yarn test __tests__/integration/connectionFlow.test.ts
yarn test __tests__/integration/connectionMediatedFlow.test.ts

# Run with coverage
yarn test:coverage
```

### Mediated Connection Tests

The test suite includes comprehensive tests for DIDComm connections through a mediator (e.g., for agents behind NAT/firewall).

**Configuration:**
1. Copy `.env.sample` to `.env`
2. Set `MEDIATOR_INVITATION_URL` to your mediator's OOB invitation URL
3. Tests will automatically run if mediator is configured, or skip if not

```sh
# Example .env configuration
MEDIATOR_INVITATION_URL=https://aries-mediator.example.com/?c_i=eyJ...
MEDIATOR_CONNECTION_TIMEOUT=30000
```

**Test Coverage:**
- ✅ Connection establishment through mediator
- ✅ DID exchange via mediated transport
- ✅ WebSocket transport verification
- ✅ Mediator initialization timing
- ✅ Error handling and timeout scenarios

**Comparing Direct vs Mediated:**
```sh
# Direct HTTP connections (default)
yarn test connectionFlow.test.ts

# Mediated WebSocket connections (requires mediator)
yarn test connectionMediatedFlow.test.ts
```

For detailed information about mediated connection testing, see [`__tests__/integration/MEDIATED_TESTING.md`](./__tests__/integration/MEDIATED_TESTING.md).

---

## Debug Mode

For detailed DIDComm and credential logs:

```sh
export CREDO_LOG_LEVEL=debug
yarn alice  # or bob/witness
```

---

## Architecture

```
src/
├── Alice.ts              # Alice agent (holder/subject)
├── AliceInquirer.ts      # Alice CLI interface
├── Bob.ts                # Bob agent (issuer)
├── BobInquirer.ts        # Bob CLI interface
├── Witness.ts            # Witness agent (session manager, VWC issuer)
├── WitnessInquirer.ts    # Witness CLI interface
├── BaseAgent.ts          # Shared agent configuration
├── Listener.ts           # Event handlers
├── documentLoader.ts     # JSON-LD context resolution
├── relationshipContext.ts      # VRC context definition
└── witnessedExchangeContext.ts # VWC context definition
```

---

## Documentation

| Document | Description |
|---|---|
| [`WITNESSED_FLOW.md`](./WITNESSED_FLOW.md) | Detailed walkthrough of all 5 phases of the witnessed exchange flow |
| [`BIFOLD_FLOW_ALIGNMENT.md`](./BIFOLD_FLOW_ALIGNMENT.md) | Alignment analysis between these reference tests and the app implementation in `core/src/modules/vrc` |

---

## References

- [ToIP DTGWG VWC Specification](https://github.com/trustoverip/dtgwg-cred-tf)
- [Credo-TS Documentation](https://credo.js.org)
- [DIDComm v2 Specification](https://identity.foundation/didcomm-messaging/spec/)
