/**
 * Agent connect, the HCP new memory as a view (backlog Section C, U3; canvas frame 51). A view only: nothing here
 * saves a memory.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { readFileSync } from 'fs'
import path from 'path'
import React from 'react'

import { BasicAppContext } from '../../../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../../../utils/testable'
import { HCP_MEMORY_NAME, HCP_MEMORY_SAMPLE } from '../../../__tests__/fixtures/screenStatesHcpMemory'
import { hcpText } from '../../copy'
import { type HcpAddMemoryResult, HCP_MEMORY_MAX_CHARS } from '../../newMemory'
import HcpNewMemoryView, { HcpNewMemoryViewProps } from '../HcpNewMemoryView'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)
const en = (key: Parameters<typeof hcpText>[0], params?: Record<string, string>) => hcpText(key, 'en', params)

const unreachable: HcpAddMemoryResult = { ok: false, unreachable: true, message: { key: 'MemoryNotSaved' } }
const saved: HcpAddMemoryResult = { ok: true, entry: { id: 'urn:uuid:0e1d2c3b-4a59-4687-9a8b-7c6d5e4f3a21' } }

const view = (onSave: HcpNewMemoryViewProps['onSave'], initialText?: string) => {
  const props: HcpNewMemoryViewProps = {
    name: HCP_MEMORY_NAME,
    onSave: jest.fn(onSave),
    onDone: jest.fn(),
    initialText,
  }
  return { props, tree: show(<HcpNewMemoryView {...props} />) }
}
type Tree = ReturnType<typeof show>
const type = (tree: Tree, text: string) => fireEvent.changeText(tree.getByTestId(id('HcpNewMemoryField')), text)
const press = (tree: Tree) => fireEvent.press(tree.getByTestId(id('HcpNewMemorySave')))
const saveOff = (tree: Tree) => tree.getByTestId(id('HcpNewMemorySave')).props.accessibilityState.disabled
const fieldText = (tree: Tree) => tree.getByTestId(id('HcpNewMemoryField')).props.value

describe('HcpNewMemoryView', () => {
  it('draws the title with the name, the labelled field, the helper and Save, and no outcome', () => {
    const { tree } = view(async () => saved)
    expect(tree.getByTestId(id('HcpNewMemory'))).toBeTruthy()
    expect(tree.getByText(en('NewMemoryTitle', { name: HCP_MEMORY_NAME }))).toBeTruthy()
    expect(tree.getByText(en('NewMemoryField'))).toBeTruthy()
    expect(tree.getByText(en('NewMemoryHelper'))).toBeTruthy()
    const field = tree.getByTestId(id('HcpNewMemoryField'))
    expect(field.props.accessibilityLabel).toBe(en('NewMemoryField'))
    expect(field.props.multiline).toBe(true)
    expect(field.props.maxLength).toBe(HCP_MEMORY_MAX_CHARS)
    expect(tree.getByTestId(id('HcpNewMemorySave')).props.accessibilityLabel).toBe(en('NewMemorySave'))
    expect(tree.queryByTestId(id('HcpNewMemoryOutcome'))).toBeNull()
  })

  it.each<[string, string]>([
    ['empty', ''],
    ['only spaces', '   \n '],
    ['over 4096 characters', 'a'.repeat(HCP_MEMORY_MAX_CHARS + 1)],
  ])('Save is off for a text that is %s, and a press sends nothing', async (_, text) => {
    const { props, tree } = view(async () => saved)
    type(tree, text)
    expect(saveOff(tree)).toBe(true)
    press(tree)
    await act(async () => undefined)
    expect(props.onSave).not.toHaveBeenCalled()
  })

  // control: a valid text turns Save on, so the cases above are off for their text, not always.
  it.each<[string, string]>([
    ['one character', 'a'],
    ['the frame sample', HCP_MEMORY_SAMPLE],
    ['exactly 4096 characters', 'a'.repeat(HCP_MEMORY_MAX_CHARS)],
  ])('control: Save is on for %s', (_, text) => {
    const { tree } = view(async () => saved)
    expect(saveOff(tree)).toBe(true)
    type(tree, text)
    expect(saveOff(tree)).toBe(false)
  })

  it('ok: saves the text as typed, calls onDone once, and the view is spent', async () => {
    const { props, tree } = view(async () => saved)
    type(tree, HCP_MEMORY_SAMPLE)
    press(tree)
    await waitFor(() => expect(props.onDone).toHaveBeenCalledTimes(1))
    expect(props.onSave).toHaveBeenCalledWith(HCP_MEMORY_SAMPLE)
    expect(tree.queryByTestId(id('HcpNewMemoryOutcome'))).toBeNull()
    expect(saveOff(tree)).toBe(true)
    press(tree)
    await act(async () => undefined)
    expect(props.onSave).toHaveBeenCalledTimes(1)
    expect(props.onDone).toHaveBeenCalledTimes(1)
  })

  it('unreachable: shows MemoryNotSaved, keeps the text, and Save is there to press again', async () => {
    const { props, tree } = view(async () => unreachable, HCP_MEMORY_SAMPLE)
    press(tree)
    await waitFor(() => expect(tree.getByTestId(id('HcpNewMemoryOutcome'))).toBeTruthy())
    expect(tree.getByTestId(id('HcpNewMemoryOutcome')).props.accessibilityLabel).toBe(en('MemoryNotSaved'))
    expect(fieldText(tree)).toBe(HCP_MEMORY_SAMPLE)
    expect(props.onDone).not.toHaveBeenCalled()
    expect(saveOff(tree)).toBe(false)
    press(tree)
    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(2))
  })

  // Decided at review: a result that carries a message shows it, in place of FailGeneric's "Nothing was connected.".
  it.each<[string, HcpAddMemoryResult, 'MemoryRefused' | 'MemoryNoVta']>([
    ['refused', { ok: false, refused: 'badRequest', message: { key: 'MemoryRefused' } }, 'MemoryRefused'],
    ['refused with no entry', { ok: false, refused: 'noEntry', message: { key: 'MemoryRefused' } }, 'MemoryRefused'],
    ['noManager', { ok: false, noManager: true, message: { key: 'MemoryNoVta' } }, 'MemoryNoVta'],
  ])(
    '%s: shows its own line, keeps the text, does not close, and Save is there to press again',
    async (_, result, key) => {
      const { props, tree } = view(async () => result, HCP_MEMORY_SAMPLE)
      press(tree)
      await waitFor(() => expect(tree.getByTestId(id('HcpNewMemoryOutcome'))).toBeTruthy())
      expect(tree.getByTestId(id('HcpNewMemoryOutcome')).props.accessibilityLabel).toBe(en(key))
      expect(tree.queryByText('ConnectedAgents.FailGeneric')).toBeNull()
      expect(tree.queryByText(/badRequest|noEntry/)).toBeNull()
      expect(fieldText(tree)).toBe(HCP_MEMORY_SAMPLE)
      expect(props.onDone).not.toHaveBeenCalled()
      expect(saveOff(tree)).toBe(false)
      press(tree)
      await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(2))
    }
  )

  // Backstops: none of these has HCP words, and none is expected from a press (see the view's `save`).
  it.each<[string, () => Promise<HcpAddMemoryResult>]>([
    ['invalid (a backstop: Save is off for an invalid text)', async () => ({ ok: false, invalid: true })],
    ['off (not in the brief)', async () => ({ ok: false, off: true })],
    ['a save that throws (not in the brief)', async () => Promise.reject(new Error('port'))],
  ])('%s: shows ConnectedAgents.FailGeneric, keeps the text, and does not close', async (_, onSave) => {
    const { props, tree } = view(onSave, HCP_MEMORY_SAMPLE)
    press(tree)
    await waitFor(() => expect(tree.getByTestId(id('HcpNewMemoryOutcome'))).toBeTruthy())
    expect(tree.getByTestId(id('HcpNewMemoryOutcome')).props.accessibilityLabel).toBe('ConnectedAgents.FailGeneric')
    expect(tree.queryByText(/badRequest|port/)).toBeNull()
    expect(fieldText(tree)).toBe(HCP_MEMORY_SAMPLE)
    expect(props.onDone).not.toHaveBeenCalled()
  })

  it('a later success clears an earlier outcome', async () => {
    const onSave = jest
      .fn<Promise<HcpAddMemoryResult>, [string]>()
      .mockResolvedValueOnce(unreachable)
      .mockResolvedValueOnce(saved)
    const { props, tree } = view(onSave, HCP_MEMORY_SAMPLE)
    press(tree)
    await waitFor(() => expect(tree.getByTestId(id('HcpNewMemoryOutcome'))).toBeTruthy())
    press(tree)
    await waitFor(() => expect(props.onDone).toHaveBeenCalledTimes(1))
    expect(tree.queryByTestId(id('HcpNewMemoryOutcome'))).toBeNull()
  })

  it('once while a save is open: a second press sends nothing, and Save and the field are disabled', async () => {
    let answer: (result: HcpAddMemoryResult) => void = () => undefined
    const { props, tree } = view(
      () => new Promise<HcpAddMemoryResult>((resolve) => (answer = resolve)),
      HCP_MEMORY_SAMPLE
    )
    press(tree)
    press(tree)
    expect(props.onSave).toHaveBeenCalledTimes(1)
    await act(async () => undefined)
    expect(saveOff(tree)).toBe(true)
    expect(tree.getByTestId(id('HcpNewMemoryField')).props.editable).toBe(false)
    await act(async () => answer(unreachable))
    expect(saveOff(tree)).toBe(false)
    expect(tree.getByTestId(id('HcpNewMemoryField')).props.editable).toBe(true)
    expect(props.onSave).toHaveBeenCalledTimes(1)
  })

  // control: once the open save answers, Save can be pressed again, so "once while open" is not "once ever".
  it('control: after an unreachable answer, a second press does save', async () => {
    const { props, tree } = view(async () => unreachable, HCP_MEMORY_SAMPLE)
    press(tree)
    await waitFor(() => expect(tree.getByTestId(id('HcpNewMemoryOutcome'))).toBeTruthy())
    press(tree)
    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(2))
  })
})

describe('the U3 view', () => {
  it('imports no logic action: the new memory validator and types only', () => {
    const source = readFileSync(path.join(__dirname, '..', 'HcpNewMemoryView.tsx'), 'utf8')
    // A value import from track C's hcp/ logic (a sibling of screens/), other than `newMemory` (its validator and
    // limit change nothing), or from the module's own logic (a file directly under connected-agents/).
    const logic = [
      ...source.matchAll(
        /^import (?!type )[^\n]*from '(\.\.\/(?!newMemory')[\w]+|\.\.\/\.\.\/(?!screens\/|components\/)[\w]+)'/gm
      ),
    ].map((m) => m[0])
    expect(logic).toEqual([])
    const imports = source.split('\n').filter((line) => line.startsWith('import '))
    expect(imports.filter((line) => /addHcpMemory|hcpCreatePayload|callHcp/.test(line))).toEqual([])
  })
})
