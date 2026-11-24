/**
 * "Is this you?" in the asker's chat: shown for a prompt waiting on that connection only, naming both contacts, and
 * gone once it is answered here or in the prompt.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { useAgent } from '@bifold/react-hooks'

import ContinuityRequestCard from '../../../src/modules/vrc/components/ContinuityRequestCard'
import { continuityPromptStore, resetContinuityLimits } from '../../../src/modules/vrc/contacts/continuity'
import { testIdWithKey } from '../../../src/utils/testable'

jest.mock('@bifold/react-hooks')
const mockRespond = jest.fn(async (..._args: unknown[]) => undefined)
jest.mock('../../../src/modules/vrc/contacts/continuity', () => ({
  ...jest.requireActual('../../../src/modules/vrc/contacts/continuity'),
  respondToContinuityPrompt: (...args: unknown[]) => mockRespond(...args),
}))
jest.mock('react-i18next', () => {
  const shared = jest.requireActual('../../../__mocks__/react-i18next')
  const t = (key: string, options?: Record<string, unknown>) =>
    options && 'asker' in options ? `${key} (${options.asker} / ${options.earlier})` : key
  return {
    ...shared,
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: async () => undefined, t } }),
  }
})

const mockUseAgent = useAgent as jest.MockedFunction<typeof useAgent>
const agent = { config: { logger: { warn: jest.fn() } } }
const promptOn = (connectionId: string, receivedAt = new Date().toISOString()) => ({
  connectionId,
  asker: 'Bob Jones',
  earlier: 'Bob J.',
  request: {},
  challenge: 'abc',
  receivedAt,
})
const card = testIdWithKey('ContinuityRequestCard')

describe('ContinuityRequestCard', () => {
  beforeEach(() => {
    resetContinuityLimits()
    mockRespond.mockClear()
    mockUseAgent.mockReturnValue({ agent } as any)
  })

  test("a prompt on this chat's connection shows here, naming who asks and the earlier contact", () => {
    const tree = render(<ContinuityRequestCard connectionId="conn-new" />)
    expect(tree.queryByTestId(card)).toBeNull()
    act(() => continuityPromptStore.set(promptOn('conn-new')))
    expect(tree.getByTestId(card)).toBeTruthy()
    expect(tree.getByText('Relationship.ContinuityBody (Bob Jones / Bob J.)')).toBeTruthy()
  })

  test("a prompt on another connection does not show in this chat (it shows in that one's)", () => {
    const other = render(<ContinuityRequestCard connectionId="conn-other" />)
    const mine = render(<ContinuityRequestCard connectionId="conn-new" />)
    act(() => continuityPromptStore.set(promptOn('conn-new')))
    expect(mine.getByTestId(card)).toBeTruthy()
    expect(other.queryByTestId(card)).toBeNull()
  })

  test('Confirm answers yes for this connection, once: a second press while it is answering is ignored', () => {
    const tree = render(<ContinuityRequestCard connectionId="conn-new" />)
    act(() => continuityPromptStore.set(promptOn('conn-new')))
    fireEvent.press(tree.getByTestId(testIdWithKey('ContinuityRequestConfirm')))
    fireEvent.press(tree.getByTestId(testIdWithKey('ContinuityRequestNotNow')))
    expect(mockRespond).toHaveBeenCalledTimes(1)
    expect(mockRespond).toHaveBeenCalledWith(agent, 'conn-new', true)
  })

  test('Not now answers no for this connection', () => {
    const tree = render(<ContinuityRequestCard connectionId="conn-new" />)
    act(() => continuityPromptStore.set(promptOn('conn-new')))
    fireEvent.press(tree.getByTestId(testIdWithKey('ContinuityRequestNotNow')))
    expect(mockRespond).toHaveBeenCalledWith(agent, 'conn-new', false)
  })

  test('answered elsewhere (the prompt), it leaves the chat', () => {
    const tree = render(<ContinuityRequestCard connectionId="conn-new" />)
    act(() => continuityPromptStore.set(promptOn('conn-new')))
    expect(tree.getByTestId(card)).toBeTruthy()
    act(() => {
      continuityPromptStore.take('conn-new')
    })
    expect(tree.queryByTestId(card)).toBeNull()
  })

  test('a prompt older than the asker waits for is not shown', () => {
    const tree = render(<ContinuityRequestCard connectionId="conn-new" />)
    act(() => continuityPromptStore.set(promptOn('conn-new', new Date(Date.now() - 25 * 3600 * 1000).toISOString())))
    expect(tree.queryByTestId(card)).toBeNull()
  })
})
