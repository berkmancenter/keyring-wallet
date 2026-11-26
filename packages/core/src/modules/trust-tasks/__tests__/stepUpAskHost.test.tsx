/**
 * The step-up card (#200): the agent's reason is on screen, as it sent it,
 * before any owner check, and the two answers reach the controller.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { vtaAgent } from '../module/vtaAgent'
import { StepUpAskHost } from '../screens/StepUpAskHost'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const controller = vtaAgent as unknown as { set: (s: object) => void }
const REASON = '  Approve disclosing 2 attributes to did:web:shop.example\nfor "checkout"  '

const host = () =>
  render(
    <BasicAppContext>
      <StepUpAskHost />
    </BasicAppContext>
  )

afterEach(() => act(() => controller.set({ stepUpAsk: undefined })))

describe('the step-up card', () => {
  it('shows nothing while the agent asks nothing', () => {
    expect(host().queryByTestId(id('StepUpAsk'))).toBeNull()
  })

  it("shows the agent's reason word for word, and the task", () => {
    act(() =>
      controller.set({
        stepUpAsk: { id: 'ask-1', reason: REASON, taskType: 'https://trusttasks.org/spec/acl/grant/0.1' },
      })
    )
    const tree = host()
    expect(tree.getByTestId(id('StepUpAsk'))).toBeTruthy()
    expect(tree.getByTestId(id('StepUpReason')).props.children).toBe(REASON)
    expect(tree.getByTestId(id('StepUpTask'))).toHaveTextContent(/VtaLink\.StepUpTask/)
  })

  it('passes the answer on for this card', () => {
    const answer = jest.spyOn(vtaAgent, 'answerStepUp').mockImplementation(() => undefined)
    act(() => controller.set({ stepUpAsk: { id: 'ask-2', reason: REASON } }))
    const tree = host()
    expect(tree.queryByTestId(id('StepUpTask'))).toBeNull()
    fireEvent.press(tree.getByTestId(id('StepUpConfirm')))
    fireEvent.press(tree.getByTestId(id('StepUpDecline')))
    expect(answer.mock.calls).toEqual([
      ['ask-2', 'approve'],
      ['ask-2', 'deny'],
    ])
    answer.mockRestore()
  })
})
