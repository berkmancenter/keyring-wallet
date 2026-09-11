import {
  ContactCredentialDetails,
  PendingTrustTaskPrompt,
  testIdWithKey,
  trustTaskPromptStore,
  useTheme,
} from '@bifold/core'
import { useAgent } from '@bifold/react-hooks'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import ApproverContactSection from '@/demo-profiles/approver/ApproverContactSection'
import { TYPE_URI, approverDecisionEvents } from '@/demo-profiles/approver/ceremony'

// Real trustTaskPromptStore/approverDecisionEvents (both plain EventEmitter
// singletons) drive these tests directly, the same way genericApproval.test.ts
// does bifold-core-side — only the agent, theme, and the generic approval
// modal (bifold-core UI already covered separately) are mocked.
jest.mock('@bifold/react-hooks')
jest.mock('@bifold/core', () => {
  const actual = jest.requireActual('@bifold/core')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ReactLib = require('react')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Text, TouchableOpacity } = require('react-native')
  return {
    ...actual,
    useTheme: jest.fn(),
    TrustTaskApprovalModal: (props: { summary: string; onApprove: () => void; onDeny: () => void }) =>
      ReactLib.createElement(
        ReactLib.Fragment,
        null,
        ReactLib.createElement(Text, { testID: 'MockApprovalModal' }, props.summary),
        ReactLib.createElement(TouchableOpacity, { testID: 'MockApprove', onPress: props.onApprove }),
        ReactLib.createElement(TouchableOpacity, { testID: 'MockDeny', onPress: props.onDeny })
      ),
  }
})
jest.mock('@/demo-profiles/approver/ceremony', () => ({
  ...jest.requireActual('@/demo-profiles/approver/ceremony'),
  proposeAccessRequest: jest.fn().mockResolvedValue(undefined),
  respondToAccessRequest: jest.fn().mockResolvedValue(undefined),
}))

// eslint-disable-next-line import/first
import { proposeAccessRequest, respondToAccessRequest } from '@/demo-profiles/approver/ceremony'

const mockUseAgent = useAgent as jest.MockedFunction<typeof useAgent>
const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>
const mockProposeAccessRequest = proposeAccessRequest as jest.MockedFunction<typeof proposeAccessRequest>
const mockRespondToAccessRequest = respondToAccessRequest as jest.MockedFunction<typeof respondToAccessRequest>

const CONNECTION_ID = 'connection-1'
const CONTACT: ContactCredentialDetails = { issuer: { id: 'did:peer:alice', name: 'Alice Smith' } }
const AGENT = {} as any

const PENDING_PROMPT: PendingTrustTaskPrompt = {
  connectionId: CONNECTION_ID,
  typeUri: TYPE_URI,
  document: { id: 'doc-1', type: TYPE_URI, payload: { resource: 'the shared photo album' } },
  counterpartyLabel: 'Alice Smith',
  summary: 'wants access to the shared photo album',
}

const requestButtonId = testIdWithKey('ApproverRequestAccess')
const awaitingRowId = testIdWithKey('ApproverAwaitingResponse')
const cancelButtonId = testIdWithKey('ApproverCancelRequest')
const lastDecisionId = testIdWithKey('ApproverLastDecision')

describe('ApproverContactSection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    trustTaskPromptStore.clear()
    mockUseAgent.mockReturnValue({ agent: AGENT } as any)
    mockUseTheme.mockReturnValue({
      ColorPalette: { brand: { primaryBackground: '#000', text: '#fff', primary: '#111', buttonText: '#fff' } },
      TextTheme: { headingThree: {}, normal: {} },
    } as any)
  })

  it('renders nothing while connectionId has not resolved yet', () => {
    const { queryByTestId } = render(<ApproverContactSection contact={CONTACT} connectionId={null} />)

    expect(queryByTestId('MockApprovalModal')).toBeNull()
    expect(queryByTestId(requestButtonId)).toBeNull()
  })

  it('shows a request already pending in the store once connectionId resolves late', async () => {
    // Mirrors the real sequence: the request arrives (and is recorded in the
    // store) BEFORE ContactDetails' own async lookup has resolved a
    // connectionId — e.g. tapping ApproverGlobalListener's toast, which
    // navigates here from the very 'prompt' event that populated this.
    trustTaskPromptStore.setPending(PENDING_PROMPT)

    const { rerender, queryByTestId, findByTestId } = render(
      <ApproverContactSection contact={CONTACT} connectionId={null} />
    )
    expect(queryByTestId('MockApprovalModal')).toBeNull()

    rerender(<ApproverContactSection contact={CONTACT} connectionId={CONNECTION_ID} />)

    expect(await findByTestId('MockApprovalModal')).toBeTruthy()
  })

  it('sends a request, shows a waiting state, and lets the user cancel it locally', async () => {
    const { getByTestId, findByTestId, queryByTestId } = render(
      <ApproverContactSection contact={CONTACT} connectionId={CONNECTION_ID} />
    )

    fireEvent.press(getByTestId(requestButtonId))
    await findByTestId(awaitingRowId)
    expect(mockProposeAccessRequest).toHaveBeenCalledWith(AGENT, CONNECTION_ID, expect.any(String), expect.any(String))

    fireEvent.press(getByTestId(cancelButtonId))

    // Local-only cancel: the button comes back, and nothing was ever sent to
    // the counterparty about it (respondToAccessRequest is a DIFFERENT call,
    // never invoked by cancel).
    await waitFor(() => expect(queryByTestId(awaitingRowId)).toBeNull())
    expect(getByTestId(requestButtonId)).toBeTruthy()
    expect(mockRespondToAccessRequest).not.toHaveBeenCalled()
  })

  it('clears the waiting state and shows the decision once it lands for this connection', async () => {
    const { getByTestId, findByTestId, queryByTestId } = render(
      <ApproverContactSection contact={CONTACT} connectionId={CONNECTION_ID} />
    )
    fireEvent.press(getByTestId(requestButtonId))
    await findByTestId(awaitingRowId)

    act(() => {
      approverDecisionEvents.emit('decision', { connectionId: CONNECTION_ID, decision: 'approved' })
    })

    // Names what was actually decided (the resource sent with the request),
    // not just "approved" in the abstract.
    expect((await findByTestId(lastDecisionId)).props.children).toContain("the shared photo album 'Family 2026'")
    expect(queryByTestId(awaitingRowId)).toBeNull()
  })

  it('ignores a decision event for a different connection', async () => {
    const { getByTestId, findByTestId, queryByTestId } = render(
      <ApproverContactSection contact={CONTACT} connectionId={CONNECTION_ID} />
    )
    fireEvent.press(getByTestId(requestButtonId))
    await findByTestId(awaitingRowId)

    act(() => {
      approverDecisionEvents.emit('decision', { connectionId: 'some-other-connection', decision: 'denied' })
    })

    expect(queryByTestId(lastDecisionId)).toBeNull()
    expect(getByTestId(awaitingRowId)).toBeTruthy()
  })

  it('answers a pending request through the modal on this connection', async () => {
    trustTaskPromptStore.setPending(PENDING_PROMPT)
    const { findByTestId } = render(<ApproverContactSection contact={CONTACT} connectionId={CONNECTION_ID} />)

    fireEvent.press(await findByTestId('MockApprove'))

    await waitFor(() => expect(mockRespondToAccessRequest).toHaveBeenCalledWith(AGENT, CONNECTION_ID, 'approved'))
  })
})
