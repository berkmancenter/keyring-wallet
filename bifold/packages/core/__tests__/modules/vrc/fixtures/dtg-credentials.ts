/**
 * Re-export shared test fixtures for backwards compatibility
 * All test fixture utilities have been moved to src/fixtures/testContacts.ts
 * to allow sharing between tests and runtime code.
 */
export {
  type CreateDTGCredentialParams,
  generateTestDid,
  TEST_CONTACTS,
  createDTGCredential,
  createMultipleDTGCredentials,
  createTestCredentialsForHolder,
  createCredentialsFromSameIssuer,
} from '../../../../src/modules/vrc/fixtures/testContacts'
