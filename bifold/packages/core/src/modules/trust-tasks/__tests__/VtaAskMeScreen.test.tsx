/**
 * "Ask me before…": a switch per task the phone never sends, the rules set
 * elsewhere read-only (flagged when they hold this phone), the test request
 * once the phone holds contexts/create, and what the screen cannot change
 * said plainly.
 */
import { useFocusEffect } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { EMPTY_APPROVALS, approvalsView, withPhoneRule, type ApprovalsModel } from '../module/approvalRules'
import { vtaAgent, type ApprovalRulesState } from '../module/vtaAgent'
import { DeviceActionRefused, OwnerNotConfirmed } from '../module/vtaOwner'
import VtaAskMe from '../screens/VtaAskMe'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const ME = 'did:key:z6MkThisPhone'
const CREATE = 'https://trusttasks.org/spec/vta/contexts/create/1.0'
const SET_WAKE = 'https://trusttasks.org/spec/device/set-wake/0.2'
const id = (key: string) => testIdWithKey(key)

const stateOf = (model: ApprovalsModel, canChange = true): ApprovalRulesState => ({
  model: { ...model, unreadable: false },
  view: approvalsView(model, ME),
  canChange,
})

const show = async () => {
  const tree = render(
    <BasicAppContext>
      <VtaAskMe />
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}

beforeEach(() => {
  jest.restoreAllMocks()
  ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => void) => require('react').useEffect(effect, []))
  ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
})

describe('Ask me before…', () => {
  test('a switch per offered task, off; no test request until contexts/create is on', async () => {
    jest.spyOn(vtaAgent, 'approvalRules').mockResolvedValue(stateOf(EMPTY_APPROVALS))
    const tree = await show()
    const row = tree.getByTestId(id('AskMeSwitch_contextsCreate'))
    expect(row.props.accessibilityRole).toBe('switch')
    expect(row.props.accessibilityState).toMatchObject({ checked: false, disabled: false })
    expect(tree.getByTestId(id('AskMeSwitch_keysRevoke'))).toBeTruthy()
    expect(tree.getByTestId(id('AskMeEnforcement'))).toBeTruthy()
    expect(tree.queryByTestId(id('AskMeTest'))).toBeNull()
  })

  test('switching one on asks the agent, and shows what it now holds', async () => {
    jest.spyOn(vtaAgent, 'approvalRules').mockResolvedValue(stateOf(EMPTY_APPROVALS))
    const on = { ...withPhoneRule(EMPTY_APPROVALS, CREATE, true, ME), version: 1 }
    const set = jest.spyOn(vtaAgent, 'setApprovalRule').mockResolvedValue(stateOf(on))
    const tree = await show()
    // A press on the row, the way a person (and the device check) taps it. On
    // the #285 device check a tap on the bare Switch changed nothing.
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AskMeSwitch_contextsCreate')))
    })
    expect(set).toHaveBeenCalledWith({}, CREATE, true)
    expect(tree.getByTestId(id('AskMeSwitch_contextsCreate')).props.accessibilityState).toMatchObject({ checked: true })
    expect(tree.getByTestId(id('AskMeTest'))).toBeTruthy()
  })

  test('the test request says the agent is asking', async () => {
    const on = { ...withPhoneRule(EMPTY_APPROVALS, CREATE, true, ME), version: 1 }
    jest.spyOn(vtaAgent, 'approvalRules').mockResolvedValue(stateOf(on))
    jest.spyOn(vtaAgent, 'sendTestRequest').mockResolvedValue({ kind: 'held' })
    const tree = await show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AskMeTest')))
    })
    expect(tree.getByTestId(id('AskMeTested'))).toHaveTextContent('AskMe.TestHeld')
  })

  test('a rule set elsewhere on a task this phone sends is listed, flagged', async () => {
    const model = {
      rules: [{ taskType: SET_WAKE, requires: 'consent' as const, approverSet: 'ops' }],
      sets: { ops: ['did:key:z6MkOps'] },
      version: 3,
    }
    jest.spyOn(vtaAgent, 'approvalRules').mockResolvedValue(stateOf(model))
    const tree = await show()
    expect(tree.getByTestId(id('AskMeElsewhere'))).toHaveTextContent(/device\/set-wake\/0\.2/)
    expect(tree.getByTestId(id('AskMeHoldsThisPhone'))).toBeTruthy()
  })

  test('one that may not change the rules is told so, and every switch is still', async () => {
    jest.spyOn(vtaAgent, 'approvalRules').mockResolvedValue(stateOf(EMPTY_APPROVALS, false))
    const tree = await show()
    expect(tree.getByTestId(id('AskMeReadOnly'))).toHaveTextContent('AskMe.OnlyAdmin')
    expect(tree.getByTestId(id('AskMeSwitch_contextsCreate')).props.accessibilityState).toMatchObject({
      disabled: true,
    })
    const set = jest.spyOn(vtaAgent, 'setApprovalRule')
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AskMeSwitch_contextsCreate')))
    })
    expect(set).not.toHaveBeenCalled()
  })

  test('a change the phone cannot confirm says why, and the words stay after the rules are read again', async () => {
    // The #285 device check: an emulator with no screen lock refused the owner
    // check at once, and the screen showed nothing.
    jest.spyOn(vtaAgent, 'approvalRules').mockResolvedValue(stateOf(EMPTY_APPROVALS))
    jest.spyOn(vtaAgent, 'setApprovalRule').mockRejectedValue(new OwnerNotConfirmed('unavailable'))
    const tree = await show()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AskMeSwitch_contextsCreate')))
    })
    expect(vtaAgent.approvalRules).toHaveBeenCalledTimes(2)
    expect(tree.getByTestId(id('AskMeError'))).toHaveTextContent(/CreateAgent\.NeedsScreenLock(Android|Ios)/)
  })

  test('a refusal is worded by reason', async () => {
    jest.spyOn(vtaAgent, 'approvalRules').mockRejectedValue(new DeviceActionRefused('unreachable'))
    const tree = await show()
    expect(tree.getByTestId(id('AskMeError'))).toHaveTextContent('CreateAgent.Device.unreachable')
  })
})
