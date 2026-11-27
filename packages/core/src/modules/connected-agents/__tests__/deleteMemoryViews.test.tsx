/**
 * Step 7.16's views (docs/plans/agent-connect-plan.md §3.15 "Deleting a memory"; canvas frames 57 and 23): the
 * memories list, whose "Delete" only reports the id, and the delete sheet, which shows the preview's facts, sends
 * nothing until "Delete" is pressed and then only once while it is open, and says what the delete came to. A held
 * delete never offers to try again, in any language.
 *
 * The test translation answers the key (`__mocks__/react-i18next.ts`), so the views are checked by key and testID, as
 * the module's other suites do. Where a word sits inside another's parameters (the agents' names, an unnamed agent),
 * `withParams()` swaps in a translation that also prints the parameters.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import type * as reactI18next from 'react-i18next'
import { StyleSheet } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { testIdWithKey } from '../../../utils/testable'
import { AGENT_COLORS } from '../components/agentStyle'
import type { DeleteMemoryResult, DeletePreview } from '../deleteMemory'
import { MEMORY_COUNT_WARNING, MemoryCount } from '../memories'
import DeleteMemorySheet from '../screens/DeleteMemorySheet'
import MemoriesListView from '../screens/MemoriesListView'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)
const formatDate = (iso: string) => iso.slice(11, 16)

/** A translation that prints a key's parameters after it, so a word passed as a parameter can be seen. */
const withParams = () => {
  const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key)
  // The module object itself (jest maps it to __mocks__/react-i18next.ts), not an `import * as` copy, so the views'
  // own import sees the spy.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const i18nModule = require('react-i18next') as typeof reactI18next
  return jest
    .spyOn(i18nModule, 'useTranslation')
    .mockReturnValue({ t, i18n: { language: 'en' } } as unknown as ReturnType<typeof reactI18next.useTranslation>)
}
afterEach(() => jest.restoreAllMocks())

const counted = (count: number, lastChange?: string, complete = true): MemoryCount => ({
  ok: true,
  count,
  complete,
  ...(lastChange ? { lastChange } : {}),
})
const EDU = { id: 'keyring-memory-aaaa', name: 'Education' }
const HEALTH = { id: 'keyring-memory-bbbb', name: 'Healthcare' }
const NOTES = { subject: 'did:key:z6MkNotes', name: 'Notes helper' }
const READER = { subject: 'did:key:z6MkReader', name: 'Reader' }

const preview = (over: Partial<Extract<DeletePreview, { ok: true }>> = {}): DeletePreview => ({
  ok: true,
  count: counted(12),
  overWarning: false,
  agents: [NOTES],
  ...over,
})

type SheetProps = Partial<React.ComponentProps<typeof DeleteMemorySheet>>
const sheet = (over: SheetProps = {}) => {
  const props = {
    memory: { name: HEALTH.name },
    preview: preview(),
    onConfirm: jest.fn(async (): Promise<DeleteMemoryResult> => ({ ok: true, recordsNotUpdated: 0 })),
    onKeep: jest.fn(),
    onDone: jest.fn(),
    ...over,
  }
  return { props, view: show(<DeleteMemorySheet {...props} />) }
}
const answers = (result: DeleteMemoryResult) => jest.fn(async () => result)
const pressDelete = async (view: ReturnType<typeof show>) => {
  fireEvent.press(view.getByTestId(id('DeleteMemoryConfirm')))
  await act(async () => undefined)
}

describe('MemoriesListView', () => {
  it('heads the list "Your memories" and draws one row per memory, each with "Delete"', () => {
    const view = show(
      <MemoriesListView memories={[EDU, HEALTH]} counts={{}} formatDate={formatDate} onDelete={jest.fn()} />
    )
    expect(view.getByText('ConnectedAgents.MemoriesTitle')).toBeTruthy()
    expect(view.getAllByTestId(id('MemoriesListRow'))).toHaveLength(2)
    expect(view.getAllByTestId(id('MemoriesListDelete'))).toHaveLength(2)
    expect(view.getByText(EDU.name)).toBeTruthy()
    expect(view.getByText(HEALTH.name)).toBeTruthy()
  })

  it('"Delete" reports the memory\'s id and nothing else', () => {
    const onDelete = jest.fn()
    const view = show(
      <MemoriesListView memories={[EDU, HEALTH]} counts={{}} formatDate={formatDate} onDelete={onDelete} />
    )
    fireEvent.press(view.getAllByTestId(id('MemoriesListDelete'))[1])
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith(HEALTH.id)
  })

  it('draws "Delete" in the danger red', () => {
    const view = show(<MemoriesListView memories={[EDU]} counts={{}} formatDate={formatDate} onDelete={jest.fn()} />)
    const word = view.getByText('ConnectedAgents.Delete')
    expect(StyleSheet.flatten(word.props.style)).toMatchObject({ color: AGENT_COLORS.danger })
  })

  it('uses the count line of the details: with the date formatted by the caller, without one, or failed', () => {
    withParams()
    const view = show(
      <MemoriesListView
        memories={[EDU, HEALTH, { id: 'keyring-memory-cccc', name: 'Housing' }, { id: 'keyring-memory-d', name: 'W' }]}
        counts={{
          [EDU.id]: counted(214, '2026-11-24T09:12:00.000Z'),
          [HEALTH.id]: counted(3),
          'keyring-memory-cccc': { ok: false },
        }}
        formatDate={formatDate}
        onDelete={jest.fn()}
      />
    )
    expect(view.getByText('ConnectedAgents.MemoryCount {"count":214,"date":"09:12"}')).toBeTruthy()
    expect(view.getByText('ConnectedAgents.MemoryCountNoDate {"count":3}')).toBeTruthy()
    // Housing's count failed, and W has none at all: both say they couldn't count.
    expect(view.getAllByText('ConnectedAgents.MemoryCountFailed')).toHaveLength(2)
  })

  it('shows a count that is not complete as counted (the logic decides completeness)', () => {
    withParams()
    const view = show(
      <MemoriesListView
        memories={[EDU]}
        counts={{ [EDU.id]: counted(20000, undefined, false) }}
        formatDate={formatDate}
        onDelete={jest.fn()}
      />
    )
    expect(view.getByText('ConnectedAgents.MemoryCountNoDate {"count":20000}')).toBeTruthy()
    expect(view.queryByText('ConnectedAgents.MemoryCountFailed')).toBeNull()
  })

  it('warns only over MEMORY_COUNT_WARNING, naming the memory and the limit', () => {
    withParams()
    const view = show(
      <MemoriesListView
        memories={[EDU, HEALTH]}
        counts={{ [EDU.id]: counted(MEMORY_COUNT_WARNING), [HEALTH.id]: counted(MEMORY_COUNT_WARNING + 1) }}
        formatDate={formatDate}
        onDelete={jest.fn()}
      />
    )
    const warnings = view.queryAllByText(/^ConnectedAgents\.MemoryCountWarning/)
    expect(warnings.map((w) => w.props.children)).toEqual([
      `ConnectedAgents.MemoryCountWarning {"memory":"Healthcare","limit":${MEMORY_COUNT_WARNING}}`,
    ])
  })

  it('control: a count at the limit is not warned about', () => {
    const view = show(
      <MemoriesListView
        memories={[EDU]}
        counts={{ [EDU.id]: counted(MEMORY_COUNT_WARNING) }}
        formatDate={formatDate}
        onDelete={jest.fn()}
      />
    )
    expect(view.queryByText('ConnectedAgents.MemoryCountWarning')).toBeNull()
  })

  it('waits for the counts with a spinner, not a failed line', () => {
    const view = show(<MemoriesListView memories={[EDU]} formatDate={formatDate} onDelete={jest.fn()} />)
    expect(view.queryByText('ConnectedAgents.MemoryCountFailed')).toBeNull()
    expect(view.UNSAFE_getAllByType(require('react-native').ActivityIndicator)).toHaveLength(1)
  })
})

describe('DeleteMemorySheet: what it says before Delete', () => {
  it('names the memory and every agent that loses it, joined by ", "', () => {
    withParams()
    const { view } = sheet({ preview: preview({ agents: [NOTES, READER] }) })
    expect(view.getByText('ConnectedAgents.DeleteMemoryTitle {"memory":"Healthcare"}')).toBeTruthy()
    expect(view.getByText('ConnectedAgents.DeleteMemoryBody {"count":12,"agents":"Notes helper, Reader"}')).toBeTruthy()
  })

  it('with no agent bound, says only what it destroys', () => {
    withParams()
    const { view } = sheet({ preview: preview({ agents: [] }) })
    expect(view.getByText('ConnectedAgents.DeleteMemoryBodyNoAgents {"count":12}')).toBeTruthy()
    expect(view.queryByText(/DeleteMemoryBody /)).toBeNull()
  })

  it('calls an agent with no name "an agent with no name" (UnnamedAgent)', () => {
    withParams()
    const { view } = sheet({ preview: preview({ agents: [NOTES, { subject: 'did:key:z6MkX', name: '' }] }) })
    expect(
      view.getByText(
        'ConnectedAgents.DeleteMemoryBody {"count":12,"agents":"Notes helper, ConnectedAgents.UnnamedAgent"}'
      )
    ).toBeTruthy()
  })

  it('warns when the preview is over the limit, naming the memory and the limit', () => {
    withParams()
    const { view } = sheet({ preview: preview({ count: counted(1240), overWarning: true }) })
    expect(
      view.getByText(`ConnectedAgents.MemoryCountWarning {"memory":"Healthcare","limit":${MEMORY_COUNT_WARNING}}`)
    ).toBeTruthy()
  })

  it('control: no warning when the preview is not over the limit, even at the limit', () => {
    const { view } = sheet({ preview: preview({ count: counted(MEMORY_COUNT_WARNING), overWarning: false }) })
    expect(view.queryByText('ConnectedAgents.MemoryCountWarning')).toBeNull()
  })

  it('looks like canvas frame 23: Delete filled in the danger red, Keep outlined in purple', () => {
    const { view } = sheet()
    const del = StyleSheet.flatten(view.getByTestId(id('DeleteMemoryConfirm')).props.style)
    const keep = StyleSheet.flatten(view.getByTestId(id('DeleteMemoryKeep')).props.style)
    expect(del).toMatchObject({ backgroundColor: AGENT_COLORS.danger })
    expect(del.borderWidth ?? 0).toBe(0)
    expect(keep).toMatchObject({ backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: AGENT_COLORS.primary })
  })

  it('with a preview it could not read, says so and offers Keep only', () => {
    const { view, props } = sheet({ preview: { ok: false, code: 'unreachable' } })
    expect(view.getByText('ConnectedAgents.FailUnreachable')).toBeTruthy()
    expect(view.queryByTestId(id('DeleteMemoryConfirm'))).toBeNull()
    expect(view.queryByText(/DeleteMemoryBody/)).toBeNull()
    fireEvent.press(view.getByTestId(id('DeleteMemoryKeep')))
    expect(props.onKeep).toHaveBeenCalledTimes(1)
  })

  it('treats a preview whose count failed as one it could not read: no count is stated', () => {
    const { view } = sheet({ preview: preview({ count: { ok: false } }) })
    expect(view.getByText('ConnectedAgents.FailUnreachable')).toBeTruthy()
    expect(view.queryByTestId(id('DeleteMemoryConfirm'))).toBeNull()
  })
})

describe('DeleteMemorySheet: Delete', () => {
  it('never calls onConfirm before Delete is pressed: not on opening, not on Keep', () => {
    const { view, props } = sheet()
    expect(props.onConfirm).not.toHaveBeenCalled()
    fireEvent.press(view.getByTestId(id('DeleteMemoryKeep')))
    expect(props.onKeep).toHaveBeenCalledTimes(1)
    expect(props.onConfirm).not.toHaveBeenCalled()
    expect(props.onDone).not.toHaveBeenCalled()
  })

  it('sends once while a delete is open: a second press sends nothing', async () => {
    let finish: (r: DeleteMemoryResult) => void = () => undefined
    const onConfirm = jest.fn(() => new Promise<DeleteMemoryResult>((resolve) => (finish = resolve)))
    const { view, props } = sheet({ onConfirm })
    fireEvent.press(view.getByTestId(id('DeleteMemoryConfirm')))
    fireEvent.press(view.getByTestId(id('DeleteMemoryConfirm')))
    await act(async () => undefined)
    fireEvent.press(view.getByTestId(id('DeleteMemoryConfirm')))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await act(async () => finish({ ok: true, recordsNotUpdated: 0 }))
    expect(props.onDone).toHaveBeenCalledTimes(1)
  })

  it('sends once even when two presses land in the same frame, before the button is disabled', async () => {
    // The disabled button holds the presses above; this calls the handler itself twice, as two taps delivered before
    // the re-render would, so it holds only through the guard inside the handler.
    const onConfirm = jest.fn(() => new Promise<DeleteMemoryResult>(() => undefined))
    const { view } = sheet({ onConfirm })
    const button = view.UNSAFE_getByProps({ testID: id('DeleteMemoryConfirm'), accessibilityRole: 'button' })
    await act(async () => {
      button.props.onPress()
      button.props.onPress()
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('control: once it answered "not reached", Delete sends again when pressed again', async () => {
    const onConfirm = answers({ ok: false, code: 'unreachable' })
    const { view } = sheet({ onConfirm })
    await pressDelete(view)
    await pressDelete(view)
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('deleted with every record updated: onDone, and nothing more on the sheet', async () => {
    const { view, props } = sheet({ onConfirm: answers({ ok: true, recordsNotUpdated: 0 }) })
    await pressDelete(view)
    expect(props.onDone).toHaveBeenCalledTimes(1)
    expect(props.onKeep).not.toHaveBeenCalled()
    expect(view.queryByTestId(id('DeleteMemoryOutcome'))).toBeNull()
  })

  it('deleted with records left: how many still list it, then Close (onDone), and no Delete', async () => {
    withParams()
    const { view, props } = sheet({ onConfirm: answers({ ok: true, recordsNotUpdated: 2 }) })
    await pressDelete(view)
    expect(props.onDone).not.toHaveBeenCalled()
    expect(view.getByTestId(id('DeleteMemoryOutcome'))).toHaveTextContent(
      'ConnectedAgents.DeleteMemoryRecordsLeft {"count":2}'
    )
    expect(view.queryByTestId(id('DeleteMemoryConfirm'))).toBeNull()
    fireEvent.press(view.getByLabelText('Global.Close'))
    expect(props.onDone).toHaveBeenCalledTimes(1)
  })

  it('held for approval: says why, and Close (onKeep) is the only button, never a retry', async () => {
    const { view, props } = sheet({ onConfirm: answers({ ok: false, code: 'heldForApproval' }) })
    await pressDelete(view)
    expect(view.getByTestId(id('DeleteMemoryOutcome'))).toHaveTextContent('ConnectedAgents.DeleteMemoryHeld')
    expect(view.queryByTestId(id('DeleteMemoryConfirm'))).toBeNull()
    expect(view.queryByText(/TryAgain/)).toBeNull()
    expect(view.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(['Global.Close'])
    fireEvent.press(view.getByLabelText('Global.Close'))
    expect(props.onKeep).toHaveBeenCalledTimes(1)
    expect(props.onDone).not.toHaveBeenCalled()
  })

  it('not reached: says nothing changed, with Delete still there', async () => {
    const { view, props } = sheet({ onConfirm: answers({ ok: false, code: 'unreachable' }) })
    await pressDelete(view)
    expect(view.getByTestId(id('DeleteMemoryOutcome'))).toHaveTextContent('ConnectedAgents.FailUnreachable')
    expect(view.getByTestId(id('DeleteMemoryConfirm'))).toBeTruthy()
    expect(view.getByTestId(id('DeleteMemoryKeep'))).toBeTruthy()
    expect(props.onDone).not.toHaveBeenCalled()
  })

  it('an onConfirm that throws is taken as not reached: nothing is claimed deleted', async () => {
    const onConfirm = jest.fn(async (): Promise<DeleteMemoryResult> => {
      throw new Error('boom')
    })
    const { view, props } = sheet({ onConfirm })
    await pressDelete(view)
    expect(view.getByTestId(id('DeleteMemoryOutcome'))).toHaveTextContent('ConnectedAgents.FailUnreachable')
    expect(props.onDone).not.toHaveBeenCalled()
  })
})

describe('the held words', () => {
  type Strings = Record<string, string>
  const words = (file: unknown) => (file as { ConnectedAgents: Strings }).ConnectedAgents

  it("never offer to try again when the owner's VTA holds a delete for approval, in any language", () => {
    // A retry is held the same way until the owner's rule changes (#1060 finding 20), the same pattern test as
    // components.test.tsx's for a held create.
    const retry: Array<[string, Strings, RegExp]> = [
      ['en', words(en), /try again/i],
      ['fr', words(fr), /réessa/i],
      ['pt-br', words(ptBr), /tente de novo|tentar de novo|tente novamente/i],
    ]
    for (const [lang, strings, pattern] of retry) {
      expect([lang, pattern.test(strings.DeleteMemoryHeld)]).toEqual([lang, false])
      // control: each pattern does match a failure that may well work on a retry.
      expect([lang, pattern.test(strings.MemoryCreateFailed)]).toEqual([lang, true])
    }
  })
})
