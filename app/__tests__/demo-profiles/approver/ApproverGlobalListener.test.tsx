import { ContactCredentialDetails, PendingTrustTaskPrompt, Screens, Stacks, trustTaskPromptStore } from '@bifold/core'
import { useAgent } from '@bifold/react-hooks'
import { render, waitFor } from '@testing-library/react-native'
import React from 'react'
import Toast from 'react-native-toast-message'

import ApproverGlobalListener from '@/demo-profiles/approver/ApproverGlobalListener'
import { TYPE_URI } from '@/demo-profiles/approver/ceremony'

jest.mock('@bifold/react-hooks')
jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn(), hide: jest.fn() },
}))

const mockNavigate = jest.fn()
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}))

const mockGetContactCredentialDetailsForConnection = jest.fn()
jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  getContactCredentialDetailsForConnection: (...args: unknown[]) =>
    mockGetContactCredentialDetailsForConnection(...args),
}))

const mockUseAgent = useAgent as jest.MockedFunction<typeof useAgent>
const mockToastShow = Toast.show as jest.MockedFunction<typeof Toast.show>

const CONNECTION_ID = 'connection-1'
const AGENT = { w3cCredentials: { getAll: jest.fn().mockResolvedValue([]) } } as any
const CONTACT: ContactCredentialDetails = { issuer: { id: 'did:peer:alice', name: 'Alice Smith' } }

const PROMPT: PendingTrustTaskPrompt = {
  connectionId: CONNECTION_ID,
  typeUri: TYPE_URI,
  document: { id: 'doc-1', type: TYPE_URI, payload: { resource: 'the shared photo album' } },
  counterpartyLabel: 'Alice Smith',
  summary: 'wants access to the shared photo album',
}

/** Grabs the onPress handler from the last Toast.show(...) call and fires it, same as a real tap would. */
async function tapToast() {
  const onPress = mockToastShow.mock.calls[mockToastShow.mock.calls.length - 1][0].onPress
  onPress?.()
  await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
}

describe('ApproverGlobalListener', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    trustTaskPromptStore.clear()
    mockUseAgent.mockReturnValue({ agent: AGENT } as any)
  })

  it('toasts on an incoming approver request, naming the counterparty and what it is about', () => {
    render(<ApproverGlobalListener />)

    trustTaskPromptStore.emit('prompt', PROMPT)

    expect(mockToastShow).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Alice Smith', text2: PROMPT.summary }))
  })

  it('ignores a prompt for a different task type', () => {
    render(<ApproverGlobalListener />)

    trustTaskPromptStore.emit('prompt', { ...PROMPT, typeUri: 'https://example.org/spec/some-other-type/0.1' })

    expect(mockToastShow).not.toHaveBeenCalled()
  })

  it('navigates to the sender’s Contact Details when it can be resolved', async () => {
    mockGetContactCredentialDetailsForConnection.mockResolvedValue(CONTACT)
    render(<ApproverGlobalListener />)
    trustTaskPromptStore.emit('prompt', PROMPT)

    await tapToast()

    expect(mockNavigate).toHaveBeenCalledWith(Stacks.ContactStack, {
      screen: Screens.ContactDetails,
      params: { contact: CONTACT },
    })
  })

  it('falls back to Chat when no contact can be resolved for the connection', async () => {
    mockGetContactCredentialDetailsForConnection.mockResolvedValue(null)
    render(<ApproverGlobalListener />)
    trustTaskPromptStore.emit('prompt', PROMPT)

    await tapToast()

    expect(mockNavigate).toHaveBeenCalledWith(Stacks.ContactStack, {
      screen: Screens.Chat,
      params: { connectionId: CONNECTION_ID },
    })
  })
})
