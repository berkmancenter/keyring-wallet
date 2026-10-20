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
import { fakeAgent } from '../../../../__tests__/helpers/cardVault'
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

// IN-277: the sign-in reporter twice concluded "no notifications" after a
// test the agent let through: nothing reaches the phone then, and the one
// line on screen was gone by the time they looked. The outcome is kept, and
// says what the agent did, never why.
describe('a test request the agent let through', () => {
  type Setter = { set(next: Record<string, unknown>): void }
  const AGENT = 'did:webvh:QmAgent:vta.example:me'
  const on = () => ({ ...withPhoneRule(EMPTY_APPROVALS, CREATE, true, ME), version: 1 })
  const linked = () =>
    (vtaAgent as unknown as Setter).set({
      link: {
        kind: 'linked',
        vtaDid: AGENT,
        label: 'me',
        linkedAt: '2026-10-20T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
  const press = async (tree: Awaited<ReturnType<typeof show>>) =>
    act(async () => {
      fireEvent.press(tree.getByTestId(id('AskMeTest')))
    })

  let agent: ReturnType<typeof fakeAgent>['agent']
  beforeEach(() => {
    agent = fakeAgent().agent
    ;(useAgent as jest.Mock).mockReturnValue({ agent })
    linked()
    jest.spyOn(vtaAgent, 'approvalRules').mockResolvedValue(stateOf(on()))
  })
  afterEach(() => (vtaAgent as unknown as Setter).set({ link: { kind: 'notLinked' } }))

  test('before any test: no card, and nothing said beside the button', async () => {
    const tree = await show()
    expect(tree.queryByTestId(id('AskMeLetThroughCard'))).toBeNull()
    expect(tree.queryByTestId(id('AskMeLastLetThrough'))).toBeNull()
  })

  test('says so in a card that is still there after leaving and coming back', async () => {
    jest.spyOn(vtaAgent, 'sendTestRequest').mockResolvedValue({ kind: 'letThrough', cleanedUp: true })
    const first = await show()
    await press(first)
    const card = first.getByTestId(id('AskMeLetThroughCard'))
    expect(card).toHaveTextContent(/AskMe\.LetThroughTitle/)
    expect(card).toHaveTextContent(/AskMe\.LetThroughBody/)
    expect(card).toHaveTextContent(/AskMe\.TestLetThrough(?!Kept)/)
    first.unmount()
    const again = await show()
    expect(again.getByTestId(id('AskMeLetThroughCard'))).toBeTruthy()
    expect(again.getByTestId(id('AskMeLastLetThrough'))).toHaveTextContent('AskMe.LastTestLetThrough')
  })

  test('says when the test context could not be deleted', async () => {
    jest.spyOn(vtaAgent, 'sendTestRequest').mockResolvedValue({ kind: 'letThrough', cleanedUp: false })
    const tree = await show()
    await press(tree)
    expect(tree.getByTestId(id('AskMeLetThroughCard'))).toHaveTextContent(/AskMe\.TestLetThroughKept/)
  })

  test('dismissed, the card goes and stays gone; the line beside the button still says it', async () => {
    jest.spyOn(vtaAgent, 'sendTestRequest').mockResolvedValue({ kind: 'letThrough', cleanedUp: true })
    const first = await show()
    await press(first)
    await act(async () => fireEvent.press(first.getByTestId(id('AskMeLetThroughDismiss'))))
    expect(first.queryByTestId(id('AskMeLetThroughCard'))).toBeNull()
    expect(first.getByTestId(id('AskMeLastLetThrough'))).toBeTruthy()
    first.unmount()
    const again = await show()
    expect(again.queryByTestId(id('AskMeLetThroughCard'))).toBeNull()
    expect(again.getByTestId(id('AskMeLastLetThrough'))).toBeTruthy()
  })

  test('the next test replaces it: asked this time, no card and no line', async () => {
    const send = jest.spyOn(vtaAgent, 'sendTestRequest').mockResolvedValue({ kind: 'letThrough', cleanedUp: true })
    const tree = await show()
    await press(tree)
    send.mockResolvedValue({ kind: 'held' })
    await press(tree)
    expect(tree.queryByTestId(id('AskMeLetThroughCard'))).toBeNull()
    expect(tree.queryByTestId(id('AskMeLastLetThrough'))).toBeNull()
    expect(tree.getByTestId(id('AskMeTested'))).toHaveTextContent('AskMe.TestHeld')
  })

  test('the words say what the agent did, never why', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    for (const copy of [require('../../../localization/en/en.json').AskMe]) {
      for (const key of [
        'LetThroughTitle',
        'LetThroughBody',
        'LastTestLetThrough',
        'TestLetThrough',
        'TestLetThroughKept',
      ]) {
        expect(copy[key]).not.toMatch(/aren't switched on|is off|isn't on|not enforced/i)
      }
    }
  })
})
