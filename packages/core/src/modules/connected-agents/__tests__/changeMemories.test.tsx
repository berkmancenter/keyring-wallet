/**
 * Agent connect, "Change memories" as a view (plan §6; §3.15 step 4, D34; canvas frames K20 and K20b) in its P0
 * no-room form: ticking a memory asks first and takes the phone's face or fingerprint check; unticking asks once;
 * nothing changes until the person answers. A view only: nothing reaches it yet.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { PickerMemory } from '../components/MemoryPicker'
import ChangeMemoriesView, { ChangeMemoriesViewProps } from '../screens/ChangeMemoriesView'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)

const MEMORIES: PickerMemory[] = [
  { id: 'keyring-memory-aaaa', name: 'Education', containsOthers: false },
  { id: 'keyring-memory-bbbb', name: 'Healthcare', containsOthers: false },
  { id: 'keyring-memory-cccc', name: 'Housing', containsOthers: false },
]

const view = (over: Partial<ChangeMemoriesViewProps> = {}) => {
  const props: ChangeMemoriesViewProps = {
    agentName: 'Notes helper',
    memories: MEMORIES,
    current: ['keyring-memory-aaaa', 'keyring-memory-bbbb'],
    onCreateMemory: jest.fn(),
    confirm: jest.fn(async () => true),
    onWiden: jest.fn(async () => ({ ok: true as const })),
    onNarrow: jest.fn(async () => ({ ok: true as const })),
    ...over,
  }
  return { props, tree: show(<ChangeMemoriesView {...props} />) }
}
const rowFor = (tree: ReturnType<typeof show>, name: string) =>
  // Hidden elements included: with a question open, the sheet hides the rows from a screen reader, not from a finger.
  tree
    .getAllByTestId(id('MemoryPickerRow'), { includeHiddenElements: true })
    .find((r) => r.props.accessibilityLabel === name)!

describe('ChangeMemoriesView', () => {
  it('shows what the agent can use now, and changes nothing until asked', () => {
    const { props, tree } = view()
    expect(rowFor(tree, 'Education').props.accessibilityState.checked).toBe(true)
    expect(rowFor(tree, 'Housing').props.accessibilityState.checked).toBe(false)
    expect(tree.queryByTestId(id('ChangeMemoriesSheet'))).toBeNull()
    expect(props.onWiden).not.toHaveBeenCalled()
    expect(props.onNarrow).not.toHaveBeenCalled()
  })

  it('asks before letting it use one more, and widens only after the face or fingerprint check passes', async () => {
    const { props, tree } = view()
    fireEvent.press(rowFor(tree, 'Housing'))
    expect(tree.getByText('ConnectedAgents.WidenTitle')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.WidenBody')).toBeTruthy()
    expect(props.onWiden).not.toHaveBeenCalled()
    fireEvent.press(tree.getByTestId(id('ChangeMemoriesYes')))
    await waitFor(() => expect(props.onWiden).toHaveBeenCalledWith('keyring-memory-cccc'))
    expect(props.confirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(tree.queryByTestId(id('ChangeMemoriesSheet'))).toBeNull())
  })

  it.each([
    ['declined', async () => false],
    ['an error', async () => Promise.reject(new Error('no biometrics'))],
  ])('never widens when the check is %s', async (_, confirm) => {
    const { props, tree } = view({ confirm: jest.fn(confirm) })
    fireEvent.press(rowFor(tree, 'Housing'))
    fireEvent.press(tree.getByTestId(id('ChangeMemoriesYes')))
    await waitFor(() => expect(props.confirm).toHaveBeenCalledTimes(1))
    await act(async () => undefined)
    expect(props.onWiden).not.toHaveBeenCalled()
  })

  it('asks once before it stops using one, with no face or fingerprint check, and "Keep" changes nothing', async () => {
    const { props, tree } = view()
    fireEvent.press(rowFor(tree, 'Healthcare'))
    expect(tree.getByText('ConnectedAgents.NarrowTitle')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.NarrowBody')).toBeTruthy()
    fireEvent.press(tree.getByTestId(id('ChangeMemoriesNo')))
    expect(tree.queryByTestId(id('ChangeMemoriesSheet'))).toBeNull()
    expect(props.onNarrow).not.toHaveBeenCalled()
    fireEvent.press(rowFor(tree, 'Healthcare'))
    fireEvent.press(tree.getByTestId(id('ChangeMemoriesYes')))
    await waitFor(() => expect(props.onNarrow).toHaveBeenCalledWith('keyring-memory-bbbb'))
    expect(props.confirm).not.toHaveBeenCalled()
  })

  it('says when the VTA did not make the change, and keeps the question open', async () => {
    const { tree } = view({ onNarrow: jest.fn(async () => ({ ok: false as const, code: 'vta-unreachable' })) })
    fireEvent.press(rowFor(tree, 'Healthcare'))
    fireEvent.press(tree.getByTestId(id('ChangeMemoriesYes')))
    await waitFor(() => expect(tree.getByTestId(id('ChangeMemoriesFailed'))).toBeTruthy())
    expect(tree.getByTestId(id('ChangeMemoriesSheet'))).toBeTruthy()
  })

  it('asks one change at a time: another tick while a question is open does nothing', () => {
    const { tree } = view()
    fireEvent.press(rowFor(tree, 'Housing'))
    fireEvent.press(rowFor(tree, 'Healthcare'))
    expect(tree.getByText('ConnectedAgents.WidenTitle')).toBeTruthy()
    expect(tree.queryByText('ConnectedAgents.NarrowTitle')).toBeNull()
  })

  it('asks before letting it use a memory just made here, as for any other', async () => {
    const made = { id: 'keyring-memory-dddd', name: 'Travel', containsOthers: false }
    const { props, tree } = view({ onCreateMemory: jest.fn(async () => ({ ok: true as const, memory: made })) })
    fireEvent.press(tree.getByTestId(id('MemoryPickerNew')))
    fireEvent.changeText(tree.getByTestId(id('MemoryPickerName')), 'Travel')
    fireEvent.press(tree.getByTestId(id('MemoryPickerCreate')))
    await waitFor(() => expect(tree.getByText('ConnectedAgents.WidenTitle')).toBeTruthy())
    expect(props.onWiden).not.toHaveBeenCalled()
    fireEvent.press(tree.getByTestId(id('ChangeMemoriesYes')))
    await waitFor(() => expect(props.onWiden).toHaveBeenCalledWith('keyring-memory-dddd'))
  })
})
