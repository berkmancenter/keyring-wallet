/**
 * Agent connect, the first half of the connect flow as views (plan §6; canvas frames 1, 1b, 2, 3, 4, 18, K23): the
 * name step and the guard before it, the scan step with its paste path, the number entry, and how a connect ends.
 * Views only: the routes and the pairing hooks are wired in a later PR.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { AccessibilityInfo, Text } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import { testIdWithKey } from '../../../utils/testable'
import { PickerMemory } from '../components/MemoryPicker'
import { CONNECT_END_KEY, ConnectEnd } from '../failureCopy'
import { MATCH_NUMBER_DIGITS } from '../pairing'
import ConnectAgentForm, { ConnectGuard } from '../screens/ConnectAgentForm'
import ConnectFailureView from '../screens/ConnectFailureView'
import ConnectNumberView from '../screens/ConnectNumberView'
import ConnectScanView from '../screens/ConnectScanView'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)
const EN = (en as unknown as { ConnectedAgents: Record<string, string> }).ConnectedAgents

const MEMORIES: PickerMemory[] = [
  { id: 'keyring-memory-aaaa', name: 'Education', containsOthers: false },
  { id: 'keyring-memory-bbbb', name: 'Work', containsOthers: true },
]

describe('ConnectAgentForm', () => {
  const form = (over: Partial<React.ComponentProps<typeof ConnectAgentForm>> = {}) => {
    const props = {
      guard: 'ok' as ConnectGuard,
      memories: MEMORIES,
      onCreateMemory: jest.fn(),
      onContinue: jest.fn(),
      onClose: jest.fn(),
      ...over,
    }
    return { props, tree: show(<ConnectAgentForm {...props} />) }
  }
  const continueButton = (tree: ReturnType<typeof show>) => tree.getByTestId(id('ConnectAgentContinue'))

  it('waits for the guard before showing anything to fill in', () => {
    const { tree } = form({ guard: 'checking' })
    expect(tree.getByTestId(id('ConnectAgentChecking'))).toBeTruthy()
    expect(tree.queryByTestId(id('ConnectAgentName'))).toBeNull()
  })

  it.each([
    ['notAdministrator', 'ConnectedAgents.NotAnAdministrator'],
    ['vtaTooOld', 'ConnectedAgents.VtaTooOld'],
    ['unreachable', 'ConnectedAgents.FailUnreachable'],
  ] as const)('ends the connect for %s: its line and Close, no name, no picker, no "New memory"', (guard, words) => {
    const { props, tree } = form({ guard })
    expect(tree.getByText(words)).toBeTruthy()
    expect(tree.queryByTestId(id('ConnectAgentName'))).toBeNull()
    expect(tree.queryByTestId(id('MemoryPicker'))).toBeNull()
    expect(tree.queryByTestId(id('MemoryPickerNew'))).toBeNull()
    fireEvent.press(tree.getByTestId(id('ConnectFailureClose')))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the §6 name step: the picker, both purposes shown not picked, 4 hours with no choice, the helpers', () => {
    const { tree } = form()
    for (const key of [
      'NameThisAgent',
      'MemoryItCanUse',
      'NameHelper',
      'PurposesTitle',
      'PurposePersonalisation',
      'PurposeTaskExecution',
      'ForFourHours',
      'ForFourHoursHelper',
      'TerminalHelper',
    ]) {
      expect([key, tree.queryAllByText(`ConnectedAgents.${key}`).length]).toEqual([key, 1])
    }
    expect(tree.getByTestId(id('MemoryPicker'))).toBeTruthy()
    // The purposes are not checkboxes: nothing on this step picks them.
    expect(tree.getAllByTestId(id('MemoryPickerRow'))).toHaveLength(MEMORIES.length)
  })

  it('holds "Continue" until there is a name, then hands on the name, the memories picked and both purposes', () => {
    const { props, tree } = form()
    expect(continueButton(tree).props.accessibilityState.disabled).toBe(true)
    fireEvent.changeText(tree.getByTestId(id('ConnectAgentName')), '   ')
    expect(continueButton(tree).props.accessibilityState.disabled).toBe(true)
    fireEvent.changeText(tree.getByTestId(id('ConnectAgentName')), '  Notes helper ')
    fireEvent.press(tree.getAllByTestId(id('MemoryPickerRow'))[0])
    fireEvent.press(continueButton(tree))
    expect(props.onContinue).toHaveBeenCalledWith({
      name: 'Notes helper',
      memoryContexts: ['keyring-memory-aaaa'],
      purposes: ['personalisation', 'taskExecution'],
    })
  })

  it('lets an agent go on with no memory picked (§6: nothing selected is allowed)', () => {
    const { props, tree } = form()
    fireEvent.changeText(tree.getByTestId(id('ConnectAgentName')), 'Notes helper')
    fireEvent.press(continueButton(tree))
    expect(props.onContinue).toHaveBeenCalledWith(expect.objectContaining({ memoryContexts: [] }))
  })

  it('holds "Continue" while the memories are listed and while a new memory is being named', () => {
    const loading = form({ memories: undefined }).tree
    fireEvent.changeText(loading.getByTestId(id('ConnectAgentName')), 'Notes helper')
    expect(loading.getByTestId(id('ConnectAgentMemoriesLoading'))).toBeTruthy()
    expect(continueButton(loading).props.accessibilityState.disabled).toBe(true)

    const { tree } = form()
    fireEvent.changeText(tree.getByTestId(id('ConnectAgentName')), 'Notes helper')
    expect(continueButton(tree).props.accessibilityState.disabled).toBe(false)
    fireEvent.press(tree.getByTestId(id('MemoryPickerNew')))
    expect(continueButton(tree).props.accessibilityState.disabled).toBe(true)
    // Control: closing the field frees it again.
    fireEvent.press(tree.getByTestId(id('MemoryPickerNew')))
    expect(continueButton(tree).props.accessibilityState.disabled).toBe(false)
  })
})

describe('ConnectScanView', () => {
  it('shows the camera and "Scan the code in your terminal"', () => {
    const tree = show(<ConnectScanView camera={<Text>camera here</Text>} onLink={jest.fn()} />)
    expect(tree.getByText('ConnectedAgents.ScanTitle')).toBeTruthy()
    expect(tree.getByText('camera here')).toBeTruthy()
  })

  it('takes a pasted link instead, sent where a scanned one goes', () => {
    const onLink = jest.fn()
    const tree = show(<ConnectScanView camera={<Text>camera here</Text>} onLink={onLink} />)
    fireEvent.press(tree.getByTestId(id('ConnectScanPaste')))
    expect(tree.queryByText('camera here')).toBeNull()
    const go = () => tree.getByTestId(id('ConnectScanLinkContinue'))
    expect(go().props.accessibilityState.disabled).toBe(true)
    fireEvent.changeText(tree.getByTestId(id('ConnectScanLink')), '  https://example.org/agent-connect?_oob=abc  ')
    fireEvent.press(go())
    expect(onLink).toHaveBeenCalledWith('https://example.org/agent-connect?_oob=abc')
  })
})

describe('ConnectNumberView', () => {
  const field = (tree: ReturnType<typeof show>) => tree.getByTestId(id('ConnectNumberField'))
  const go = (tree: ReturnType<typeof show>) => tree.getByTestId(id('ConnectNumberContinue'))

  it('draws one cell per digit of the one constant, and the two-digit words while it is two', () => {
    expect(MATCH_NUMBER_DIGITS).toBe(2)
    const tree = show(<ConnectNumberView onSubmit={jest.fn()} onCancel={jest.fn()} />)
    expect(tree.getAllByTestId(id('ConnectNumberCell'), { includeHiddenElements: true })).toHaveLength(
      MATCH_NUMBER_DIGITS
    )
    expect(tree.getByText('ConnectedAgents.NumberBodyTwoDigits')).toBeTruthy()
    expect(field(tree).props.accessibilityLabel).toBe('ConnectedAgents.NumberFieldLabel')
    expect(field(tree).props.keyboardType).toBe('number-pad')
    // Control: four cells take the four-digit words.
    const four = show(<ConnectNumberView onSubmit={jest.fn()} onCancel={jest.fn()} cells={4} />)
    expect(four.getAllByTestId(id('ConnectNumberCell'), { includeHiddenElements: true })).toHaveLength(4)
    expect(four.getByText('ConnectedAgents.NumberBodyFourDigits')).toBeTruthy()
  })

  it('keeps digits only, announces each as it is typed, and holds "Continue" until every cell is filled', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility')
    const tree = show(<ConnectNumberView onSubmit={jest.fn()} onCancel={jest.fn()} />)
    fireEvent.changeText(field(tree), '4a')
    expect(field(tree).props.value).toBe('4')
    expect(announce).toHaveBeenLastCalledWith('ConnectedAgents.NumberDigitFilled')
    expect(go(tree).props.accessibilityState.disabled).toBe(true)
    fireEvent.changeText(field(tree), '47')
    expect(announce).toHaveBeenCalledTimes(2)
    expect(go(tree).props.accessibilityState.disabled).toBe(false)
    announce.mockRestore()
  })

  it('sends the number once: one try', () => {
    const onSubmit = jest.fn()
    const tree = show(<ConnectNumberView onSubmit={onSubmit} onCancel={jest.fn()} />)
    fireEvent.changeText(field(tree), '47')
    fireEvent.press(go(tree))
    fireEvent.press(go(tree))
    // The keyboard's own submit is a second way in, and the button being disabled does not guard it.
    fireEvent(field(tree), 'submitEditing')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('47')
    expect(field(tree).props.editable).toBe(false)
  })

  it('cancels', () => {
    const onCancel = jest.fn()
    const tree = show(<ConnectNumberView onSubmit={jest.fn()} onCancel={onCancel} />)
    fireEvent.press(tree.getByTestId(id('ConnectNumberCancel')))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('ConnectFailureView', () => {
  it('has words for every way a connect can end', () => {
    for (const [end, key] of Object.entries(CONNECT_END_KEY)) {
      const name = key.replace('ConnectedAgents.', '')
      const present = name in EN || `${name}_other` in EN
      expect([end, present]).toEqual([end, true])
    }
  })

  it.each(Object.keys(CONNECT_END_KEY) as ConnectEnd[])('says %s and offers only Close', async (end) => {
    const onClose = jest.fn()
    const tree = show(<ConnectFailureView end={end} minutesLeft={3} onClose={onClose} />)
    await waitFor(() => expect(tree.getByText(CONNECT_END_KEY[end])).toBeTruthy())
    expect(tree.getAllByRole('button')).toHaveLength(1)
    fireEvent.press(tree.getByTestId(id('ConnectFailureClose')))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the wrong digits in their cells under the notice', () => {
    const tree = show(
      <ConnectFailureView end="wrong-number" typed="47" cells={MATCH_NUMBER_DIGITS} onClose={jest.fn()} />
    )
    expect(tree.getByText('ConnectedAgents.FailWrongNumber')).toBeTruthy()
    expect(tree.getAllByTestId(id('ConnectNumberCell'), { includeHiddenElements: true })).toHaveLength(2)
    expect(tree.getByText('4', { includeHiddenElements: true })).toBeTruthy()
    expect(tree.getByText('7', { includeHiddenElements: true })).toBeTruthy()
    // Control: another end draws no cells.
    const expired = show(<ConnectFailureView end="expired" typed="47" cells={2} onClose={jest.fn()} />)
    expect(expired.queryAllByTestId(id('ConnectNumberCell'), { includeHiddenElements: true })).toHaveLength(0)
  })
})
