# Witness Server for VRC Exchanges

A standalone Node.js server that implements the **Witness** role in the DTG (Decentralized Trust Graph) Witnessed Exchange protocol. The server communicates entirely over DIDComm and can participate in witnessed VRC (Verifiable Relationship Credential) exchanges between two parties.

## Overview

The Witness Server provides third-party attestation for VRC exchanges, enabling participants to prove that their relationship credentials were established in a specific witnessed session (e.g., at a conference, in a virtual meeting, or during a check-in process).

### ⚠️ Mediator Required for Mobile Apps

**For production deployments with mobile wallets, a DIDComm mediator is REQUIRED.**

Mobile platforms (iOS/Android) enforce strict security policies that prevent apps from making cleartext HTTP connections. Since the witness server communicates via DIDComm, you have two options:

1. **✅ Recommended: Use a mediator** - The witness connects to a mediator via WebSocket (HTTPS). Mobile wallets also connect to the mediator. All DIDComm messages route through the mediator. No HTTP required.

2. **❌ Not recommended: Direct HTTP** - The witness exposes an HTTP endpoint. Mobile apps can only connect if:
   - You configure dangerous "cleartext HTTP" exceptions in the app manifest
   - OR you set up HTTPS with valid certificates on the witness server
   - This defeats the purpose of the zero-HTTP architecture

**Bottom line:** Set `MEDIATOR_INVITATION_URL` in your `.env` file to use a mediator.

## Privacy by Design

The witness server is designed with user privacy as a core principle:

### No Conversation History Retention

By default, the witness **does not retain any message history** from user interactions. After a message is received and processed, it is immediately deleted from the witness's wallet storage. This ensures:

- **No record of user communications** - The witness doesn't keep logs of what users said or did
- **Minimal data footprint** - Only essential cryptographic material is stored
- **Privacy by default** - Users can interact freely without concern that their messages are being archived

### What IS Persisted

The witness only stores data that is explicitly required for its attestation function:

| Data | Purpose | Location |
|------|---------|----------|
| Issuer DID & keys | Signing VWCs | Wallet database |
| Connection records | DIDComm routing | Wallet database |
| Credential registry | VWC verification | In-memory (cleared on restart) |
| Reporting graph | Opt-in activity (requires explicit user consent) | `.reporting/` folder |

### Opt-in Activity Reporting

The `.reporting/` folder stores connection mappings and exchange edges, but **only when BOTH parties in an exchange explicitly opt in**. This is used for optional social graph features and is disabled unless users actively enable it.

### Debug Mode (Not for Production)

For development/debugging purposes, message retention can be enabled:

```bash
# NOT recommended for production - retains all messages
WITNESS_RETAIN_MESSAGES=true yarn start
```

When enabled, all DIDComm messages are retained in the wallet for audit purposes. This should only be used in development or with explicit user consent.

### Key Features

- **Pure DIDComm Communication**: All protocol interactions happen over DIDComm basic messages and credential exchange
- **QR Code Discovery**: Serves a static HTML page with a scannable QR code for mobile wallets
- **Participant-Initiated Sessions**: Either participant can request a witnessed session via DIDComm
- **Auto-Issuance**: Automatically issues Witness Credentials (VWCs) when both participants submit their VRCs
- **Session-Based Challenge**: Uses cryptographic nonces to bind credentials to specific sessions
- **Credential Verification**: Verify VWCs were issued by this server via DIDComm or HTTP API
- **Activity Log**: Web-based activity log showing all issued credentials in real-time
- **REST API**: HTTP endpoints for credential verification and registry queries
- **Locality Verification** (opt-in): BLE proximity-based proof of co-location (transport implementation coming)

## Installation

```bash
cd bifold/vrc_reference/witness-server
yarn install
```

## Docker Deployment

A Docker Compose configuration is available for containerized deployment:

```bash
cd bifold/packages/witness-server

# Build the Docker image
docker-compose build

# Start the server
docker-compose up

# Start in detached mode
docker-compose up -d

# Stop the server
docker-compose down
```

**Configuration:**

- Copy `.env.sample` to `.env` and customize your settings
- The container exposes port 9003 by default (configurable via `DOCKER_PORT` in `.env`)
- Volume mounts allow live code changes during development
- Build context is set to the bifold root to access workspace dependencies

**Environment Variables:**

The Docker container uses the same environment variables as the local installation. Configure them in your `.env` file before starting the container.

**Docker Cleanup:**

To reclaim disk space after builds:

```bash
# Remove stopped containers and unused images
docker system prune

# More aggressive cleanup (removes all unused images)
docker system prune -a
```

## Usage

### Start the Server

```bash
# Start with default settings (port 9002 for DIDComm, port 9003 for web)
yarn start

# Start with custom ports
WITNESS_PORT=9010 WITNESS_WEB_PORT=9011 yarn start

# Enable verbose logging
WITNESS_VERBOSE=true yarn start
```

### Fresh Commands

The witness server persists wallet data and connection invitations to ensure stable QR codes across restarts. Use these commands to reset to a clean state:

```bash
# Delete wallet and persisted files (.oob-invitation.json, .witness-seed.json)
yarn fresh

# Delete and start with fresh wallet
yarn start:fresh
```

**What gets deleted:**
- Wallet database (`~/.askar/witness-server-wallet/`)
- Invitation file (`.oob-invitation.json`)
- Seed file (`.witness-seed.json`)

**When to use `yarn fresh`:**
- Testing with fresh identities
- QR code needs to change (new DID required)
- Wallet corruption or out-of-sync state
- Switching between different configurations

**Note:** The server automatically detects and fixes minor out-of-sync states (e.g., if the wallet is wiped but persisted files remain). Manual cleanup with `yarn fresh` is only needed for complete resets.

### Configuration

Copy `.env.sample` to `.env` and customize. All options can be set via environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `WITNESS_PORT` | `9002` | Port for DIDComm HTTP transport |
| `WITNESS_WEB_PORT` | `9003` | Port for web interface and API |
| `WITNESS_NAME` | `witness-server` | Name/label for the witness agent |
| `WITNESS_PUBLIC_URL` | `http://localhost:{PORT}` | Public URL for DIDComm endpoint |
| `WITNESS_SESSION_EXPIRATION` | `30` | Session expiration time in minutes |
| `WITNESS_EVENT_NAME` | _(optional)_ | Event name included in VWC (e.g., "EthDenver 2024") |
| `WITNESS_VERIFICATION_METHOD` | `session-based-challenge` | Verification method in VWC |
| `WITNESS_VERBOSE` | `false` | Enable verbose logging |
| `WITNESS_INVITATION_FILE` | `.oob-invitation.json` | File to persist invitation URL for stability |
| `MEDIATOR_INVITATION_URL` | _(optional)_ | Mediator OOB invitation URL (enables mediation) |

#### Stable Invitation URLs (QR Codes)

By default, the witness server persists its connection invitation to disk (`.oob-invitation.json`). This means:

- **First startup**: Creates a new invitation and saves it to the file
- **Subsequent restarts**: Loads the existing invitation from the file
- **QR codes remain valid** across server restarts

**Synchronized Persistence:** The invitation file (`.oob-invitation.json`) and seed file (`.witness-seed.json`) are synchronized - they share a `configHash` and are managed together. The server automatically detects and fixes out-of-sync states (e.g., if the wallet is wiped but persisted files remain).

To reset the invitation and seed (generate a fresh QR code):

```bash
# Delete wallet, invitation, and seed files, then start fresh
yarn fresh
yarn start

# Or use the combined command
yarn start:fresh
```

To disable persistence (always create fresh invitation):

```bash
WITNESS_INVITATION_FILE="" yarn start
```

#### Mediator Configuration ⚠️ REQUIRED FOR MOBILE

The witness server can operate behind a DIDComm mediator, eliminating the need for a publicly accessible port or HTTPS configuration. **This is required for mobile app compatibility** due to platform security restrictions against cleartext HTTP.

| Variable | Description |
|----------|-------------|
| `MEDIATOR_INVITATION_URL` | Mediator out-of-band invitation URL. If set, enables mediation. |

**How it works:**

- When `MEDIATOR_INVITATION_URL` is set, the server connects to the mediator via **WebSocket (HTTPS)**
- Messages are delivered through the mediator using the implicit pickup strategy
- The server no longer requires inbound HTTP connectivity on `WITNESS_PORT`
- `WITNESS_PUBLIC_URL` is ignored when using a mediator (endpoints come from the mediator)
- **Mobile wallets can connect** without HTTP permissions since they use HTTPS to the mediator

**Why this matters for mobile apps:**

Mobile platforms prevent apps from making cleartext HTTP connections for security. Without a mediator:
- iOS apps require `NSAppTransportSecurity` exceptions (rejected by App Store review)
- Android apps require `android:usesCleartextTraffic="true"` (security anti-pattern)
- Both platforms flag these as dangerous permissions

With a mediator, all communication uses HTTPS (WebSocket for witness, HTTPS for mobile apps), satisfying platform security requirements.

**Example: Using a mediator**

```bash
# Connect through a mediator service
MEDIATOR_INVITATION_URL="https://mediator.example.com/invite?oob=eyJ..." yarn start
```

**Startup output with mediator:**

```
╔══════════════════════════════════════════════════════════════════╗
║                    WITNESS SERVER CONFIGURATION                   ║
╠══════════════════════════════════════════════════════════════════╣
║  Name:              witness-server                                ║
║  DIDComm Port:      (via mediator)                                ║
║  Web Port:          9003                                          ║
║  Public URL:        (via mediator)                                ║
╠══════════════════════════════════════════════════════════════════╣
║  Transport:         MEDIATOR (WebSocket)                          ║
║  Mediator:          mediator.example.com                          ║
╠══════════════════════════════════════════════════════════════════╣
...
```

**Note:** The web interface (QR code, activity log, API) still requires `WITNESS_WEB_PORT` to be accessible.

#### Locality Verification (BLE — coming soon)

The witness server supports opt-in co-locality verification to prove participants are physically present at the same location as the witness. This provides evidence that the witnessed exchange occurred in physical proximity (e.g., at an event venue).

**Architecture:**

Proximity is verified via a pluggable `LocalityProvider` interface. A `NullLocalityProvider` (no-op) is used by default. The Bluetooth BLE transport will implement this interface once it is ready.

**How it will work (with BLE):**

1. **Challenge rotation**: Server generates and rotates a random 32-byte challenge
2. **BLE advertising**: The BLE transport advertises the challenge over Bluetooth Low Energy
3. **Proximity proof**: A participant's device receives the challenge over BLE (proving physical proximity) and signs it with their DID key
4. **Proof recording**: The signed challenge is passed back via the BLE transport callback
5. **Evidence in VWC**: Locality proofs (`did` + `sig`) are included in issued credentials

| Variable | Default | Description |
|----------|---------|-------------|
| `WITNESS_LOCALITY_ENABLED` | `true` | Set to `false` to disable |
| `WITNESS_LOCALITY_PROOF_LIFETIME_MINUTES` | `30` | How long locality proofs remain valid |
| `WITNESS_LOCALITY_CHALLENGE_ROTATION_MINUTES` | `5` | How often the challenge rotates |

**Enable locality verification:**

```bash
WITNESS_LOCALITY_ENABLED=true yarn start
```

**Startup output with locality enabled:**

```
[LocalityService] Starting co-locality verification service...
[LocalityService]   Provider:          null
[LocalityService]   Challenge:         abc123def456...
[LocalityService]   Challenge rotation: every 5 minutes
[LocalityService]   Proof lifetime:     30 minutes
```

**Security Properties:**

- Rotating challenges prevent replay attacks across sessions
- Participant signatures enable third-party verification of the evidence
- Proximity is enforced by the transport layer (BLE range), not by the server

**Locality Evidence in VWC:**

When locality verification is enabled and proofs are present, VWCs include evidence in the `witnessContext`:

```json
{
  "credentialSubject": {
    "witnessContext": {
      "sessionId": "abc123",
      "method": "session-based-challenge",
      "localityVerification": {
        "challenge": "def456...",
        "proofs": [
          { "did": "did:key:alice...", "sig": "base64sig..." },
          { "did": "did:key:bob...", "sig": "base64sig..." }
        ]
      }
    }
  }
}
```

**Third-party verification:**

A verifier can check locality evidence by:

1. Verifying each participant's signature over the challenge
2. Trusting the witness's attestation that BLE proximity verification occurred

**Implementing a custom LocalityProvider:**

```typescript
import { LocalityProvider, ProofCallback } from './src/LocalityProvider'

class BluetoothLocalityProvider implements LocalityProvider {
  readonly name = 'bluetooth-ble'
  private callback?: ProofCallback

  async start(): Promise<void> { /* start BLE advertising */ }
  async stop(): Promise<void>  { /* stop BLE */ }
  setChallenge(challenge: string): void { /* update BLE advertisement */ }
  onProofReceived(cb: ProofCallback): void { this.callback = cb }
}

const service = new LocalityService(config, new BluetoothLocalityProvider())
```

#### DID Configuration

| Variable | Description |
|----------|-------------|
| `WITNESS_ISSUER_DID` | Pre-configured DID (did:key, did:web, did:peer) |
| `WITNESS_ISSUER_SEED` | 32-byte seed in hex (64 chars) for key derivation |
| `WITNESS_ISSUER_KEY_FILE` | Path to JSON key file (alternative to seed) |

**DID Resolution Priority:**

1. `ISSUER_DID` + key material → Import existing DID
2. `ISSUER_SEED` only → Create stable `did:peer` from seed
3. Nothing → Auto-generate random `did:peer`

**Example: Stable DID across restarts**

```bash
# Generate a seed: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
WITNESS_ISSUER_SEED=a1b2c3d4e5f6...  # Your 64-char hex seed
```

### Connect to the Witness

1. Open `http://localhost:9003` in a browser to see the QR code
2. Scan with a DIDComm-compatible wallet to establish a connection
3. Or copy the invitation URL from the console output

## Web Interface

The witness server provides a web interface at the configured web port:

### Home Page (`/`)

- QR code for mobile wallet scanning
- Witness issuer DID prominently displayed
- Connection invitation URL
- Server statistics (credentials issued, sessions completed)

### Activity Log (`/log`)

- Real-time display of issued credentials
- Auto-refreshes every 15 seconds
- Shows:
  - Active sessions in progress
  - Recently issued VWCs
  - Session IDs, timestamps, and participant DIDs
  - VRC digests for cross-reference
- Statistics: total credentials, sessions, unique issuers

## HTTP API

The server exposes REST API endpoints for programmatic access:

### GET `/api/issuer`

Returns information about the witness server's issuer identity.

**Response:**

```json
{
  "issuerDid": "did:peer:2.Ez6L...",
  "name": "witness-server",
  "keyType": "Ed25519",
  "verificationMethod": "session-based-challenge",
  "eventName": "EthDenver 2024",
  "stats": {
    "totalCredentials": 47,
    "totalSessions": 24,
    "uniqueVrcIssuers": 38
  }
}
```

### POST `/api/verify`

Verify a Witness Credential was issued by this server.

**Request Options:**

Option 1: Full credential verification

```json
{
  "credential": {
    "@context": ["https://www.w3.org/2018/credentials/v1", "..."],
    "type": ["VerifiableCredential", "WitnessCredential"],
    "issuer": "did:peer:2.Ez6L...",
    ...
  }
}
```

Option 2: Lookup by credential ID

```json
{
  "credentialId": "urn:uuid:abc-123..."
}
```

Option 3: Lookup by VRC digest

```json
{
  "digest": "sha256:abc123..."
}
```

**Response:**

```json
{
  "verified": true,
  "issuerMatch": true,
  "inRegistry": true,
  "issuedAt": "2024-01-15T10:30:00Z",
  "sessionId": "abc-123"
}
```

### GET `/api/issued`

List issued credentials with pagination.

**Query Parameters:**

- `page` - Page number (default: 1)
- `pageSize` - Items per page (default: 20)

**Response:**

```json
{
  "records": [
    {
      "vwcId": "urn:uuid:abc-123...",
      "sessionId": "session-456",
      "vrcDigest": "sha256:...",
      "vrcIssuerId": "did:peer:2.Ex...",
      "recipientDid": "did:peer:2.Ey...",
      "issuedAt": "2024-01-15T10:30:00Z",
      "eventName": "EthDenver 2024"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 47,
    "totalPages": 3
  }
}
```

## DIDComm Protocol

### Message Types

The server handles the following DIDComm basic message types:

#### `session-request`

Request a witnessed exchange session. Sent by a participant who wants to initiate a witnessed exchange.

```json
{
  "type": "session-request",
  "counterpartyConnectionId": "<witness's connection ID to the other participant>"
}
```

#### `session-challenge` (outgoing)

Sent by the Witness to both participants after receiving a session request.

```json
{
  "type": "session-challenge",
  "sessionId": "<unique session ID>",
  "challenge": "<cryptographic nonce>",
  "domain": "<witness domain identifier>"
}
```

#### `submit-presentation`

Submit a Verifiable Presentation containing the participant's VRC, signed with the session challenge.

```json
{
  "type": "submit-presentation",
  "presentation": {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    "type": ["VerifiablePresentation"],
    "holder": "<participant's R-DID>",
    "verifiableCredential": [
      {
        /* VRC targeting the counterparty */
      }
    ],
    "proof": {
      "challenge": "<session challenge>",
      "domain": "<session domain>",
      /* ... signature */
    }
  }
}
```

#### `verify-credential`

Request verification that a VWC was issued by this witness server.

```json
{
  "type": "verify-credential",
  "credential": { /* full VWC JSON */ }
}
```

Or for simpler lookups:

```json
{
  "type": "verify-credential",
  "credentialId": "urn:uuid:...",
  "digest": "sha256:..."
}
```

#### `verify-credential-response` (outgoing)

Response to a verification request.

```json
{
  "type": "verify-credential-response",
  "verified": true,
  "issuerMatch": true,
  "inRegistry": true,
  "issuedAt": "2024-01-15T10:30:00Z",
  "sessionId": "abc-123"
}
```

### Flow Sequence

```
┌─────────┐          ┌─────────┐          ┌─────────┐
│  Alice  │          │ Witness │          │   Bob   │
└────┬────┘          └────┬────┘          └────┬────┘
     │                    │                    │
     │ ──connect──────────>│                    │
     │                    │<──connect───────── │
     │                    │                    │
     │ session-request ───>│                    │
     │                    │                    │
     │<── session-challenge│── session-challenge>
     │                    │                    │
     │ submit-presentation>│                    │
     │                    │<─ submit-presentation
     │                    │                    │
     │                    │──── verify ────────│
     │                    │                    │
     │<── VWC (about Bob) │── VWC (about Alice)>
     │                    │                    │
```

### Verification Flow

```
┌─────────┐          ┌─────────┐
│ Verifier│          │ Witness │
└────┬────┘          └────┬────┘
     │                    │
     │ verify-credential ─>│  (with VWC)
     │                    │
     │<─ verify-credential-response
     │   (verified: true) │
     │                    │
```

## Witness Credential (VWC) Structure

The Witness issues credentials that attest to having observed the VRC exchange:

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://trustoverip.org/credentials/witnessed-exchange/v1"
  ],
  "type": ["VerifiableCredential", "DTGCredential", "WitnessCredential"],
  "issuer": "<witness DID>",
  "issuanceDate": "2024-01-15T10:30:00Z",
  "credentialSubject": {
    "id": "<VRC issuer's DID>",
    "digest": "sha256:<hash of witnessed VRC>",
    "witnessContext": {
      "sessionId": "<session ID>",
      "method": "session-based-challenge",
      "event": "EthDenver 2024"
    }
  }
}
```

**Note:** `event` is only included if `WITNESS_EVENT_NAME` is configured.

## Verification Checks

The Witness performs three verification checks on each submitted presentation:

1. **Context Check**: VP signature matches the session challenge and domain
2. **Identity Check**: Inner VRC signature is cryptographically valid
3. **Freshness Check**: VRC issuance timestamp is within 5 minutes of current time

## Credential Registry

The server maintains an in-memory registry of all issued VWCs:

- **Indexed by**: VWC ID, VRC digest, and session ID
- **Capacity**: Last 1000 credentials (configurable)
- **Queryable via**: DIDComm `verify-credential` or HTTP `/api/verify`
- **Viewable at**: Activity log page (`/log`)

**Storage Options:**

The registry supports two storage backends:

### In-Memory (Default)

- Fast, no external dependencies
- Data is lost on server restart
- **Default limit: 1000 records** (LRU eviction)
- Suitable for development and demos

### Redis (Persistent)

- Survives server restarts
- Shared across multiple server instances
- **Unlimited storage by default** (relies on TTL for cleanup)
- Optional record limit via `maxRecords` config
- Requires Redis server

To use Redis storage, install ioredis and configure:

```bash
yarn add ioredis

# Environment variables
WITNESS_REGISTRY_STORAGE=redis
WITNESS_REDIS_URL=redis://localhost:6379
WITNESS_REDIS_PREFIX=witness:    # Optional, default: witness:
WITNESS_REDIS_TTL=86400          # Optional, TTL in seconds (0 = no expiry)
WITNESS_MAX_RECORDS=             # Optional, unlimited by default for Redis
```

**Storage Limit Differences:**

| Storage | Default Limit | Reason |
|---------|---------------|--------|
| In-Memory | 1000 records | Memory protection |
| Redis | Unlimited | Redis handles large datasets; use TTL for cleanup |

**Note:** When using in-memory storage, the registry will be cleared on server restart.

## Development

### Build

```bash
yarn build
```

### Run Tests

```bash
yarn test
```

### Project Structure

```
witness-server/
├── src/
│   ├── index.ts             # Entry point
│   ├── config.ts            # Configuration loader
│   ├── WitnessService.ts    # Core witness logic & DIDComm handlers
│   ├── CredentialRegistry.ts # In-memory credential registry
│   ├── WebServer.ts         # HTTP server (web UI & API)
│   └── InvitationPage.ts    # [deprecated] Original QR page
├── __tests__/unit/          # Unit tests
├── .env.sample              # Example configuration
├── package.json
└── tsconfig.json
```

## Related Documentation

- [WITNESSED_FLOW.md](../WITNESSED_FLOW.md) - Protocol specification
- [Witness.ts](../src/Witness.ts) - Original reference implementation
- [witnessedFlow.test.ts](../__tests__/integration/witnessedFlow.test.ts) - Integration tests

## License

Apache-2.0
