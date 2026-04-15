/**
 * Unit tests for Witnessed Exchange Context
 */

import {
  WITNESSED_EXCHANGE_CONTEXT_URL,
  WITNESSED_EXCHANGE_CONTEXT_DOCUMENT,
} from '../../types/witnessedExchangeContext'

describe('Witnessed Exchange Context', () => {
  describe('WITNESSED_EXCHANGE_CONTEXT_URL', () => {
    it('should have the correct URL', () => {
      expect(WITNESSED_EXCHANGE_CONTEXT_URL).toBe('https://trustoverip.org/credentials/witnessed-exchange/v1')
    })
  })

  describe('WITNESSED_EXCHANGE_CONTEXT_DOCUMENT', () => {
    it('should have @context with correct version', () => {
      expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']['@version']).toBe(1.1)
    })

    it('should define WitnessedCredential type', () => {
      expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']['WitnessedCredential']).toBeDefined()
      expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']['WitnessedCredential']).toContain(
        'witnessed-exchange#WitnessedCredential'
      )
    })

    it('should define session-related terms', () => {
      const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']

      expect(context['session']).toBeDefined()
      expect(context['witnessId']).toBeDefined()
      expect(context['startTime']).toBeDefined()
      expect(context['expirationTime']).toBeDefined()
    })

    it('should define witness-related terms', () => {
      const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']

      expect(context['witness']).toBeDefined()
      expect(context['alsoKnownAs']).toBeDefined()
      expect(context['linkageProofs']).toBeDefined()
      expect(context['externalProofs']).toBeDefined()
      expect(context['nonce']).toBeDefined()
    })

    it('should define witnessedCredentials term', () => {
      const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']

      expect(context['witnessedCredentials']).toBeDefined()
      expect(context['digest']).toBeDefined()
    })

    it('should define authorization terms', () => {
      const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']

      expect(context['authorizationCredential']).toBeDefined()
      expect(context['role']).toBeDefined()
    })

    it('should define subject term for enhanced VRC identification', () => {
      const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']

      expect(context['subject']).toBeDefined()
      expect(context['subject']['@type']).toBe('@id')
    })

    it('should have correct @type for dateTime fields', () => {
      const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']

      expect(context['startTime']['@type']).toBe('http://www.w3.org/2001/XMLSchema#dateTime')
      expect(context['expirationTime']['@type']).toBe('http://www.w3.org/2001/XMLSchema#dateTime')
    })

    it('should have correct @container for array fields', () => {
      const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']

      expect(context['alsoKnownAs']['@container']).toBe('@set')
      expect(context['linkageProofs']['@container']).toBe('@set')
      expect(context['externalProofs']['@container']).toBe('@set')
      expect(context['witnessedCredentials']['@container']).toBe('@set')
    })
  })
})
