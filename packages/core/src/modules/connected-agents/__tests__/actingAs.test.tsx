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

  // control: changing the default `ask = personas.length > 1` to `> 0` in ActingAsRow draws the row with one persona
  // and fails this.
  it.each([
    ['no persona', []],
    ['one persona', [ADA]],
  ])('draws nothing with %s', (_, personas) => {
    const { tree } = row(personas)
    expect(tree.queryByTestId(id('ActingAsRow'))).toBeNull()
    expect(tree.queryByText('ConnectedAgents.ActingAs')).toBeNull()
    expect(tree.toJSON()).toBeNull()
  })

  it('draws "Acting as" with two personas, with no name on the row before a choice', () => {
    const { tree } = row([ADA, COLLEGE])
    const header = tree.getByTestId(id('ActingAsRow'))
    expect(tree.getByText('ConnectedAgents.ActingAs')).toBeTruthy()
    expect(header.props.accessibilityLabel).toBe('ConnectedAgents.ActingAs')
  })

  // control: starting the list closed (`useState(false)` for `open` in ActingAsRow) fails this.
  it('with nothing chosen, shows the inline list of radio rows by display name without a tap, none checked', () => {
    const { tree } = row([ADA, COLLEGE])
    const options = tree.getAllByTestId(id('ActingAsOption'))
    expect(options.map((o) => o.props.accessibilityLabel)).toEqual(['Ada', 'Ada at Example College'])
    expect(options.map((o) => o.props.accessibilityRole)).toEqual(['radio', 'radio'])
    expect(options.map((o) => o.props.accessibilityState.checked)).toEqual([false, false])
    expect(tree.getByTestId(id('ActingAsRow')).props.accessibilityState.expanded).toBe(true)
  })

  it('closes the list on a press of the row and opens it again on the next', () => {
    const { tree } = row([ADA, COLLEGE])
    fireEvent.press(tree.getByTestId(id('ActingAsRow')))
    expect(tree.queryAllByTestId(id('ActingAsOption'))).toHaveLength(0)
    expect(tree.getByTestId(id('ActingAsRow')).props.accessibilityState.expanded).toBe(false)
    fireEvent.press(tree.getByTestId(id('ActingAsRow')))
    expect(tree.getAllByTestId(id('ActingAsOption'))).toHaveLength(2)
  })

  it('starts closed when a persona is already chosen', () => {
    const { tree } = row([ADA, COLLEGE], ADA.did)
    expect(tree.queryAllByTestId(id('ActingAsOption'))).toHaveLength(0)
  })

  it('draws the row with one persona when told to ask', () => {
    const onSelect = jest.fn()
    const tree = show(<ActingAsRow personas={[ADA]} onSelect={onSelect} ask />)
    expect(tree.getByTestId(id('ActingAsRow'))).toBeTruthy()
    expect(tree.getAllByTestId(id('ActingAsOption')).map((o) => o.props.accessibilityLabel)).toEqual(['Ada'])
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
  // With nothing chosen the list is already open, so a choice is one press.
  const choose = (tree: ReturnType<typeof show>, name: string) => fireEvent.press(tree.getByLabelText(name))
  const options = (tree: ReturnType<typeof show>) =>
    tree.queryAllByTestId(id('ActingAsOption')).map((o) => o.props.accessibilityLabel)

  // control: after a choice and a tap on the row, the options close, so it is the opening state that shows them.
  it('with several personas and nothing chosen, the options are visible without a tap', () => {
    const { tree } = form([ADA, COLLEGE])
    expect(options(tree)).toEqual(['Ada', 'Ada at Example College'])
    choose(tree, 'Ada')
    expect(options(tree)).toEqual(['Ada', 'Ada at Example College'])
    fireEvent.press(tree.getByTestId(id('ActingAsRow')))
    expect(options(tree)).toEqual([])
  })

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

  // The never-asked control for the shrinking cases below: with 0 or 1 persona from the start the form never asks,
  // and `ownerPersonaDid` is absent from the choice, not merely undefined.
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

  describe('when the persona list shrinks mid-connect', () => {
    const WORK: ActingAsPersona = { did: 'did:example:persona-three', name: 'Ada at Work' }
    const shrinking = (chosen: string) => {
      const onContinue = jest.fn()
      const props = {
        guard: 'ok' as const,
        memories: MEMORIES,
        onCreateMemory: jest.fn(),
        onContinue,
        onClose: jest.fn(),
      }
      const tree = show(<ConnectAgentForm {...props} personas={[ADA, COLLEGE, WORK]} />)
      fireEvent.changeText(tree.getByTestId(id('ConnectAgentName')), 'Notes helper')
      choose(tree, chosen)
      expect(continueOff(tree)).toBe(false)
      const shrinkTo = (personas: ActingAsPersona[]) =>
        tree.rerender(
          <BasicAppContext>
            <ConnectAgentForm {...props} personas={personas} />
          </BasicAppContext>
        )
      return { tree, onContinue, shrinkTo }
    }

    it('drops a choice whose persona has left the list, and waits again', () => {
      const { tree, shrinkTo } = shrinking('Ada at Work')
      shrinkTo([ADA, COLLEGE])
      expect(continueOff(tree)).toBe(true)
    })

    // control: deriving `asksPersona` from `personas.length > 1` on each render (not sticky) fails this: the row goes
    // and "Continue" comes on with no persona, so the logic would fill one the person did not choose.
    it('down to one with the chosen persona gone: the row still asks and "Continue" is off', () => {
      const { tree, onContinue, shrinkTo } = shrinking('Ada at Work')
      shrinkTo([ADA])
      expect(tree.getByTestId(id('ActingAsRow')).props.accessibilityLabel).toBe('ConnectedAgents.ActingAs')
      expect(options(tree)).toEqual(['Ada'])
      expect(continueOff(tree)).toBe(true)
      fireEvent.press(tree.getByTestId(id('ConnectAgentContinue')))
      expect(onContinue).not.toHaveBeenCalled()

      choose(tree, 'Ada')
      expect(continueOff(tree)).toBe(false)
      fireEvent.press(tree.getByTestId(id('ConnectAgentContinue')))
      expect(onContinue.mock.calls[0][0].ownerPersonaDid).toBe(ADA.did)
    })

    it('reopens the list when the choice is lost, even after the person closed it', () => {
      const { tree, shrinkTo } = shrinking('Ada at Work')
      fireEvent.press(tree.getByTestId(id('ActingAsRow')))
      expect(options(tree)).toEqual([])
      shrinkTo([ADA])
      expect(options(tree)).toEqual(['Ada'])
    })

    it('down to one with the chosen persona still there: the choice is kept and "Continue" stays on', () => {
      const { tree, onContinue, shrinkTo } = shrinking('Ada')
      shrinkTo([ADA])
      expect(tree.getByTestId(id('ActingAsRow')).props.accessibilityLabel).toBe('ConnectedAgents.ActingAs, Ada')
      expect(continueOff(tree)).toBe(false)
      fireEvent.press(tree.getByTestId(id('ConnectAgentContinue')))
      expect(onContinue.mock.calls[0][0].ownerPersonaDid).toBe(ADA.did)
    })
  })
})
