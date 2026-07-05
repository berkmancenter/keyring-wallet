
## Alignment Analysis: vrc-reference Tests vs. core/src/modules/vrc Implementation

After a thorough reading of the test files in `bifold/packages/vrc-reference` and the app implementation in `bifold/packages/core/src/modules/vrc`, here is my assessment:

---

### ✅ **Strongly Aligned Areas**

#### 1. **Credential Structure (VRC)**
Both use the same credential shape:
- **Types**: `["VerifiableCredential", "DTGCredential", "RelationshipCredential"]`
- **Contexts**: Both import from the shared `@bifold/vrc-contexts` package (`RELATIONSHIP_CONTEXT_URL`, `DTG_CONTEXT_URL`)
- **Issuer**: R-DID (did:peer) of the issuer
- **Subject**: `credentialSubject.id` = R-DID of the counterparty
- **Proof**: `Ed25519Signature2018` / `assertionMethod`
- **issuanceDate**: ISO timestamp

#### 2. **Credential Issuance Flow**
Both follow the same Credo v2 protocol:
- `agent.credentials.offerCredential()` with `protocolVersion: 'v2'`, `jsonld` format
- Issuer auto-accepts credential request in both (`CredentialState.RequestReceived` → `acceptRequest`)
- Reference: `Participant.issueCredential()` / App: `issueVrcCredential()`

#### 3. **R-DID Exchange**
Both create per-relationship `did:peer:0` (InceptionKeyWithoutDoc) with `KeyType.Ed25519`:
- Reference: `Participant.createDIDForConnection()` → shares via `basicMessages.sendMessage(connectionId, JSON.stringify({ rDid }))`
- App: `getOrCreateRelationshipDid()` → shares via `basicMessages.sendMessage(connectionId, 'vrc:relationshipDid:...')`

#### 4. **Witnessed Flow – Session Creation (Phase 1)**
Both use the same message protocol:
- **Session request**: `{ type: 'session-request', ... }` sent via basic message
- **Session challenge**: `{ type: 'session-challenge', sessionId, challenge, domain }` sent to both participants
- Witness generates UUID-based `sessionId` and `challenge`

#### 5. **Witnessed Flow – VP Creation & Submission (Phase 2)**
Both follow the identical 5-step process:
1. Build unsigned VRC (issuer=self, subject=counterparty)
2. Sign VRC with `Ed25519Signature2018` via `agent.w3cCredentials.signCredential()`
3. Wrap signed VRC in VP with `holder` = self DID
4. Sign VP with session `challenge` and `domain`, using `proofPurpose: 'authentication'`
5. Submit via `{ type: 'submit-presentation', presentation: vpJson }` basic message

Reference: `Participant.createAndSubmitPresentation()` / App: `WitnessedVRCManager.createAndSubmitVP()`

#### 6. **Witnessed Flow – Verification (Phase 3)**
The Witness in the reference implementation performs three checks, and the app expects the same:
1. **Context Check**: VP proof `challenge` and `domain` match session
2. **Identity Check**: Inner VRC signature cryptographically verified
3. **Freshness Check**: VRC `issuanceDate` within 5-minute tolerance

#### 7. **Witness Credential (VWC) Structure**
Both follow the same spec:
- **Types**: `["VerifiableCredential", "DTGCredential", "WitnessCredential"]`
- **Contexts**: Shared `WITNESSED_EXCHANGE_CONTEXT_URL` from `@bifold/vrc-contexts`
- **Issuer**: Witness DID
- **Subject**: `credentialSubject.id` = VRC issuer's R-DID
- **Subject fields**: `digest` (SHA-256 hash of VRC), `witnessContext` (sessionId, method, event)
- **Cross-distribution**: VWC about Alice's VRC → Bob, and vice versa

#### 8. **Proof Exchange**
Both use DIF Presentation Exchange format (`protocolVersion: 'v2'`):
- Input descriptors filter on `$.type[*]` for `RelationshipCredential`
- `selectCredentialsForRequest` → `acceptRequest` flow

#### 9. **Shared Schema Package**
Both `relationshipContext.ts` and `witnessedExchangeContext.ts` in **both** packages re-export from the same `@bifold/vrc-contexts` package, ensuring identical JSON-LD context documents.

---

### ⚠️ **Minor Differences (Expected – Not Misalignments)**

| Aspect | Reference (vrc-reference) | App (core/src/modules/vrc) |
|---|---|---|
| **R-DID sharing format** | `JSON.stringify({ rDid })` | `'vrc:relationshipDid:...'` (human-readable prefix) |
| **VRC issuer field** | Simple string DID (`issuerDid`) | Object `{ id, name, email?, organization? }` (includes RCard info) |
| **Biometric/Hardware attestation** | Not present (reference demo) | Full biometric confirmation + W3C evidence block |
| **Auto-accept credentials** | `AutoAcceptCredential.Never` (manual in tests) | VWCs auto-accepted, VRCs manual |
| **Witness discovery** | Manual connection setup | mDNS-based discovery + connection provider |
| **Error handling** | Simple throws | Rich error dialogs with retry/proceed-without-witness UX |
| **Connection invitation** | Generic OOB | Uses `goalCode: 'relationship.credential.bidirectional'` |
| **Session-challenge timeout** | None (tests wait explicitly) | 15s timeout with user dialog |
| **VRC `@context`** | 2 contexts (VC v1 + Relationship) | 3 contexts (VC v1 + DTG + Relationship) |
| **VWC `hardwareAttestationIncluded`** | Not present | Witness checks for evidence and flags it |

---

### 🔑 **One Noteworthy Structural Difference: VRC `@context`**

The reference `Participant.buildRelationshipCredential()` uses:
```json
["https://www.w3.org/2018/credentials/v1", RELATIONSHIP_CONTEXT_URL]
```

The app's `buildVrcCredential()` uses:
```json
["https://www.w3.org/2018/credentials/v1", DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL]
```

The app includes the **DTG context** as an additional entry. This doesn't break compatibility (contexts are additive), but the reference tests' `credentialStructure.test.ts` checks for `RELATIONSHIP_CONTEXT_URL` in the context array — which would still pass in both cases.

---

### 📋 **Summary**

**The flows are well-aligned.** The core credential exchange protocol — from R-DID creation, through VRC issuance, to the full 5-phase witnessed flow and proof exchange — is structurally identical between the reference tests and the app implementation. The differences are all additive production features (biometrics, hardware attestation, error UX, mDNS discovery, richer issuer metadata) that extend but do not contradict the protocol tested in the reference suite.

The reference tests serve as a reliable integration specification for the app's VRC exchange logic.
