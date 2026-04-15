/**
 * Unit tests for Witnessed Exchange Context (VWC JSON-LD Context)
 *
 * Tests that the JSON-LD context for Verifiable Witness Credentials (VWCs)
 * defines all required terms according to the ToIP DTGWG specification.
 */

import {
  WITNESSED_EXCHANGE_CONTEXT_URL,
  WITNESSED_EXCHANGE_CONTEXT_DOCUMENT,
} from '../../src/witnessedExchangeContext'

describe('WitnessedExchangeContext', () => {
  describe('WITNESSED_EXCHANGE_CONTEXT_URL', () => {
    it('should be the correct ToIP spec URL', () => {
      expect(WITNESSED_EXCHANGE_CONTEXT_URL).toBe('https://trustoverip.org/credentials/witnessed-exchange/v1')
    })

    it('should be a valid URL string', () => {
      expect(typeof WITNESSED_EXCHANGE_CONTEXT_URL).toBe('string')
    })

    it('should use HTTPS protocol', () => {
      expect(WITNESSED_EXCHANGE_CONTEXT_URL).toMatch(/^https:\/\//)
    })
  })

  describe('WITNESSED_EXCHANGE_CONTEXT_DOCUMENT', () => {
    it('should have the required @context structure', () => {
      expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT).toHaveProperty('@context')
      expect(typeof WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']).toBe('object')
    })

    it('should specify JSON-LD version 1.1', () => {
      expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']).toHaveProperty('@version', 1.1)
    })

    describe('credential types', () => {
      it('should define WitnessCredential type', () => {
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']).toHaveProperty('WitnessCredential')
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context'].WitnessCredential).toBe(
          'https://trustoverip.org/credentials/witnessed-exchange#WitnessCredential'
        )
      })

      it('should define WitnessedCredential type', () => {
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']).toHaveProperty('WitnessedCredential')
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context'].WitnessedCredential).toBe(
          'https://trustoverip.org/credentials/witnessed-exchange#WitnessedCredential'
        )
      })

      it('should define DTGCredential type', () => {
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']).toHaveProperty('DTGCredential')
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context'].DTGCredential).toBe(
          'https://www.firstperson.network/dtg#DTGCredential'
        )
      })
    })

    describe('schema.org terms', () => {
      it('should define name term for issuer canonicalization', () => {
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']).toHaveProperty('name')
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context'].name).toBe('http://schema.org/name')
      })
    })

    describe('witnessContext terms', () => {
      it('should define witnessContext term', () => {
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']).toHaveProperty('witnessContext')
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context'].witnessContext).toBe(
          'https://trustoverip.org/credentials/witnessed-exchange#witnessContext'
        )
      })

      it('should define sessionId term', () => {
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']).toHaveProperty('sessionId')
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context'].sessionId).toBe(
          'https://trustoverip.org/credentials/witnessed-exchange#sessionId'
        )
      })

      it('should define method term', () => {
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']).toHaveProperty('method')
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context'].method).toBe(
          'https://trustoverip.org/credentials/witnessed-exchange#method'
        )
      })

      it('should define event term', () => {
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']).toHaveProperty('event')
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context'].event).toBe(
          'https://trustoverip.org/credentials/witnessed-exchange#event'
        )
      })

      it('should define localityVerification term', () => {
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']).toHaveProperty('localityVerification')
        expect(WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context'].localityVerification).toBe(
          'https://trustoverip.org/credentials/witnessed-exchange#localityVerification'
        )
      })
    })

    describe('session-related terms', () => {
      it('should define session term with @type @id', () => {
        const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']
        expect(context).toHaveProperty('session')
        expect(context.session['@id']).toBe('https://trustoverip.org/credentials/witnessed-exchange#session')
        expect(context.session['@type']).toBe('@id')
      })

      it('should define witnessId term with @type @id', () => {
        const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']
        expect(context).toHaveProperty('witnessId')
        expect(context.witnessId['@id']).toBe('https://trustoverip.org/credentials/witnessed-exchange#witnessId')
        expect(context.witnessId['@type']).toBe('@id')
      })

      it('should define startTime with dateTime type', () => {
        const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']
        expect(context).toHaveProperty('startTime')
        expect(context.startTime['@type']).toBe('http://www.w3.org/2001/XMLSchema#dateTime')
      })

      it('should define expirationTime with dateTime type', () => {
        const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']
        expect(context).toHaveProperty('expirationTime')
        expect(context.expirationTime['@type']).toBe('http://www.w3.org/2001/XMLSchema#dateTime')
      })
    })

    describe('witness-related terms', () => {
      it('should define witness term with @type @id', () => {
        const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']
        expect(context).toHaveProperty('witness')
        expect(context.witness['@id']).toBe('https://trustoverip.org/credentials/witnessed-exchange#witness')
        expect(context.witness['@type']).toBe('@id')
      })

      it('should define alsoKnownAs with @container @set', () => {
        const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']
        expect(context).toHaveProperty('alsoKnownAs')
        expect(context.alsoKnownAs['@container']).toBe('@set')
      })

      it('should define linkageProofs with @container @set', () => {
        const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']
        expect(context).toHaveProperty('linkageProofs')
        expect(context.linkageProofs['@container']).toBe('@set')
      })

      it('should define externalProofs with @container @set', () => {
        const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']
        expect(context).toHaveProperty('externalProofs')
        expect(context.externalProofs['@container']).toBe('@set')
      })

      it('should define nonce term', () => {
        const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']
        expect(context).toHaveProperty('nonce')
        expect(context.nonce).toBe('https://trustoverip.org/credentials/witnessed-exchange#nonce')
      })
    })

    describe('authorization terms', () => {
      it('should define authorizationCredential term', () => {
        const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']
        expect(context).toHaveProperty('authorizationCredential')
        expect(context.authorizationCredential['@type']).toBe('@id')
      })

      it('should define role term', () => {
        const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']
        expect(context).toHaveProperty('role')
        expect(context.role).toBe('https://trustoverip.org/credentials/witnessed-exchange#role')
      })
    })

    describe('witnessedCredentials terms', () => {
      it('should define witnessedCredentials with @container @set', () => {
        const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']
        expect(context).toHaveProperty('witnessedCredentials')
        expect(context.witnessedCredentials['@container']).toBe('@set')
      })

      it('should define digest term', () => {
        const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']
        expect(context).toHaveProperty('digest')
        expect(context.digest).toBe('https://trustoverip.org/credentials/witnessed-exchange#digest')
      })
    })

    describe('enhanced fields', () => {
      it('should define subject term with @type @id', () => {
        const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']
        expect(context).toHaveProperty('subject')
        expect(context.subject['@id']).toBe('https://trustoverip.org/credentials/witnessed-exchange#subject')
        expect(context.subject['@type']).toBe('@id')
      })
    })

    describe('all required terms are present', () => {
      it('should have all core VWC terms defined', () => {
        const requiredTerms = [
          'WitnessCredential',
          'WitnessedCredential',
          'DTGCredential',
          'name',
          'witnessContext',
          'sessionId',
          'method',
          'event',
          'localityVerification',
        ]

        const context = WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context']

        requiredTerms.forEach((term) => {
          expect(context).toHaveProperty(term)
        })
      })
    })
  })
})
