# DTG Credential Test Fixtures

This directory re-exports shared test utilities from `../../src/fixtures/testContacts.ts`.

**Note:** The actual test fixture implementations have been moved to `src/fixtures/testContacts.ts` to allow sharing between automated tests and runtime QA testing tools (like the "Seed Test Contacts" feature in the Developer screen).

All test utilities for creating DTG (Digital Trust Graph) credentials, specifically RelationshipCredentials used in the VRC (Verifiable Relationship Credential) system, are now located in the shared fixtures module.

## Overview

DTG credentials represent relationships between people. They are W3C Verifiable Credentials with the following structure:

```typescript
{
  '@context': ['https://www.w3.org/ns/credentials/v2', DTG_CONTEXT_URL, RELATIONSHIP_CONTEXT_URL],
  type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
  issuer: {
    id: 'did:peer:...',  // Person's DID
    name: 'Alice Smith'   // Person's name
  },
  validFrom: '2024-03-14T18:04:55.540134Z',
  credentialSubject: {
    id: 'did:peer:...'  // Counterparty's relationship DID
  }
}
```

## Usage

### Creating a Single Credential

```typescript
// In tests, you can import from the test fixtures (which re-export from shared)
import { createDTGCredential, generateTestDid } from '../fixtures/dtg-credentials'

// Or import directly from the shared fixtures
import { createDTGCredential, generateTestDid } from '../../src/fixtures/testContacts'

const credential = createDTGCredential({
  issuer: {
    id: generateTestDid('alice'),
    name: 'Alice Smith'
  },
  credentialSubject: {
    id: generateTestDid('holder')
  },
  validFrom: '2024-01-15T10:00:00Z'
})
```

### Using Preset Contacts

For convenience, common test contacts are predefined:

```typescript
import { TEST_CONTACTS, createDTGCredential, generateTestDid } from '../fixtures/dtg-credentials'

const credential = createDTGCredential({
  issuer: TEST_CONTACTS.alice.issuer,
  credentialSubject: { id: generateTestDid('holder') }
})
```

Available preset contacts:
- `TEST_CONTACTS.alice` - Alice Smith
- `TEST_CONTACTS.bob` - Bob Jones
- `TEST_CONTACTS.charlie` - Charlie Wilson
- `TEST_CONTACTS.diana` - Diana Martinez
- `TEST_CONTACTS.faber` - Faber College
- `TEST_CONTACTS.bestbc` - BestBC Tea

### Creating Multiple Credentials

```typescript
import { createTestCredentialsForHolder, TEST_CONTACTS, generateTestDid } from '../fixtures/dtg-credentials'

const holderDid = generateTestDid('holder')
const credentials = createTestCredentialsForHolder(holderDid, [
  { issuer: TEST_CONTACTS.alice.issuer },
  { issuer: TEST_CONTACTS.bob.issuer },
  { issuer: TEST_CONTACTS.charlie.issuer }
])
```

### Testing Credential Grouping

To test scenarios where the same issuer has issued multiple credentials at different times:

```typescript
import { createCredentialsFromSameIssuer, TEST_CONTACTS, generateTestDid } from '../fixtures/dtg-credentials'

const credentials = createCredentialsFromSameIssuer(
  TEST_CONTACTS.alice.issuer,
  generateTestDid('holder'),
  3,  // Create 3 credentials
  new Date('2024-01-01')  // Starting date (optional)
)
// Creates credentials one week apart
```

### Custom Batch Creation

```typescript
import { createMultipleDTGCredentials, generateTestDid } from '../fixtures/dtg-credentials'

const holderDid = generateTestDid('holder')
const credentials = createMultipleDTGCredentials([
  {
    issuer: { id: generateTestDid('alice'), name: 'Alice Smith' },
    credentialSubject: { id: holderDid },
    validFrom: '2024-01-15T10:00:00Z'
  },
  {
    issuer: { id: generateTestDid('bob'), name: 'Bob Jones' },
    credentialSubject: { id: holderDid },
    validFrom: '2024-02-20T15:30:00Z'
  }
])
```

## Test Patterns

### Testing ListContacts

```typescript
import { createTestCredentialsForHolder, TEST_CONTACTS, generateTestDid } from '../fixtures/dtg-credentials'
import { OpenIDCredentialRecordProvider } from '../../src/modules/openid/context/OpenIDCredentialRecordProvider'

const MockOpenIDProviderWithCredentials: React.FC<{
  children: React.ReactNode
  credentials: any[]
}> = ({ children, credentials }) => {
  const mockContext = {
    openIdState: {
      w3cCredentialRecords: credentials,
      sdJwtVcRecords: [],
      mdocVcRecords: [],
      openIDCredentialRecords: [],
      isLoading: false,
    },
    // ... other mock methods
  }

  const OpenIDContext = React.createContext(mockContext)
  return <OpenIDContext.Provider value={mockContext}>{children}</OpenIDContext.Provider>
}

test('Displays contacts', async () => {
  const credentials = createTestCredentialsForHolder(
    generateTestDid('holder'),
    [
      { issuer: TEST_CONTACTS.alice.issuer },
      { issuer: TEST_CONTACTS.bob.issuer }
    ]
  )

  const { findByText } = render(
    <BasicAppContext>
      <MockOpenIDProviderWithCredentials credentials={credentials}>
        <ListContacts />
      </MockOpenIDProviderWithCredentials>
    </BasicAppContext>
  )

  expect(await findByText('Alice Smith')).toBeTruthy()
  expect(await findByText('Bob Jones')).toBeTruthy()
})
```

### Testing ContactDetails

```typescript
import { TEST_CONTACTS, generateTestDid } from '../fixtures/dtg-credentials'
import { ContactCredentialDetails } from '../../src/types/navigators'

test('Shows contact details', async () => {
  const contact: ContactCredentialDetails = {
    issuer: TEST_CONTACTS.alice.issuer
  }

  const { findByText } = render(
    <ContactDetails
      route={{ params: { contact } }}
      navigation={mockNavigation}
    />
  )

  expect(await findByText('Alice Smith')).toBeTruthy()
  expect(await findByText(TEST_CONTACTS.alice.issuer.id)).toBeTruthy()
})
```

## API Reference

### `createDTGCredential(params: CreateDTGCredentialParams): W3cCredentialRecord`

Creates a single DTG credential.

**Parameters:**
- `issuer.id` (required) - The issuer's DID
- `issuer.name` (required) - The issuer's name
- `credentialSubject.id` (required) - The credential subject's DID
- `validFrom` (optional) - ISO 8601 date string, defaults to current date
- `id` (optional) - Credential ID, auto-generated if not provided
- `createdAt` (optional) - ISO 8601 date string
- `updatedAt` (optional) - ISO 8601 date string

### `generateTestDid(name: string): string`

Generates a deterministic `did:peer:2` format DID based on the input name.

**Example:**
```typescript
generateTestDid('alice') // Returns: did:peer:2.Ez6LSms...ali
```

### `createMultipleDTGCredentials(credentialParams: CreateDTGCredentialParams[]): W3cCredentialRecord[]`

Creates multiple credentials in a single call.

### `createTestCredentialsForHolder(holderDid: string, issuers: Array<{...}>): W3cCredentialRecord[]`

Creates credentials with a shared credential subject (holder).

### `createCredentialsFromSameIssuer(issuer: {...}, holderDid: string, count: number, startDate?: Date): W3cCredentialRecord[]`

Creates multiple credentials from the same issuer at different times (one week apart).

## Shared Fixtures Location

The test fixtures are now located in `src/fixtures/testContacts.ts` and are shared between:
- **Automated tests** (via re-export from `__tests__/fixtures/dtg-credentials.ts`)
- **Runtime QA tools** (Developer screen's "Seed Test Contacts" feature)
- **Any other code** that needs to generate test credentials

This ensures that test data is consistent across the entire application.

## Notes

- All credentials are created as `W3cCredentialRecord` instances using `JsonTransformer.fromJSON()`
- DIDs are generated deterministically for consistent test results
- Credentials include proper W3C contexts, types, and tags
- Mock proofs are included for completeness but are not validated in tests
- The shared fixtures can be imported from either location (test fixtures or src/fixtures)
