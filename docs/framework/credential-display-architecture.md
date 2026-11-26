# Credential Display Architecture

## Overview

This document explains how credentials are displayed in chat messages and how the system handles different credential formats (AnonCreds vs W3C/JSON-LD) to ensure proper navigation and avoid duplicate messages.

## Background: DIDComm Credential Exchange

When credentials are exchanged via DIDComm protocols, the Credo-ts framework creates two types of records:

1. **CredentialExchangeRecord** - Tracks the DIDComm protocol state machine

   - States: `offer-sent` → `offer-received` → `request-sent` → `credential-issued` → `done`
   - Exists for ALL credential formats (AnonCreds, JSON-LD, etc.)
   - Acts as the protocol tracker, not the credential itself

2. **Format-Specific Credential Record** - Stores the actual credential
   - **AnonCreds**: Stored in AnonCreds-specific storage
   - **W3C/JSON-LD**: Stored as `W3cCredentialRecord`

## The Problem: Duplicate Messages

Before the fix, W3C/JSON-LD credentials (like VRC relationship credentials) appeared **twice** in chat:

- Once from the `CredentialExchangeRecord` (protocol tracker)
- Once from the `W3cCredentialRecord` (actual credential)

Both had the same shield icon and "Full contact details" button, but clicking on the `CredentialExchangeRecord` navigated to the generic credential view instead of the custom display handler.

## The Solution: Unified Credential Display

### Implementation Location

`bifold/packages/core/src/hooks/chat-messages.tsx` - `useChatMessagesByConnection()` hook

### How It Works

1. **Single Source of Truth**: All credential messages come from `CredentialExchangeRecord` objects

   ```typescript
   const actionableCredentials = credentials.filter(
     (record: CredentialExchangeRecord) =>
       (record.state === CredentialState.Done || record.state === CredentialState.OfferReceived) &&
       record.role === CredentialRole.Holder
   )
   ```

2. **Format Detection**: Check if credential is W3C/JSON-LD

   ```typescript
   const isJsonLdCredential = record.credentials.some((cred) => cred.credentialRecordType === 'w3c')
   ```

3. **Smart Navigation**: Route based on format

   ```typescript
   if (isJsonLdCredential) {
     // Navigate to OpenIDCredentialDetails (supports custom display handlers)
     const w3cCredRecord = record.credentials.find((cred) => cred.credentialRecordType === 'w3c')
     navigation.navigate(Screens.OpenIDCredentialDetails, {
       credentialId: w3cCredRecord.credentialRecordId,
       type: OpenIDCredentialType.W3cCredential,
     })
   } else {
     // Navigate to CredentialDetails (standard AnonCreds view)
     navigation.navigate(Screens.CredentialDetails, {
       credentialId: record.id,
     })
   }
   ```

## Credential Types Supported

### AnonCreds Credentials

- Traditional Hyperledger Indy/AnonCreds format
- Navigate to: `Screens.CredentialDetails`
- Display: Standard credential attributes view

### W3C/JSON-LD Credentials

- VRC Relationship Credentials
- DTG (Decentralized Trust Graph) Credentials
- Other JSON-LD based credentials
- Navigate to: `Screens.OpenIDCredentialDetails`
- Display: Custom handlers via `displayRegistry`
  - Example: `RelationshipCredentialHandler` for VRC credentials

## Custom Display Handlers

W3C credentials can have custom display logic registered in the display registry:

```typescript
// Register custom handler
displayRegistry.register({
  credentialType: 'RelationshipCredential',
  handler: new RelationshipCredentialHandler(),
  terminology: relationshipTerminology,
})
```

The handler determines:

- Custom field labels and formatting
- Which fields to display
- Field ordering and grouping
- Specialized terminology

## Terminology System

### Overview

The terminology system allows different credential types to customize all user-facing text throughout the application. This provides a consistent user experience where RelationshipCredentials use "Contact" language while traditional credentials use "Credential" language.

### CredentialTerminology Interface

Located in `bifold/packages/core/src/modules/vrc/display/types.ts`, the `CredentialTerminology` interface defines all customizable text:

```typescript
export interface CredentialTerminology {
  // Nouns
  singular: string // "contact", "credential"
  plural: string // "contacts", "credentials"

  // Screen titles
  offerScreenTitle: string // "Contact Request", "Credential Offer"
  detailScreenTitle: string // "Contact Details", "Credential Details"

  // Offer flow
  isOfferingYou: string
  declineTitle: string
  confirmDecline: string
  addedToWallet: string
  onTheWay: string

  // Detail/remove flow
  issuedByLabel: string
  removeTitle: string
  removeButtonLabel: string
  removeCaption: string
  removedConfirmation: string

  // Empty state
  emptyListMessage: string
  addItemButton: string

  // Tour steps
  tourAddTitle: string
  tourAddDescription: string

  // Chat message text
  chatOfferTitle: string // "Contact offer received"
  chatReceivedTitle: string // "Contact received"
}
```

### Built-in Terminology

Two terminology sets are provided in `bifold/packages/core/src/modules/vrc/display/terminology/defaults.ts`:

1. **defaultCredentialTerminology** - Standard "credential" language

   - Used for AnonCreds and unknown W3C credential types
   - Example: `chatOfferTitle: 'Chat.CredentialOfferTitle'`

2. **contactTerminology** - "Contact" language for RelationshipCredentials
   - Used for VRC/DTG relationship credentials
   - Example: `chatOfferTitle: 'Chat.ContactOfferTitle'`

### How Terminology is Used

#### 1. Registration

Handlers register their terminology when added to the display registry:

```typescript
const handler = new RelationshipCredentialHandler()
handler.getTerminology = () => contactTerminology

displayRegistry.register(handler)
```

#### 2. Retrieval

Components query the registry to get appropriate terminology:

```typescript
const terminology = credentialDisplayRegistry.getTerminology(w3cCredential)
const title = t(terminology.chatOfferTitle) // Translates to "Contact offer received"
```

#### 3. Fallback

If no handler matches, `defaultCredentialTerminology` is returned automatically.

### Chat Message Example

In `useChatMessagesByConnection` hook:

```typescript
// Get terminology for this credential type
const terminology = credentialDisplayRegistry.getTerminology(w3cCred.credential)

// Use credential-specific terminology
if (record.state === CredentialState.OfferReceived) {
  title = t(terminology.chatOfferTitle) // "Contact offer received" OR "Credential offer received"
}
```

### Adding New Terminology

To add a new credential type with custom terminology:

1. Create terminology definition:

```typescript
export const myCredentialTerminology: CredentialTerminology = {
  singular: 'MyCredential.Singular',
  plural: 'MyCredential.Plural',
  // ... all required fields
  chatOfferTitle: 'Chat.MyCredentialOfferTitle',
  chatReceivedTitle: 'Chat.MyCredentialReceivedTitle',
}
```

1. Add translations to localization files:

```json
{
  "Chat": {
    "MyCredentialOfferTitle": "My credential offer received",
    "MyCredentialReceivedTitle": "My credential received"
  }
}
```

1. Register with handler:

```typescript
handler.getTerminology = () => myCredentialTerminology
displayRegistry.register(handler)
```

That's it! The terminology will be used automatically throughout the app.

## Testing Strategy

### Unit Tests

Location: `bifold/packages/core/__tests__/hooks/chat-messages.test.tsx`

Tests should verify:

1. W3C credentials are detected correctly (`credentialRecordType === 'w3c'`)
2. Navigation routes to `OpenIDCredentialDetails` for W3C credentials
3. Navigation routes to `CredentialDetails` for AnonCreds credentials
4. No duplicate messages appear for the same credential
5. Custom display handlers are invoked for W3C credentials

### Manual Testing

1. Establish VRC relationship credential exchange
2. Verify single credential message appears in chat
3. Click "Full contact details"
4. Verify custom RelationshipCredentialHandler display appears
5. Verify DTG-specific terminology and fields are shown

## Key Files

- **Chat Messages Hook**: `bifold/packages/core/src/hooks/chat-messages.tsx`
- **Chat Message Component**: `bifold/packages/core/src/components/chat/ChatMessage.tsx`
- **OpenID Credential Details Screen**: `bifold/packages/core/src/modules/openid/screens/OpenIDCredentialDetails.tsx`
- **Display Registry**: `bifold/packages/core/src/modules/vrc/display/displayRegistry.ts`
- **Relationship Credential Handler**: `bifold/packages/core/src/modules/vrc/display/handlers/RelationshipCredentialHandler.ts`

## Common Pitfalls

1. **Don't query W3cCredentialRecord separately** - This creates duplicate messages
2. **Always check `credentialRecordType`** - This is how to distinguish credential formats
3. **Use the W3C credential's record ID** - Not the CredentialExchangeRecord ID when navigating
4. **Register display handlers** - W3C credentials without handlers show generic display

## Future Enhancements

- Support for additional W3C credential types (LD-Proofs, JWT-VCs)
- Credential status checking (revocation, suspension)
- Batch credential offers in chat
- Credential preview before acceptance
