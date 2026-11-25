/**
 * A community's card can be stored for the Wallet (226). Credo expands every
 * JSON-LD credential when it stores one, using the app's document loader, and
 * the DTG context community cards name (https://firstperson.network/credentials/dtg/v1)
 * is not published: the URL answers 404 with an HTML page. On a device the
 * store threw "Dereferencing a URL did not result in a valid JSON-LD object"
 * and the Wallet stayed empty, while every check that did not expand passed.
 *
 * This runs Credo's own expansion step (W3cJsonLdCredentialService
 * .getExpandedTypesForCredential, which storeCredential calls) with the app's
 * loader on cards shaped as a VTC issues them, with the network answering as
 * the real URL does.
 */
import {
  JsonLdModuleConfig,
  SignatureSuiteRegistry,
  W3cJsonLdCredentialService,
  W3cJsonLdVerifiableCredential,
  type AgentContext,
} from '@credo-ts/core'

import { COMMUNITY, membershipCard, vetterGrantProofSet } from '../../../../__tests__/helpers/cardVault'
import { createVrcDocumentLoader, DTG_CREDENTIALS_V1_CONTEXT_URL } from '../../vrc/createVrcDocumentLoader'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// As a VTC issues it: a status list entry with a string index (vtc-service credentials/dtg.rs).
const issuedCard = {
  ...membershipCard,
  credentialStatus: {
    id: 'https://vtc.example/v1/status/revocation#4747',
    type: 'BitstringStatusListEntry',
    statusPurpose: 'revocation',
    statusListIndex: '4747',
    statusListCredential: 'https://vtc.example/v1/status/revocation',
  },
}

// Only URL contexts are loaded here; no DID is ever resolved.
const agentContext = {
  dependencyManager: { resolve: () => ({ resolve: jest.fn() }) },
} as unknown as AgentContext

const expandedTypesOf = (card: Record<string, unknown>) =>
  new W3cJsonLdCredentialService(
    new SignatureSuiteRegistry([]),
    new JsonLdModuleConfig({ documentLoader: createVrcDocumentLoader })
  ).getExpandedTypesForCredential(agentContext, W3cJsonLdVerifiableCredential.fromJson(card))

describe('storing a community card for the Wallet', () => {
  let fetchMock: jest.SpyInstance
  beforeEach(() => {
    // The real URL: 404, an HTML page. Nothing here may reach the network.
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        ({
          ok: false,
          status: 404,
          json: async () => {
            throw new SyntaxError('Unexpected token < in JSON at position 0')
          },
        }) as unknown as Response
    )
  })
  afterEach(() => fetchMock.mockRestore())

  it.each([
    ['a membership card with its status list entry', issuedCard, 'MembershipCredential'],
    ['a vetter grant signed with a proof set', vetterGrantProofSet, 'EndorsementCredential'],
  ])('%s expands, so it can be stored', async (_name, card, type) => {
    const types = await expandedTypesOf(card as Record<string, unknown>)
    expect(types).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`${type}$`))]))
    expect(types).toEqual(expect.arrayContaining([expect.stringMatching(/DTGCredential$/)]))
    // Served locally: the unpublished URL is never fetched.
    expect(fetchMock).not.toHaveBeenCalledWith(DTG_CREDENTIALS_V1_CONTEXT_URL, expect.anything())
    expect(fetchMock).not.toHaveBeenCalledWith(DTG_CREDENTIALS_V1_CONTEXT_URL)
    expect(issuedCard.issuer).toBe(COMMUNITY)
  })
})
