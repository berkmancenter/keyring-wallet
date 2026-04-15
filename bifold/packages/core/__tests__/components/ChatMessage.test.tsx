import { render, fireEvent, waitFor } from '@testing-library/react-native'
import React from 'react'
import { MessageProps } from 'react-native-gifted-chat'

import { ChatMessage, CallbackType, ExtendedChatMessage, MessageIconType } from '../../src/components/chat/ChatMessage'
import { Role } from '../../src/types/chat'

const onDetailsMock = jest.fn()
const user = {
  _id: Role.me,
}
const currentMessage: ExtendedChatMessage = {
  _id: '1',
  user,
  messageOpensCallbackType: CallbackType.CredentialOffer,
  onDetails: onDetailsMock,
  renderEvent: jest.fn(),
  text: 'test',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
}
const props: MessageProps<ExtendedChatMessage> = {
  user,
  currentMessage: currentMessage,
  key: '1',
  position: 'left',
}

describe('ChatMessage', () => {
  // Set timezone to UTC for consistent date formatting across environments
  const originalTZ = process.env.TZ

  beforeAll(() => {
    process.env.TZ = 'UTC'
  })

  afterAll(() => {
    process.env.TZ = originalTZ
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('Credential offer renders correctly', () => {
    props.currentMessage!.messageOpensCallbackType = CallbackType.CredentialOffer
    const tree = render(<ChatMessage messageProps={props} />)

    // The new UI shows inline "View offer" link for credential offers
    // The link is rendered directly without expand/collapse for offers
    expect(tree).toMatchSnapshot()
  })

  test('Proof request renders correctly', () => {
    props.currentMessage!.messageOpensCallbackType = CallbackType.ProofRequest
    const tree = render(<ChatMessage messageProps={props} />)

    // The new UI uses expand/collapse for proof requests
    expect(tree).toMatchSnapshot()
  })

  test('Sent presentation renders correctly', () => {
    props.currentMessage!.messageOpensCallbackType = CallbackType.PresentationSent
    const tree = render(<ChatMessage messageProps={props} />)

    // The new UI uses expand/collapse for presentations
    expect(tree).toMatchSnapshot()
  })

  test('Reporting DID renders correctly', () => {
    const reportingMessage: ExtendedChatMessage = {
      _id: 'reporting-1',
      user,
      messageOpensCallbackType: undefined,
      iconType: MessageIconType.ReportingDID,
      onDetails: onDetailsMock,
      renderEvent: jest.fn(),
      text: 'Your Reporting DID',
      // collapsedContent shows the bold title + live status badge (collapsed view)
      collapsedContent: jest.fn(),
      // relationshipDid carries the actual DID value for the expanded view
      relationshipDid: 'did:peer:0zAbc123TestReportingDid',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    }
    const reportingProps: MessageProps<ExtendedChatMessage> = {
      user,
      currentMessage: reportingMessage,
      key: 'reporting-1',
      position: 'left',
    }
    const tree = render(<ChatMessage messageProps={reportingProps} />)

    // Reporting DID uses expand/collapse like RelationshipDID
    expect(tree).toMatchSnapshot()
  })
})

describe('CredentialOfferActions - Decline Flow', () => {
  const originalTZ = process.env.TZ
  const CONFIRM_DECLINE_ID = 'com.ariesbifold:id/ConfirmDeclineButton'
  const CANCEL_DECLINE_ID = 'com.ariesbifold:id/CancelDeclineButton'

  beforeAll(() => {
    process.env.TZ = 'UTC'
  })

  afterAll(() => {
    process.env.TZ = originalTZ
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  const makeCredOfferMessage = (overrides: Partial<ExtendedChatMessage> = {}): ExtendedChatMessage => ({
    _id: 'offer-1',
    user: { _id: Role.them },
    messageOpensCallbackType: CallbackType.CredentialOffer,
    iconType: MessageIconType.Credential,
    onDetails: jest.fn(),
    onDecline: jest.fn(),
    renderEvent: () => null as unknown as JSX.Element,
    text: 'offered you a credential',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  })

  test('YES button calls onDetails', () => {
    const message = makeCredOfferMessage()
    const messageProps: MessageProps<ExtendedChatMessage> = {
      user: { _id: Role.them },
      currentMessage: message,
      key: 'offer-1',
      position: 'left',
    }

    const { getByText } = render(<ChatMessage messageProps={messageProps} />)
    fireEvent.press(getByText('YES'))

    expect(message.onDetails).toHaveBeenCalledTimes(1)
    expect(message.onDecline).not.toHaveBeenCalled()
  })

  test('NO button opens the decline confirmation modal', () => {
    const message = makeCredOfferMessage()
    const messageProps: MessageProps<ExtendedChatMessage> = {
      user: { _id: Role.them },
      currentMessage: message,
      key: 'offer-1',
      position: 'left',
    }

    const { getByText, queryByTestId } = render(<ChatMessage messageProps={messageProps} />)

    fireEvent.press(getByText('NO'))

    expect(queryByTestId(CONFIRM_DECLINE_ID)).not.toBeNull()
    expect(message.onDecline).not.toHaveBeenCalled()
  })

  test('Confirming decline in modal calls onDecline', async () => {
    const message = makeCredOfferMessage()
    const messageProps: MessageProps<ExtendedChatMessage> = {
      user: { _id: Role.them },
      currentMessage: message,
      key: 'offer-1',
      position: 'left',
    }

    const { getByText, getByTestId } = render(<ChatMessage messageProps={messageProps} />)

    fireEvent.press(getByText('NO'))

    const confirmButton = getByTestId(CONFIRM_DECLINE_ID)
    fireEvent.press(confirmButton)

    await waitFor(() => {
      expect(message.onDecline).toHaveBeenCalledTimes(1)
    })
  })

  test('Canceling decline modal does not call onDecline', () => {
    const message = makeCredOfferMessage()
    const messageProps: MessageProps<ExtendedChatMessage> = {
      user: { _id: Role.them },
      currentMessage: message,
      key: 'offer-1',
      position: 'left',
    }

    const { getByText, getByTestId } = render(<ChatMessage messageProps={messageProps} />)

    fireEvent.press(getByText('NO'))

    const cancelButton = getByTestId(CANCEL_DECLINE_ID)
    fireEvent.press(cancelButton)

    expect(message.onDecline).not.toHaveBeenCalled()
  })

  test('No decline actions when onDetails is missing', () => {
    const message = makeCredOfferMessage({ onDetails: undefined })
    const messageProps: MessageProps<ExtendedChatMessage> = {
      user: { _id: Role.them },
      currentMessage: message,
      key: 'offer-1',
      position: 'left',
    }

    const { queryByText } = render(<ChatMessage messageProps={messageProps} />)

    expect(queryByText('YES')).toBeNull()
    expect(queryByText('NO')).toBeNull()
  })

  test('No YES/NO buttons for non-CredentialOffer types', () => {
    const message = makeCredOfferMessage({
      messageOpensCallbackType: CallbackType.ProofRequest,
      iconType: MessageIconType.Proof,
    })
    const messageProps: MessageProps<ExtendedChatMessage> = {
      user: { _id: Role.them },
      currentMessage: message,
      key: 'offer-1',
      position: 'left',
    }

    const { queryByText } = render(<ChatMessage messageProps={messageProps} />)

    expect(queryByText('YES')).toBeNull()
    expect(queryByText('NO')).toBeNull()
  })
})
