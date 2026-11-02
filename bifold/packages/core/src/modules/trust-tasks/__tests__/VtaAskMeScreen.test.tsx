/**
 * "Ask me before…": a switch per task the phone never sends, the rules set
 * elsewhere read-only (flagged when they hold this phone), the test request
 * once the phone holds contexts/create, and what the screen cannot change
 * said plainly.
 */
import { useFocusEffect } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { Platform } from 'react-native'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { fakeAgent } from '../../../../__tests__/helpers/cardVault'
import { testIdWithKey } from '../../../utils/testable'
import { EMPTY_APPROVALS, approvalsView, withPhoneRule, type ApprovalsModel } from '../module/approvalRules'
import { vtaAgent, type ApprovalRulesState } from '../module/vtaAgent'
import { GenericRecordsTestRequestStore } from '../module/testRequestOutcome'
import { DeviceActionRefused, OwnerNotConfirmed } from '../module/vtaOwner'
import VtaAskMe from '../screens/VtaAskMe'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const ME = 'did:key:z6MkThisPhone'
const CREATE = 'https://trusttasks.org/spec/vta/contexts/create/1.0'
const SET_WAKE = 'https://trusttasks.org/spec/device/set-wake/0.2'
const DELETE_10 = 'https://trusttasks.org/spec/vta/contexts/delete/1.0'
const DELETE_11 = 'https://trusttasks.org/spec/vta/contexts/delete/1.1'
const id = (key: string) => testIdWithKey(key)

const stateOf = (model: ApprovalsModel, canChange = true, served?: string[]): ApprovalRulesState => ({
  model: { ...model, unreadable: false },
  view: approvalsView(model, ME, served),
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

  test('a rule only on a version the updated agent no longer serves reads off, with "turn it on again"', async () => {
    const old = { ...withPhoneRule(EMPTY_APPROVALS, DELETE_11, true, ME, [DELETE_10]), version: 1 }
    jest.spyOn(vtaAgent, 'approvalRules').mockResolvedValue(stateOf(old, true, [DELETE_11]))
    const renewed = { ...withPhoneRule(old, DELETE_11, true, ME, [DELETE_11]), version: 2 }
    const set = jest.spyOn(vtaAgent, 'setApprovalRule').mockResolvedValue(stateOf(renewed, true, [DELETE_11]))
    const tree = await show()
    expect(tree.getByTestId(id('AskMeSwitch_contextsDelete')).props.accessibilityState).toMatchObject({
      checked: false,
    })
    expect(tree.getByTestId(id('AskMeTurnOnAgain_contextsDelete'))).toBeTruthy()

    await act(async () => {
      fireEvent.press(tree.getByTestId(id('AskMeSwitch_contextsDelete')))
    })
    expect(set).toHaveBeenCalledWith({}, DELETE_11, true)
    expect(tree.getByTestId(id('AskMeSwitch_contextsDelete')).props.accessibilityState).toMatchObject({ checked: true })
    expect(tree.queryByTestId(id('AskMeTurnOnAgain_contextsDelete'))).toBeNull()
  })

  // IN-309: the test request is made while Keyring is open, so its
  // notification arrives then. iOS shows it as a banner now; Android does not
  // yet show a notification while the app is open, so it is not promised there.
  describe('what the test request says about notifications', () => {
    const real = Platform.OS
    afterEach(() => {
      Platform.OS = real
    })
    const withTest = async () => {
      const on = { ...withPhoneRule(EMPTY_APPROVALS, CREATE, true, ME), version: 1 }
      jest.spyOn(vtaAgent, 'approvalRules').mockResolvedValue(stateOf(on))
      return show()
    }

    test('on iOS: a notification even with Keyring open, and real requests when it is closed', async () => {
      Platform.OS = 'ios'
      const tree = await withTest()
      expect(tree.getByTestId(id('AskMeTestHintOpen'))).toHaveTextContent('AskMe.TestHintOpen')
      expect(tree.getByTestId(id('AskMeTestHintClosed'))).toHaveTextContent('AskMe.TestHintClosed')
    })

    test('on Android: nothing promised about notifications, open or closed', async () => {
      Platform.OS = 'android'
      const tree = await withTest()
      expect(tree.getByTestId(id('AskMeTest'))).toBeTruthy()
      expect(tree.queryByTestId(id('AskMeTestHintOpen'))).toBeNull()
      expect(tree.queryByTestId(id('AskMeTestHintClosed'))).toBeNull()
    })
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

  test('a kept outcome that never said whether the context was deleted claims neither', async () => {
    await agent.genericRecords.save({
      content: { vtaDid: AGENT, kind: 'letThrough', at: '2026-10-20T00:00:00Z' },
      tags: { recordType: 'keyring.vta-test-request', vtaDid: AGENT },
    } as never)
    const tree = await show()
    const card = tree.getByTestId(id('AskMeLetThroughCard'))
    expect(card).toHaveTextContent(/AskMe\.LetThroughBody/)
    expect(card).not.toHaveTextContent(/AskMe\.TestLetThrough/)
  })

  test('an outcome the phone could not keep, or a dismissal, is logged', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(vtaAgent, 'sendTestRequest').mockResolvedValue({ kind: 'letThrough', cleanedUp: true })
    jest.spyOn(GenericRecordsTestRequestStore.prototype, 'set').mockRejectedValue(new Error('store closed'))
    jest.spyOn(GenericRecordsTestRequestStore.prototype, 'dismiss').mockRejectedValue(new Error('store closed'))
    const tree = await show()
    await press(tree)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/test request: outcome not kept .*store closed/))
    await act(async () => fireEvent.press(tree.getByTestId(id('AskMeLetThroughDismiss'))))
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/test request: dismissal not kept .*store closed/))
    warn.mockRestore()
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

  // IN-309 with #445: the notification hint sits beside "your agent didn't
  // ask", so it promises a notification only for a request the agent asks about.
  test('after a let-through, the notification hint still holds: it promises one only when the agent asks', async () => {
    const real = Platform.OS
    Platform.OS = 'ios'
    try {
      jest.spyOn(vtaAgent, 'sendTestRequest').mockResolvedValue({ kind: 'letThrough', cleanedUp: true })
      const tree = await show()
      await press(tree)
      expect(tree.getByTestId(id('AskMeLastLetThrough'))).toHaveTextContent('AskMe.LastTestLetThrough')
      expect(tree.getByTestId(id('AskMeTestHintOpen'))).toHaveTextContent('AskMe.TestHintOpen')
    } finally {
      Platform.OS = real
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const copies = ['en/en.json', 'fr/fr.json', 'pt-br/pt-br.json'].map(
      (f) => require(`../../../localization/${f}`).AskMe
    )
    const [en, fr, ptBr] = copies.map((c) => c.TestHintOpen as string)
    expect(en).toMatch(/^When your agent asks you, /)
    expect(fr).toMatch(/^Quand votre agent vous demande, /)
    expect(ptBr).toMatch(/^Quando o seu agente perguntar, /)
  })

  // The agent may let the request through and create the context (#445), so
  // the hint before pressing never promises that nothing is created.
  test('the hint says the agent should ask, never that nothing is created', () => {
    const files = { en: 'en/en.json', fr: 'fr/fr.json', ptBr: 'pt-br/pt-br.json' }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const hint = (f: string) => require(`../../../localization/${f}`).AskMe.TestHint as string
    expect(hint(files.en)).toMatch(/should ask you first/)
    expect(hint(files.fr)).toMatch(/devrait vous demander d'abord/)
    expect(hint(files.ptBr)).toMatch(/deveria perguntar a você primeiro/)
    expect(hint(files.en)).not.toMatch(/nothing is created/i)
    expect(hint(files.fr)).not.toMatch(/rien n'est créé/i)
    expect(hint(files.ptBr)).not.toMatch(/nada é criado/i)
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
