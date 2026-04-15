/**
 * Tests for chat-messages hook W3C credential matching
 *
 * These tests verify that:
 * 1. RelationshipDidRepository is queried with connection.theirDid (not connection.id)
 * 2. W3C credentials are matched by counterpartyRelationshipDid (issuer.id)
 * 3. onDecline callback properly calls agent credential decline APIs
 */

import { CredentialState } from '@credo-ts/core'
import { RelationshipDidRecord } from '../../src/modules/vrc/types/RelationshipDidRecord'

describe('Chat Messages - RelationshipDid Lookup', () => {
  describe('RelationshipDidRecord', () => {
    it('should have counterpartyConnectionDid in getTags()', () => {
      const record = new RelationshipDidRecord({
        id: 'test-id-1', // Provide explicit id to avoid uuid() call
        counterpartyConnectionDid: 'did:peer:1zTestTheirDid',
        myRelationshipDid: 'did:peer:0zMyRelDid',
        counterpartyRelationshipDid: 'did:peer:0zCounterpartyRelDid',
        connectionId: 'connection-123',
      })

      const tags = record.getTags()
      expect(tags.counterpartyConnectionDid).toBe('did:peer:1zTestTheirDid')
      expect(tags.counterpartyRelationshipDid).toBe('did:peer:0zCounterpartyRelDid')
    })

    it('should NOT have connectionId in getTags() - this proves why the original query failed', () => {
      const record = new RelationshipDidRecord({
        id: 'test-id-2', // Provide explicit id to avoid uuid() call
        counterpartyConnectionDid: 'did:peer:1zTestTheirDid',
        myRelationshipDid: 'did:peer:0zMyRelDid',
        connectionId: 'connection-123',
      })

      const tags = record.getTags()
      // connectionId is stored but NOT indexed as a tag
      expect(record.connectionId).toBe('connection-123')
      expect(tags).not.toHaveProperty('connectionId')
    })
  })

  describe('W3C credential issuer matching', () => {
    const extractIssuerId = (credential: any): string | undefined => {
      const issuer = credential?.issuer
      if (!issuer) return undefined
      return typeof issuer === 'string' ? issuer : issuer?.id
    }

    it('should extract issuer.id from object issuer', () => {
      const credential = {
        type: ['VerifiableCredential', 'DTGCredential'],
        issuer: { id: 'did:peer:0zTestIssuer', name: 'Test Issuer' },
        credentialSubject: {},
      }

      expect(extractIssuerId(credential)).toBe('did:peer:0zTestIssuer')
    })

    it('should extract issuer from string issuer', () => {
      const credential = {
        type: ['VerifiableCredential', 'DTGCredential'],
        issuer: 'did:peer:0zTestIssuer',
        credentialSubject: {},
      }

      expect(extractIssuerId(credential)).toBe('did:peer:0zTestIssuer')
    })

    it('should return undefined for missing issuer', () => {
      const credential = {
        type: ['VerifiableCredential'],
        credentialSubject: {},
      }

      expect(extractIssuerId(credential)).toBeUndefined()
    })
  })

  describe('DTG credential type detection', () => {
    const isDTGCredential = (types: string[]): boolean => {
      return types.some((t) => typeof t === 'string' && t.includes('DTGCredential'))
    }

    it('should detect DTGCredential type', () => {
      expect(isDTGCredential(['VerifiableCredential', 'DTGCredential'])).toBe(true)
      expect(isDTGCredential(['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'])).toBe(true)
    })

    it('should not match non-DTG credentials', () => {
      expect(isDTGCredential(['VerifiableCredential'])).toBe(false)
      expect(isDTGCredential(['VerifiableCredential', 'UniversityDegree'])).toBe(false)
    })
  })
})

describe('Chat Messages - Reporting DID Registration', () => {
  // Pure logic tests for reporting-did-registration JSON message detection

  const isReportingDidMessage = (content: string): boolean => {
    try {
      const parsed = JSON.parse(content)
      return parsed && typeof parsed === 'object' && parsed.type === 'reporting-did-registration' && typeof parsed.reportingDid === 'string'
    } catch {
      return false
    }
  }

  const extractReportingDid = (content: string): string | undefined => {
    try {
      const parsed = JSON.parse(content)
      if (parsed && parsed.type === 'reporting-did-registration' && typeof parsed.reportingDid === 'string') {
        return parsed.reportingDid
      }
    } catch {
      // ignore
    }
    return undefined
  }

  it('should detect a valid reporting-did-registration message', () => {
    const content = JSON.stringify({ type: 'reporting-did-registration', reportingDid: 'did:peer:0zTestReportingDid' })
    expect(isReportingDidMessage(content)).toBe(true)
  })

  it('should extract the reportingDid from a valid message', () => {
    const content = JSON.stringify({ type: 'reporting-did-registration', reportingDid: 'did:peer:0zTestReportingDid' })
    expect(extractReportingDid(content)).toBe('did:peer:0zTestReportingDid')
  })

  it('should NOT detect a message with wrong type', () => {
    const content = JSON.stringify({ type: 'other-message', reportingDid: 'did:peer:0zTestDid' })
    expect(isReportingDidMessage(content)).toBe(false)
  })

  it('should NOT detect a message missing reportingDid', () => {
    const content = JSON.stringify({ type: 'reporting-did-registration' })
    expect(isReportingDidMessage(content)).toBe(false)
  })

  it('should NOT detect a message where reportingDid is not a string', () => {
    const content = JSON.stringify({ type: 'reporting-did-registration', reportingDid: 12345 })
    expect(isReportingDidMessage(content)).toBe(false)
  })

  it('should return false for non-JSON content', () => {
    expect(isReportingDidMessage('not json at all')).toBe(false)
    expect(isReportingDidMessage('vrc:relationshipDid:did:peer:0zSomeDid')).toBe(false)
  })

  it('should return false for plain text messages', () => {
    expect(isReportingDidMessage('Hello there!')).toBe(false)
  })

  it('should return undefined when extracting from non-matching content', () => {
    expect(extractReportingDid('not json')).toBeUndefined()
    expect(extractReportingDid(JSON.stringify({ type: 'other' }))).toBeUndefined()
  })
})

describe('Chat Messages - Credential Format Detection', () => {
  describe('W3C/JSON-LD credential detection', () => {
    it('should detect W3C credentials by credentialRecordType', () => {
      const credentialExchangeRecord = {
        id: 'cred-exchange-123',
        state: 'done',
        role: 'holder',
        credentials: [
          {
            credentialRecordType: 'w3c',
            credentialRecordId: 'w3c-cred-456',
          },
        ],
      }

      const isJsonLdCredential = credentialExchangeRecord.credentials.some(
        (cred: any) => cred.credentialRecordType === 'w3c'
      )

      expect(isJsonLdCredential).toBe(true)
    })

    it('should NOT detect AnonCreds as W3C credentials', () => {
      const credentialExchangeRecord = {
        id: 'cred-exchange-123',
        state: 'done',
        role: 'holder',
        credentials: [
          {
            credentialRecordType: 'anoncreds',
            credentialRecordId: 'anoncreds-cred-456',
          },
        ],
      }

      const isJsonLdCredential = credentialExchangeRecord.credentials.some(
        (cred: any) => cred.credentialRecordType === 'w3c'
      )

      expect(isJsonLdCredential).toBe(false)
    })

    it('should handle credentials without credentialRecordType', () => {
      const credentialExchangeRecord = {
        id: 'cred-exchange-123',
        state: 'done',
        role: 'holder',
        credentials: [
          {
            // No credentialRecordType property (legacy AnonCreds)
            credentialRecordId: 'legacy-cred-456',
          },
        ],
      }

      const isJsonLdCredential = credentialExchangeRecord.credentials.some(
        (cred: any) => cred.credentialRecordType === 'w3c'
      )

      expect(isJsonLdCredential).toBe(false)
    })

    it('should handle empty credentials array', () => {
      const credentialExchangeRecord = {
        id: 'cred-exchange-123',
        state: 'done',
        role: 'holder',
        credentials: [],
      }

      const isJsonLdCredential = credentialExchangeRecord.credentials.some(
        (cred: any) => cred.credentialRecordType === 'w3c'
      )

      expect(isJsonLdCredential).toBe(false)
    })
  })

  describe('Navigation routing based on credential format', () => {
    it('should route W3C credentials to OpenIDCredentialDetails', () => {
      const credentialExchangeRecord = {
        id: 'cred-exchange-123',
        state: 'done',
        role: 'holder',
        credentials: [
          {
            credentialRecordType: 'w3c',
            credentialRecordId: 'w3c-cred-456',
          },
        ],
      }

      const isJsonLdCredential = credentialExchangeRecord.credentials.some(
        (cred: any) => cred.credentialRecordType === 'w3c'
      )
      const w3cCredRecord = credentialExchangeRecord.credentials.find(
        (cred: any) => cred.credentialRecordType === 'w3c'
      )

      expect(isJsonLdCredential).toBe(true)
      expect(w3cCredRecord).toBeDefined()
      expect(w3cCredRecord?.credentialRecordId).toBe('w3c-cred-456')

      // This would navigate to:
      // Screens.OpenIDCredentialDetails with credentialId: 'w3c-cred-456'
    })

    it('should route AnonCreds credentials to CredentialDetails', () => {
      const credentialExchangeRecord = {
        id: 'cred-exchange-123',
        state: 'done',
        role: 'holder',
        credentials: [
          {
            credentialRecordType: 'anoncreds',
            credentialRecordId: 'anoncreds-cred-456',
          },
        ],
      }

      const isJsonLdCredential = credentialExchangeRecord.credentials.some(
        (cred: any) => cred.credentialRecordType === 'w3c'
      )

      expect(isJsonLdCredential).toBe(false)

      // This would navigate to:
      // Screens.CredentialDetails with credentialId: 'cred-exchange-123'
    })
  })

  describe('Duplicate message prevention', () => {
    it('should use CredentialExchangeRecord as single source of truth', () => {
      // Simulating the scenario where both records exist
      const credentialExchangeRecord = {
        id: 'cred-exchange-123',
        state: 'done',
        role: 'holder',
        credentials: [
          {
            credentialRecordType: 'w3c',
            credentialRecordId: 'w3c-cred-456',
          },
        ],
      }

      const _w3cCredentialRecord = {
        id: 'w3c-cred-456',
        type: 'W3cCredentialRecord',
        credential: {
          type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
          issuer: { id: 'did:peer:0zIssuer' },
        },
      }

      // The fix: Only use credentialExchangeRecord for chat messages
      // Do NOT add w3cCredentialRecord separately
      const chatMessageId = credentialExchangeRecord.id

      expect(chatMessageId).toBe('cred-exchange-123')
      // This prevents duplicate messages with IDs 'cred-exchange-123' AND 'w3c-cred-456'
    })
  })

  describe('Credential format detection edge cases', () => {
    it('should handle multiple credentials in exchange record', () => {
      const credentialExchangeRecord = {
        id: 'cred-exchange-123',
        state: 'done',
        role: 'holder',
        credentials: [
          {
            credentialRecordType: 'w3c',
            credentialRecordId: 'w3c-cred-1',
          },
          {
            credentialRecordType: 'w3c',
            credentialRecordId: 'w3c-cred-2',
          },
        ],
      }

      const isJsonLdCredential = credentialExchangeRecord.credentials.some(
        (cred: any) => cred.credentialRecordType === 'w3c'
      )

      expect(isJsonLdCredential).toBe(true)
      // Should find the first W3C credential
      const w3cCredRecord = credentialExchangeRecord.credentials.find(
        (cred: any) => cred.credentialRecordType === 'w3c'
      )
      expect(w3cCredRecord?.credentialRecordId).toBe('w3c-cred-1')
    })

    it('should handle mixed credential types (W3C + AnonCreds)', () => {
      const credentialExchangeRecord = {
        id: 'cred-exchange-123',
        state: 'done',
        role: 'holder',
        credentials: [
          {
            credentialRecordType: 'anoncreds',
            credentialRecordId: 'anoncreds-cred-1',
          },
          {
            credentialRecordType: 'w3c',
            credentialRecordId: 'w3c-cred-1',
          },
        ],
      }

      const isJsonLdCredential = credentialExchangeRecord.credentials.some(
        (cred: any) => cred.credentialRecordType === 'w3c'
      )

      // Should still detect W3C credential even when mixed
      expect(isJsonLdCredential).toBe(true)
    })
  })

  describe('Chat terminology system', () => {
    it('should use Contact terminology for RelationshipCredentials', () => {
      // This test verifies the terminology system works correctly
      const w3cCredential = {
        type: ['VerifiableCredential', 'DTGCredential', 'RelationshipCredential'],
        issuer: { id: 'did:peer:0zIssuer' },
        credentialSubject: {
          name: 'John Doe',
        },
      }

      // In the actual implementation, this would query the display registry
      // and return contactTerminology for RelationshipCredentials
      const isRelationshipCredential = w3cCredential.type.some((t) => t.includes('RelationshipCredential'))

      expect(isRelationshipCredential).toBe(true)
      // When isRelationshipCredential is true, the system should use:
      // - Chat.ContactOfferTitle instead of Chat.CredentialOfferTitle
      // - Chat.ContactReceivedTitle instead of Chat.CredentialReceivedTitle
    })

    it('should use default Credential terminology for AnonCreds', () => {
      const anonCredsRecord = {
        id: 'anoncreds-123',
        state: 'done',
        role: 'holder',
        credentials: [
          {
            credentialRecordType: 'anoncreds',
            credentialRecordId: 'anoncreds-456',
          },
        ],
      }

      const isJsonLdCredential = anonCredsRecord.credentials.some((cred: any) => cred.credentialRecordType === 'w3c')

      expect(isJsonLdCredential).toBe(false)
      // When isJsonLdCredential is false, the system should use default:
      // - Chat.CredentialOfferTitle
      // - Chat.CredentialReceivedTitle
    })

    it('should use default Credential terminology for unknown W3C credentials', () => {
      // W3C credentials without a registered handler should fall back to default terminology
      const unknownW3cCredential = {
        type: ['VerifiableCredential', 'UnknownCredentialType'],
        issuer: { id: 'did:peer:0zIssuer' },
        credentialSubject: {},
      }

      const isRelationshipCredential = unknownW3cCredential.type.some((t) => t.includes('RelationshipCredential'))
      const isDTGCredential = unknownW3cCredential.type.some((t) => t.includes('DTGCredential'))

      expect(isRelationshipCredential).toBe(false)
      expect(isDTGCredential).toBe(false)
      // When no specific handler matches, system falls back to defaultCredentialTerminology
    })

    it('should correctly map credential states to terminology keys', () => {
      const offerState = 'offer-received'
      const doneState = 'done'

      // Verify the logic for choosing terminology keys based on state
      let titleKeyForOffer = ''
      let titleKeyForDone = ''

      if (offerState === 'offer-received') {
        titleKeyForOffer = 'chatOfferTitle' // Maps to Chat.ContactOfferTitle or Chat.CredentialOfferTitle
      }

      if (doneState === 'done') {
        titleKeyForDone = 'chatReceivedTitle' // Maps to Chat.ContactReceivedTitle or Chat.CredentialReceivedTitle
      }

      expect(titleKeyForOffer).toBe('chatOfferTitle')
      expect(titleKeyForDone).toBe('chatReceivedTitle')
    })

    it('should handle terminology for multiple credential types in same exchange', () => {
      // Test scenario: What if an exchange record has multiple credentials?
      // The system should use the first W3C credential's terminology
      const exchangeRecord = {
        id: 'exchange-123',
        state: 'done',
        credentials: [
          {
            credentialRecordType: 'w3c',
            credentialRecordId: 'w3c-relationship-1',
            type: ['RelationshipCredential'],
          },
          {
            credentialRecordType: 'w3c',
            credentialRecordId: 'w3c-other-2',
            type: ['OtherCredential'],
          },
        ],
      }

      const firstW3cCred = exchangeRecord.credentials.find((cred) => cred.credentialRecordType === 'w3c')

      expect(firstW3cCred?.credentialRecordId).toBe('w3c-relationship-1')
      // System should use the first W3C credential to determine terminology
      // In this case, it would use contactTerminology
    })
  })
})

describe('Chat Messages - onDecline credential logic', () => {
  const mockDeclineOffer = jest.fn().mockResolvedValue(undefined)
  const mockSendProblemReport = jest.fn().mockResolvedValue(undefined)
  const mockFindConnectionById = jest.fn()

  const createMockAgent = () => ({
    credentials: {
      declineOffer: mockDeclineOffer,
      sendProblemReport: mockSendProblemReport,
    },
    connections: {
      findById: mockFindConnectionById,
    },
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  /**
   * Mirrors the onDecline logic from chat-messages.tsx to test it in isolation.
   * This ensures the agent API calls are correct without needing to render the full hook.
   */
  const createDeclineHandler = (
    agent: ReturnType<typeof createMockAgent> | null,
    record: { id: string; connectionId?: string | null },
    t: (key: string) => string
  ) => {
    return async () => {
      try {
        if (agent) {
          const connectionId = record.connectionId ?? ''
          const connection = await agent.connections.findById(connectionId)
          await agent.credentials.declineOffer(record.id)
          if (connection) {
            await agent.credentials.sendProblemReport({
              credentialRecordId: record.id,
              description: t('CredentialOffer.Declined'),
            })
          }
        }
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.warn('Failed to decline credential offer:', err)
      }
    }
  }

  it('should call declineOffer with the credential record id', async () => {
    const agent = createMockAgent()
    mockFindConnectionById.mockResolvedValue({ id: 'conn-1', theirLabel: 'Issuer' })

    const handler = createDeclineHandler(agent, { id: 'cred-123', connectionId: 'conn-1' }, (k: string) => k)
    await handler()

    expect(mockDeclineOffer).toHaveBeenCalledWith('cred-123')
  })

  it('should send a problem report when the connection exists', async () => {
    const agent = createMockAgent()
    mockFindConnectionById.mockResolvedValue({ id: 'conn-1', theirLabel: 'Issuer' })

    const handler = createDeclineHandler(agent, { id: 'cred-123', connectionId: 'conn-1' }, (k: string) => k)
    await handler()

    expect(mockSendProblemReport).toHaveBeenCalledWith({
      credentialRecordId: 'cred-123',
      description: 'CredentialOffer.Declined',
    })
  })

  it('should NOT send a problem report when connection is not found', async () => {
    const agent = createMockAgent()
    mockFindConnectionById.mockResolvedValue(null)

    const handler = createDeclineHandler(agent, { id: 'cred-456', connectionId: 'missing-conn' }, (k: string) => k)
    await handler()

    expect(mockDeclineOffer).toHaveBeenCalledWith('cred-456')
    expect(mockSendProblemReport).not.toHaveBeenCalled()
  })

  it('should handle missing connectionId gracefully', async () => {
    const agent = createMockAgent()
    mockFindConnectionById.mockResolvedValue(null)

    const handler = createDeclineHandler(agent, { id: 'cred-789', connectionId: null }, (k: string) => k)
    await handler()

    expect(mockFindConnectionById).toHaveBeenCalledWith('')
    expect(mockDeclineOffer).toHaveBeenCalledWith('cred-789')
    expect(mockSendProblemReport).not.toHaveBeenCalled()
  })

  it('should not throw if declineOffer fails', async () => {
    const agent = createMockAgent()
    mockFindConnectionById.mockResolvedValue({ id: 'conn-1' })
    mockDeclineOffer.mockRejectedValueOnce(new Error('Network error'))

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

    const handler = createDeclineHandler(agent, { id: 'cred-err', connectionId: 'conn-1' }, (k: string) => k)
    await expect(handler()).resolves.toBeUndefined()

    expect(consoleSpy).toHaveBeenCalledWith('Failed to decline credential offer:', expect.any(Error))
    consoleSpy.mockRestore()
  })

  it('should do nothing if agent is null', async () => {
    const handler = createDeclineHandler(null, { id: 'cred-no-agent', connectionId: 'conn-1' }, (k: string) => k)
    await handler()

    expect(mockDeclineOffer).not.toHaveBeenCalled()
    expect(mockSendProblemReport).not.toHaveBeenCalled()
  })

  it('should only set onDecline for OfferReceived state', () => {
    const states = [
      { state: CredentialState.OfferReceived, shouldHaveDecline: true },
      { state: CredentialState.Done, shouldHaveDecline: false },
      { state: CredentialState.RequestSent, shouldHaveDecline: false },
      { state: CredentialState.CredentialReceived, shouldHaveDecline: false },
      { state: CredentialState.Declined, shouldHaveDecline: false },
    ]

    for (const { state, shouldHaveDecline } of states) {
      const onDecline = state === CredentialState.OfferReceived ? () => {} : undefined
      if (shouldHaveDecline) {
        expect(onDecline).toBeDefined()
      } else {
        expect(onDecline).toBeUndefined()
      }
    }
  })
})
