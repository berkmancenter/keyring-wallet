/**
 * Agent connect, "Acting as" (finding 18, §7.7; canvas frame 58): the row that asks which of the owner's personas an
 * agent acts for, drawn only with more than one, and the connect form's "Continue" waiting for that choice. Views only:
 * the persona list comes from the logic's `usePersonas()` in a later part, as a prop.
 */
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import ActingAsRow, { ActingAsPersona } from '../components/ActingAsRow'
import { PickerMemory } from '../components/MemoryPicker'
import ConnectAgentForm from '../screens/ConnectAgentForm'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)

const ADA: ActingAsPersona = { did: 'did:example:persona-ada', name: 'Ada' }
const COLLEGE: ActingAsPersona = { did: 'did:example:persona-ada-college', name: 'Ada at Example College' }
const MEMORIES: PickerMemory[] = [{ id: 'keyring-memory-aaaa', name: 'Education', containsOthers: false }]

describe('ActingAsRow', () => {
  const row = (personas: ActingAsPersona[], selected?: string) => {
    const onSelect = jest.fn()
    return { onSelect, tree: show(<ActingAsRow personas={personas} selected={selected} onSelect={onSelect} />) }
  }

  // control: changing `personas.length < 2` to `< 1` in ActingAsRow draws the row with one persona and fails this.
  it.each([
    ['no persona', []],
    ['one persona', [ADA]],
  ])('draws nothing with %s', (_, personas) => {
    const { tree } = row(personas)
    expect(tree.queryByTestId(id('ActingAsRow'))).toBeNull()
    expect(tree.queryByText('ConnectedAgents.ActingAs')).toBeNull()
    expect(tree.toJSON()).toBeNull()
  })

  it('draws "Acting as" with two personas, with no name and the list closed before a choice', () => {
    const { tree } = row([ADA, COLLEGE])
    const header = tree.getByTestId(id('ActingAsRow'))
    expect(tree.getByText('ConnectedAgents.ActingAs')).toBeTruthy()
    expect(header.props.accessibilityLabel).toBe('ConnectedAgents.ActingAs')
    expect(header.props.accessibilityState.expanded).toBe(false)
    expect(tree.queryByText('Ada')).toBeNull()
    expect(tree.queryAllByTestId(id('ActingAsOption'))).toHaveLength(0)
  })

  it('opens an inline list of radio rows by display name, none checked, and closes it again', () => {
    const { tree } = row([ADA, COLLEGE])
    fireEvent.press(tree.getByTestId(id('ActingAsRow')))
    const options = tree.getAllByTestId(id('ActingAsOption'))
    expect(options.map((o) => o.props.accessibilityLabel)).toEqual(['Ada', 'Ada at Example College'])
    expect(options.map((o) => o.props.accessibilityRole)).toEqual(['radio', 'radio'])
    expect(options.map((o) => o.props.accessibilityState.checked)).toEqual([false, false])
    expect(tree.getByTestId(id('ActingAsRow')).props.accessibilityState.expanded).toBe(true)
    fireEvent.press(tree.getByTestId(id('ActingAsRow')))
    expect(tree.queryAllByTestId(id('ActingAsOption'))).toHaveLength(0)
  })

  it('shows the chosen persona on the row and checks it in the list', () => {
    const { tree } = row([ADA, COLLEGE], COLLEGE.did)
    expect(tree.getByText('Ada at Example College')).toBeTruthy()
    expect(tree.getByTestId(id('ActingAsRow')).props.accessibilityLabel).toBe(
      'ConnectedAgents.ActingAs, Ada at Example College'
    )
    fireEvent.press(tree.getByTestId(id('ActingAsRow')))
    const options = tree.getAllByTestId(id('ActingAsOption'))
    expect(options.map((o) => o.props.accessibilityState.checked)).toEqual([false, true])
  })

  it('hands on the DID of the persona pressed', () => {
    const { tree, onSelect } = row([ADA, COLLEGE])
    fireEvent.press(tree.getByTestId(id('ActingAsRow')))
    fireEvent.press(tree.getByLabelText('Ada at Example College'))
    expect(onSelect).toHaveBeenCalledWith(COLLEGE.did)
  })

  it('shows no name for a selection that is not one of the personas', () => {
    const { tree } = row([ADA, COLLEGE], 'did:example:someone-else')
    expect(tree.getByTestId(id('ActingAsRow')).props.accessibilityLabel).toBe('ConnectedAgents.ActingAs')
  })
})

describe('ConnectAgentForm with "Acting as"', () => {
  const form = (personas?: ActingAsPersona[]) => {
    const onContinue = jest.fn()
    const tree = show(
      <ConnectAgentForm
        guard="ok"
        memories={MEMORIES}
        personas={personas}
        onCreateMemory={jest.fn()}
        onContinue={onContinue}
        onClose={jest.fn()}
      />
    )
    fireEvent.changeText(tree.getByTestId(id('ConnectAgentName')), 'Notes helper')
    return { tree, onContinue }
  }
  const continueOff = (tree: ReturnType<typeof show>) =>
    tree.getByTestId(id('ConnectAgentContinue')).props.accessibilityState.disabled
  const choose = (tree: ReturnType<typeof show>, name: string) => {
    fireEvent.press(tree.getByTestId(id('ActingAsRow')))
    fireEvent.press(tree.getByLabelText(name))
  }

  it('draws "Acting as" above "Memory it can use"', () => {
    const { tree } = form([ADA, COLLEGE])
    const text = JSON.stringify(tree.toJSON())
    const name = text.indexOf('ConnectedAgents.NameThisAgent')
    const actingAs = text.indexOf('ConnectedAgents.ActingAs')
    const memory = text.indexOf('ConnectedAgents.MemoryItCanUse')
    expect(name).toBeGreaterThan(-1)
    expect(actingAs).toBeGreaterThan(name)
    expect(memory).toBeGreaterThan(actingAs)
  })

  // control: dropping `(!asksPersona || ownerPersonaDid !== undefined)` from `ready` fails this case.
  it('keeps "Continue" off with two personas until one is chosen, and hands the choice on', () => {
    const { tree, onContinue } = form([ADA, COLLEGE])
    expect(continueOff(tree)).toBe(true)
    fireEvent.press(tree.getByTestId(id('ConnectAgentContinue')))
    expect(onContinue).not.toHaveBeenCalled()

    choose(tree, 'Ada at Example College')
    expect(continueOff(tree)).toBe(false)
    fireEvent.press(tree.getByTestId(id('ConnectAgentContinue')))
    expect(onContinue).toHaveBeenCalledWith({
      name: 'Notes helper',
      memoryContexts: [],
      purposes: ['personalisation', 'taskExecution'],
      ownerPersonaDid: COLLEGE.did,
    })
  })

  it('hands on the last persona chosen', () => {
    const { tree, onContinue } = form([ADA, COLLEGE])
    choose(tree, 'Ada at Example College')
    fireEvent.press(tree.getByLabelText('Ada'))
    fireEvent.press(tree.getByTestId(id('ConnectAgentContinue')))
    expect(onContinue.mock.calls[0][0].ownerPersonaDid).toBe(ADA.did)
  })

  it.each([
    ['no personas prop', undefined],
    ['no persona', []],
    ['one persona', [ADA]],
  ])('with %s: no row, "Continue" on without a choice, and no ownerPersonaDid', (_, personas) => {
    const { tree, onContinue } = form(personas)
    expect(tree.queryByTestId(id('ActingAsRow'))).toBeNull()
    expect(continueOff(tree)).toBe(false)
    fireEvent.press(tree.getByTestId(id('ConnectAgentContinue')))
    expect(onContinue).toHaveBeenCalledTimes(1)
    expect(Object.keys(onContinue.mock.calls[0][0]).sort()).toEqual(['memoryContexts', 'name', 'purposes'])
  })

  it('drops a choice whose persona has left the list, and waits again', () => {
    const onContinue = jest.fn()
    const props = {
      guard: 'ok' as const,
      memories: MEMORIES,
      onCreateMemory: jest.fn(),
      onContinue,
      onClose: jest.fn(),
    }
    const third: ActingAsPersona = { did: 'did:example:persona-three', name: 'Ada at Work' }
    const tree = show(<ConnectAgentForm {...props} personas={[ADA, COLLEGE, third]} />)
    fireEvent.changeText(tree.getByTestId(id('ConnectAgentName')), 'Notes helper')
    choose(tree, 'Ada at Work')
    expect(continueOff(tree)).toBe(false)
    tree.rerender(
      <BasicAppContext>
        <ConnectAgentForm {...props} personas={[ADA, COLLEGE]} />
      </BasicAppContext>
    )
    expect(continueOff(tree)).toBe(true)
  })
})
