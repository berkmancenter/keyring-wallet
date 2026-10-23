/**
 * "Is this you?": shown for a continuity prompt only, naming both contacts; Confirm and Not now answer it.
 */
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { useAgent } from '@bifold/react-hooks'
import { act } from '@testing-library/react-native'

import ContinuityCheckModal from '../../../src/modules/vrc/components/ContinuityCheckModal'
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
const prompt = { connectionId: 'conn-new', asker: 'Bob Jones', earlier: 'Bob J.', request: {}, challenge: 'abc' }

describe('ContinuityCheckModal', () => {
  beforeEach(() => {
    resetContinuityLimits()
    mockRespond.mockClear()
    mockUseAgent.mockReturnValue({ agent } as any)
  })

  test('nothing without a prompt', () => {
    const tree = render(<ContinuityCheckModal />)
    expect(tree.queryByTestId(testIdWithKey('ContinuityCheck'))).toBeNull()
  })

  test('a prompt names who asks and which earlier contact it is about; Confirm answers yes', async () => {
    const tree = render(<ContinuityCheckModal />)
    act(() => continuityPromptStore.set(prompt))
    expect(tree.getByTestId(testIdWithKey('ContinuityCheckBody')).props.children).toBe(
      'Relationship.ContinuityBody (Bob Jones / Bob J.)'
    )
    fireEvent.press(tree.getByTestId(testIdWithKey('ContinuityConfirm')))
    expect(mockRespond).toHaveBeenCalledWith(agent, 'conn-new', true)
  })

  test('Not now answers no', async () => {
    const tree = render(<ContinuityCheckModal />)
    act(() => continuityPromptStore.set(prompt))
    fireEvent.press(tree.getByTestId(testIdWithKey('ContinuityNotNow')))
    expect(mockRespond).toHaveBeenCalledWith(agent, 'conn-new', false)
  })
})
