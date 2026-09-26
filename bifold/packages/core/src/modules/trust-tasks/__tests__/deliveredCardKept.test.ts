/**
 * A card a community delivers is kept only once it holds up (sync release,
 * as openvtc checks every issued credential since #380). Before, Keyring kept
 * a membership, a role or a vetter grant on the strength of its sender alone.
 */
import { DeviceEventEmitter } from 'react-native'

import { CREDENTIAL_EXCHANGE_ISSUE, receiveIssue } from '../module/vtiInbox'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const COMMUNITY = 'did:webvh:QmCommunity:vtc.example:keyring-test-vtc'
const PERSONA = 'did:webvh:QmPersona:dids.example:negative-weird'

const membership = {
  '@context': ['https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1'],
  id: 'urn:uuid:5b1d8f0e-7c2a-4a8e-9d31-0f6c2e4b7a19',
  type: ['VerifiableCredential', 'DTGCredential', 'MembershipCredential'],
  issuer: COMMUNITY,
  validFrom: '2026-09-26T09:00:00Z',
  validUntil: '2026-10-26T09:00:00Z',
  credentialSubject: { id: PERSONA },
  proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', proofValue: 'z-altered' },
}

function world() {
  const stored: unknown[] = []
  const store = {
    getMembership: async () => undefined,
    saveMembership: async (m: unknown) => void stored.push(m),
    saveHeldCredential: async (c: unknown) => void stored.push(c),
  }
  const message = {
    id: 'urn:uuid:0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
    type: CREDENTIAL_EXCHANGE_ISSUE,
    from: COMMUNITY,
    body: { credential_response: { credential: membership } },
  }
  return { store, stored, message }
}

describe('a delivered card is kept only when it holds up', () => {
  afterEach(() => jest.restoreAllMocks())

  it('is not kept when its check refuses it, and the refusal is said', async () => {
    const { store, stored, message } = world()
    const refused: string[] = []
    const emit = jest.spyOn(DeviceEventEmitter, 'emit')
    const got = await receiveIssue(
      store as never,
      PERSONA,
      message as never,
      {
        onRefused: (_item, why) => void refused.push(why),
        checkCard: async () => 'proof',
      } as never
    )
    expect(got).toEqual([])
    expect(stored).toEqual([])
    expect(refused).toEqual(['proof'])
    expect(emit).toHaveBeenCalledWith('vti:card-refused', {
      communityDid: COMMUNITY,
      kind: 'membership',
      refusal: 'proof',
    })
  })

  it('is checked against the community that sent it', async () => {
    const { store, stored, message } = world()
    const checked: [unknown, string][] = []
    await receiveIssue(
      store as never,
      PERSONA,
      message as never,
      {
        checkCard: async (credential: unknown, issuer: string) => {
          checked.push([credential, issuer])
          return undefined
        },
      } as never
    )
    expect(checked).toEqual([[membership, COMMUNITY]])
    expect(stored).toHaveLength(1)
  })

  it('is left for redelivery when its check cannot finish now', async () => {
    const { store, stored, message } = world()
    await expect(
      receiveIssue(
        store as never,
        PERSONA,
        message as never,
        {
          checkCard: async () => {
            throw new Error('status list unreachable')
          },
        } as never
      )
    ).rejects.toThrow('status list unreachable')
    expect(stored).toEqual([])
  })
})
