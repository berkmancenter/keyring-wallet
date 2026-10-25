/**
 * An OpenID proof request waits for the wallet's credentials before it says what can be sent (UI-smoothness plan,
 * Phase 5). The credentials were held as an empty list while they were read, so the request first showed as one
 * this wallet could not answer (only "Dismiss"), then gained Send and Decline. The person's choice of another
 * credential was also copied into state by an effect, so a read again put the first credential back.
 *
 * The display is replaced by a stand-in that keeps the props of every frame it is drawn in.
 */
import { act, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../helpers/app'
import OpenIDProofPresentation from '../../../src/modules/openid/screens/OpenIDProofPresentation'

type Shown = {
  credentialsRequested: { id: string }[]
  selectedCredentialsSubmission?: Record<string, { id: string }>
  onPressAltCredChange: (inputDescriptorID: string, selectedCredID: string) => void
}
const mockShown: Shown[] = []
jest.mock('../../../src/modules/openid/features/OpenIDProofPresentation/OpenIDProofRequestDisplay', () => ({
  __esModule: true,
  default: (props: Shown) => {
    mockShown.push(props)
    return null
  },
}))
jest.mock('../../../src/screens/ProofRequestAccept', () => ({ __esModule: true, default: () => null }))
jest.mock('../../../src/components/modals/CommonRemoveModal', () => ({ __esModule: true, default: () => null }))
jest.mock('../../../src/modules/openid/displayProof', () => ({
  formatOpenIdProofRequest: () => ({
    areAllSatisfied: true,
    purpose: 'age',
    entries: [
      {
        inputDescriptorId: 'age',
        isSatisfied: true,
        credentials: [
          { id: 'card-1', claimFormat: 'ldp_vc' },
          { id: 'card-2', claimFormat: 'ldp_vc' },
        ],
      },
    ],
  }),
}))
let mockGetCredentialById: (id: string) => Promise<{ id: string } | undefined>
jest.mock('../../../src/modules/openid/context/OpenIDCredentialRecordProvider', () => ({
  ...jest.requireActual('../../../src/modules/openid/context/OpenIDCredentialRecordProvider'),
  useOpenIDCredentials: () => ({ getCredentialById: mockGetCredentialById }),
}))

const navigate = jest.fn()
const props = () =>
  ({
    navigation: { navigate, getParent: () => undefined },
    route: { params: { credential: { verifierHostName: 'verifier.example' } } },
  }) as never

const screen = () => (
  <BasicAppContext>
    <OpenIDProofPresentation {...props()} />
  </BasicAppContext>
)

beforeEach(() => {
  mockShown.length = 0
  navigate.mockReset()
})

test('the request is not shown as unanswerable while its credentials are read', async () => {
  let release: () => void = () => undefined
  const read = new Promise<void>((resolve) => (release = resolve))
  mockGetCredentialById = async (id) => {
    await read
    return { id }
  }
  const tree = render(screen())
  await act(async () => undefined)
  // Not drawn at all while unknown: drawn, it was "nothing to send".
  expect(mockShown).toHaveLength(0)
  await act(async () => release())
  expect(mockShown.length).toBeGreaterThan(0)
  expect(mockShown.every((p) => p.credentialsRequested.length > 0 && p.selectedCredentialsSubmission)).toBe(true)
  expect(mockShown[mockShown.length - 1].selectedCredentialsSubmission).toEqual({
    age: { id: 'card-1', claimFormat: 'ldp_vc' },
  })
  tree.unmount()
})

test('a credential the person chose stays chosen when the credentials are read again', async () => {
  mockGetCredentialById = async (id) => ({ id })
  const tree = render(screen())
  await act(async () => undefined)
  const last = () => mockShown[mockShown.length - 1]
  // The person picks the second card (the select screen calls back with it).
  last().onPressAltCredChange('age', 'card-1')
  const { onCredChange } = navigate.mock.calls[0][1]
  await act(async () => onCredChange({ inputDescriptorID: 'age', id: 'card-2', claimFormat: 'ldp_vc' }))
  expect(last().selectedCredentialsSubmission).toEqual({ age: { id: 'card-2', claimFormat: 'ldp_vc' } })
  // The provider hands over a new reader (its records changed): the credentials are read again.
  mockGetCredentialById = async (id) => ({ id })
  tree.rerender(screen())
  await act(async () => undefined)
  expect(last().selectedCredentialsSubmission).toEqual({ age: { id: 'card-2', claimFormat: 'ldp_vc' } })
  tree.unmount()
})
