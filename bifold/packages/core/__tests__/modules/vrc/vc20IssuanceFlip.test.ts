/**
 * Task: VC 2.0 issuance flip (RCE protocol v2).
 *
 * Covers the negotiation surface added for VCDM 2.0:
 * - the relationshipDid handshake now carries `vrc:rceVersion:<n>`, and both
 *   the new and the OLD (pre-flip) parsers must handle the message
 * - buildRCardCredential emits a VCDM 2.0 shape (v2 context, validFrom, no
 *   issuanceDate) for v2 peers and the legacy 1.1 shape otherwise
 */
import { W3cCredentialRepository } from '@credo-ts/core'

import { buildRCardCredential } from '../../../src/modules/vrc/services/rCardCredential'
import { RCE_PROTOCOL_VERSION, buildLegacyIssuerObject } from '../../../src/modules/vrc/vrc-manager'
import { CREDENTIALS_V2_CONTEXT_URL, ED25519_2018_SUITE_CONTEXT_URL } from '@bifold/vrc-contexts'
import { DTG_CONTEXT_URL, RCARD_CONTEXT_URL } from '../../../src/modules/vrc/types/relationshipContext'

const CREDENTIALS_V1_CONTEXT_URL = 'https://www.w3.org/2018/credentials/v1'

const MY_DID = 'did:peer:0z6MkIssuer000000000000000000000000000000000000'
const THEIR_DID = 'did:peer:0z6MkSubject00000000000000000000000000000000000'

const JCARD = [
  'vcard',
  [
    ['version', {}, 'text', '4.0'],
    ['fn', {}, 'text', 'Alice Example'],
    ['email', {}, 'text', 'alice@example.org'],
  ],
]

/** Minimal agent whose W3cCredentialRepository returns one R-Card template record */
function buildAgentWithTemplate() {
  const templateRecord = {
    id: 'rcard-template-record',
    encoded: {
      id: 'urn:uuid:template',
      '@context': [CREDENTIALS_V1_CONTEXT_URL],
      type: ['VerifiableCredential', 'RCardTemplate'],
      credentialSubject: {
        id: 'urn:uuid:template',
        templateId: 'rcard-basic-1',
        label: 'Default business card',
        jcard: JCARD,
      },
    },
  }
  const repository = {
    findByQuery: jest.fn().mockResolvedValue([templateRecord]),
  }
  return {
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
    dependencyManager: {
      resolve: jest.fn((token: unknown) => {
        if (token === W3cCredentialRepository) return repository
        throw new Error('Unexpected token')
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('RCE protocol version handshake', () => {
  const message = `This is my relationship DID: vrc:relationshipDid:${MY_DID} vrc:rceVersion:${RCE_PROTOCOL_VERSION}`

  test('this app announces RCE v3 (Data Integrity capable)', () => {
    expect(RCE_PROTOCOL_VERSION).toBe(3)
  })

  test('the OLD (pre-flip) parser still extracts the DID from the new message', () => {
    // Exact regex used by pre-VC-2.0 app versions — the version suffix must not break it
    const legacyMatch = message.match(/vrc:relationshipDid:(did:peer:[a-zA-Z0-9]+)/)
    expect(legacyMatch?.[1]).toBe(MY_DID)
  })

  test('the new parser extracts the announced version', () => {
    const versionMatch = message.match(/vrc:rceVersion:(\d+)/)
    expect(versionMatch && parseInt(versionMatch[1], 10)).toBe(RCE_PROTOCOL_VERSION)
  })

  test('a message without a version marker means a v1 (legacy) peer', () => {
    const legacyMessage = `This is my relationship DID: vrc:relationshipDid:${MY_DID}`
    const versionMatch = legacyMessage.match(/vrc:rceVersion:(\d+)/)
    expect(versionMatch).toBeNull()
  })
})

describe('buildRCardCredential data model versions', () => {
  test('emits VCDM 2.0 shape for a v2 peer (useVc20: true)', async () => {
    const agent = buildAgentWithTemplate()
    const credential = await buildRCardCredential(agent, MY_DID, THEIR_DID, { useVc20: true })

    // Suite context is required at build time so the signed credential's
    // @context still equals the offered one (credo holder-side equality check)
    expect(credential['@context']).toEqual([
      CREDENTIALS_V2_CONTEXT_URL,
      DTG_CONTEXT_URL,
      RCARD_CONTEXT_URL,
      ED25519_2018_SUITE_CONTEXT_URL,
    ])
    expect(credential.type).toEqual(['VerifiableCredential', 'RelationshipCard'])
    expect(credential.issuer).toBe(MY_DID)
    expect(credential.validFrom).toBeDefined()
    expect(credential.issuanceDate).toBeUndefined()
    expect(credential.credentialSubject).toEqual({ id: THEIR_DID, card: JCARD })
  })

  test('emits legacy VCDM 1.1 shape when the peer did not negotiate v2', async () => {
    const agent = buildAgentWithTemplate()
    const credential = await buildRCardCredential(agent, MY_DID, THEIR_DID)

    expect(credential['@context']).toEqual([CREDENTIALS_V1_CONTEXT_URL, DTG_CONTEXT_URL, RCARD_CONTEXT_URL])
    expect(credential.issuanceDate).toBeDefined()
    expect(credential.validFrom).toBeUndefined()
    expect(credential.credentialSubject).toEqual({ id: THEIR_DID, card: JCARD })
  })

  test('backdates issuance for clock skew in both shapes', async () => {
    const agent = buildAgentWithTemplate()
    const v2 = await buildRCardCredential(agent, MY_DID, THEIR_DID, { useVc20: true })
    const v1 = await buildRCardCredential(agent, MY_DID, THEIR_DID, { useVc20: false })

    expect(new Date(v2.validFrom).getTime()).toBeLessThan(Date.now())
    expect(new Date(v1.issuanceDate).getTime()).toBeLessThan(Date.now())
  })
})

describe('legacy issuer object for pre-Phase-5 peers', () => {
  // Old app versions read the contact display name from the VRC issuer object
  // and cannot process the separate RCard credential, so VRCs issued to v1
  // peers must keep embedding {id, name, email, organization}.
  test('embeds contact info from the R-Card template', async () => {
    const agent = buildAgentWithTemplate()
    const issuer = await buildLegacyIssuerObject(agent, MY_DID)

    expect(issuer.id).toBe(MY_DID)
    expect(issuer.name).toBe('Alice Example')
    expect(issuer.email).toBe('alice@example.org')
  })

  test('falls back to a placeholder name without a template', async () => {
    const agent = buildAgentWithTemplate()
    agent.dependencyManager.resolve = jest.fn(() => ({ findByQuery: jest.fn().mockResolvedValue([]) }))
    const issuer = await buildLegacyIssuerObject(agent, MY_DID)

    expect(issuer).toEqual({ id: MY_DID, name: 'Unknown Contact' })
  })
})
