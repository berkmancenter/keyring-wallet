/**
 * The community screen led with the community's DID, because a DID is what
 * the app keys a community by. A person reads the top of a screen as what the
 * thing is called ("not everyone is a power user", tester report #12), so the
 * name leads and the DID — still the only checkable thing here — sits one tap
 * away under Details, where every other detail already is.
 */
import { useRoute } from '@react-navigation/native'
import { render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { communityTarget } from '../module/vtiCommunityLink'
import VtiCommunity from '../screens/VtiCommunity'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../module/vtiAgent', () => ({
  vtiAgent: { fetchManifest: jest.fn(async () => ({ criteria: [] })) },
  VtiRefusal: class extends Error {},
}))
jest.mock('../module/vtiLeave', () => ({ leaveCommunity: jest.fn() }))
jest.mock('../module/VtiCommunityStore', () => ({
  GenericRecordsCommunityStore: class {
    getMembership = async () => undefined
    listHeldCredentials = async () => []
  },
}))
jest.mock('../module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: class {
    getPersona = async () => undefined
  },
}))

const communityDid = 'did:webvh:QmUsH14W1foRZyP9v7LtfxwFy7qWgzNBLSzhWhbMQeMPJB:keyring-vti-vtc.ngrok.app'

const show = () => {
  const mockUseRoute = useRoute as jest.Mock
  const mockUseAgent = useAgent as jest.Mock
  mockUseRoute.mockReturnValue({ params: { communityDid } })
  mockUseAgent.mockReturnValue({ agent: undefined })
  return render(
    <BasicAppContext>
      <VtiCommunity />
    </BasicAppContext>
  )
}

describe('the community screen', () => {
  beforeEach(() => communityTarget.clear())

  it('leads with the name, not the DID, and keeps the DID under Details', () => {
    communityTarget.publishedName(communityDid, 'Keyring Lab Community')
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('CommunityName'))).toHaveTextContent('Keyring Lab Community')
    // Closed by default — and reachable, in the same place as every other detail.
    expect(tree.queryByTestId(testIdWithKey('CommunityDid'))).toBeNull()
    expect(tree.getByTestId(testIdWithKey('CommunityDetailsToggle'))).toBeTruthy()
  })

  it('says a community published no name rather than showing its host as one', () => {
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('CommunityName'))).toHaveTextContent('Join.Unnamed')
    expect(tree.queryByTestId(testIdWithKey('CommunityNameClaimed'))).toBeNull()
  })

  it('a name only a link claimed says where it came from', () => {
    communityTarget.set({ communityDid, name: 'Totally The Real One' })
    const tree = show()
    expect(tree.getByTestId(testIdWithKey('CommunityName'))).toHaveTextContent('Totally The Real One')
    expect(tree.getByTestId(testIdWithKey('CommunityNameClaimed'))).toHaveTextContent('Join.NameFromLink')
  })
})
