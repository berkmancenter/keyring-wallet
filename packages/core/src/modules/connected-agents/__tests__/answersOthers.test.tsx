/**
 * Agent connect, "Answers other people" and the P1 lines in the details and the list (§3.13, §6; step 7.14; canvas
 * frames 12 to 16; backlog 3 Section B, part T3). Views only: the props are shaped as the seam gives
 * `useAnswersOthers(agentId)` and the record's `handle`, `persona` and `actNames`, and nothing here is reachable from
 * the app. The containers that call the hooks come once fb's logic part merges.
 *
 * Where a test needs the row and the confirmation together, it composes them here as the brief says the container
 * will ("onTurnOn opens the confirm sheet, whose "Turn on" calls set(true)"): a few lines of test code, not a hook, a
 * fake of one or a container in a shared file.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { readFileSync } from 'fs'
import path from 'path'
import React, { useState } from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { testIdWithKey } from '../../../utils/testable'
import { setAgentConnectEnabled } from '../agentConnectFlag'
import { isAgentRoomsEnabled, setAgentRoomsEnabled } from '../agentRoomsFlag'
import AnswersOthersRow, { AnswersOthersSetResult } from '../components/AnswersOthersRow'
import AgentDetailsView, { AgentDetailsViewProps } from '../screens/AgentDetailsView'
import AgentListView, { AgentListViewProps, AgentRowData } from '../screens/AgentListView'
import AnswersOthersConfirmSheet from '../screens/AnswersOthersConfirmSheet'
import ChangeMemoriesView from '../screens/ChangeMemoriesView'

import { answersRow, detailsAgent, listRow } from './fixtures/screenStatesAnswers'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)
const none = () => undefined

/** The row and its confirmation as the container composes them, over a `set` the test controls. */
const Composed: React.FC<{ value: boolean; set: (on: boolean) => Promise<AnswersOthersSetResult> }> = ({
  value,
  set,
}) => {
  const [asking, setAsking] = useState(false)
  const [notSaved, setNotSaved] = useState(false)
  const change = async (on: boolean) => {
    const result = await set(on)
    setNotSaved(result === 'notSaved')
    setAsking(false)
    return result
  }
  return (
    <>
      <AnswersOthersRow
        {...answersRow({ value, notSaved })}
        onTurnOn={() => setAsking(true)}
        onTurnOff={() => void change(false)}
      />
      {asking ? (
        <AnswersOthersConfirmSheet
          name="Notes helper"
          onTurnOn={() => change(true)}
          onKeepOff={() => setAsking(false)}
        />
      ) : null}
    </>
  )
}

const turn = (tree: ReturnType<typeof show>, on: boolean) =>
  fireEvent(tree.getByTestId(id('AnswersOthersSwitch')), 'valueChange', on)

describe('AnswersOthersRow and its confirmation', () => {
  it('turning on asks first, and only "Turn on" calls set(true)', async () => {
    const set = jest.fn(async () => 'saved' as const)
    const tree = show(<Composed value={false} set={set} />)
    expect(tree.queryByTestId(id('AnswersOnConfirm'))).toBeNull()
    turn(tree, true)
    expect(tree.getByTestId(id('AnswersOnConfirm'))).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.AnswersOnTitle')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.AnswersOnBody')).toBeTruthy()
    expect(set).not.toHaveBeenCalled()
    fireEvent.press(tree.getByTestId(id('AnswersOnTurnOn')))
    await waitFor(() => expect(set).toHaveBeenCalledWith(true))
    expect(set).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(tree.queryByTestId(id('AnswersOnConfirm'))).toBeNull())
  })

  it('"Keep it off" calls nothing and closes the confirmation', async () => {
    const set = jest.fn(async () => 'saved' as const)
    const tree = show(<Composed value={false} set={set} />)
    turn(tree, true)
    fireEvent.press(tree.getByTestId(id('AnswersOnKeepOff')))
    await act(async () => undefined)
    expect(set).not.toHaveBeenCalled()
    expect(tree.queryByTestId(id('AnswersOnConfirm'))).toBeNull()
    // control: the same row, turned on and confirmed, does call set(true).
    turn(tree, true)
    fireEvent.press(tree.getByTestId(id('AnswersOnTurnOn')))
    await waitFor(() => expect(set).toHaveBeenCalledWith(true))
  })

  it('turning off calls set(false) at once, with no confirmation', async () => {
    const set = jest.fn(async () => 'saved' as const)
    const tree = show(<Composed value={true} set={set} />)
    turn(tree, false)
    expect(tree.queryByTestId(id('AnswersOnConfirm'))).toBeNull()
    await waitFor(() => expect(set).toHaveBeenCalledWith(false))
    expect(set).toHaveBeenCalledTimes(1)
  })

  it('the row itself only reports the move: on to onTurnOn, off to onTurnOff', () => {
    const onTurnOn = jest.fn()
    const onTurnOff = jest.fn()
    const tree = show(<AnswersOthersRow {...answersRow({ onTurnOn, onTurnOff })} />)
    turn(tree, true)
    expect([onTurnOn.mock.calls.length, onTurnOff.mock.calls.length]).toEqual([1, 0])
    turn(tree, false)
    expect([onTurnOn.mock.calls.length, onTurnOff.mock.calls.length]).toEqual([1, 1])
  })

  it('keeps "Turn on" disabled while set(true) runs, and calls it once', async () => {
    let answer: (r: AnswersOthersSetResult) => void = () => undefined
    const onTurnOn = jest.fn(() => new Promise<AnswersOthersSetResult>((resolve) => (answer = resolve)))
    const onKeepOff = jest.fn()
    const tree = show(<AnswersOthersConfirmSheet name="Notes helper" onTurnOn={onTurnOn} onKeepOff={onKeepOff} />)
    // control: before the press, "Turn on" is enabled.
    expect(tree.getByTestId(id('AnswersOnTurnOn')).props.accessibilityState.disabled).toBe(false)
    fireEvent.press(tree.getByTestId(id('AnswersOnTurnOn')))
    fireEvent.press(tree.getByTestId(id('AnswersOnTurnOn')))
    await act(async () => undefined)
    expect(onTurnOn).toHaveBeenCalledTimes(1)
    expect(tree.getByTestId(id('AnswersOnTurnOn')).props.accessibilityState.disabled).toBe(true)
    expect(tree.getByTestId(id('AnswersOnKeepOff')).props.accessibilityState.disabled).toBe(true)
    await act(async () => answer('saved'))
    expect(tree.getByTestId(id('AnswersOnTurnOn')).props.accessibilityState.disabled).toBe(false)
    expect(onKeepOff).not.toHaveBeenCalled()
  })

  it('offered: false (a repair; its caller is fb\'s hook-check value in useAnswersOthers, D23) reads "Off" with no switch, and still the help and "What others see"', () => {
    // Stored On, not offered: the plugin will not act on On, so the row does not claim it.
    const tree = show(<AnswersOthersRow {...answersRow({ offered: false, value: true })} />)
    expect(tree.queryByTestId(id('AnswersOthersSwitch'))).toBeNull()
    expect(tree.getByTestId(id('AnswersOthersValue'))).toHaveTextContent('ConnectedAgents.AnswersOff')
    expect(tree.getByTestId(id('AnswersOthersHelp'))).toHaveTextContent('ConnectedAgents.AnswersOffHelp')
    expect(tree.getByTestId(id('WhatOthersSee'))).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.OthersReply')).toBeTruthy()
    // control: offered, the same stored value reads On, with its switch.
    tree.rerender(
      <BasicAppContext>
        <AnswersOthersRow {...answersRow({ offered: true, value: true })} />
      </BasicAppContext>
    )
    expect(tree.getByTestId(id('AnswersOthersSwitch')).props.value).toBe(true)
    expect(tree.getByTestId(id('AnswersOthersValue'))).toHaveTextContent('ConnectedAgents.AnswersOn')
    expect(tree.getByTestId(id('AnswersOthersHelp'))).toHaveTextContent('ConnectedAgents.AnswersOnHelp')
  })

  it('shows the pending and not-saved lines only when they are set', () => {
    const tree = show(<AnswersOthersRow {...answersRow({ pending: true, notSaved: true })} />)
    expect(tree.getByTestId(id('AnswersOthersPending'))).toHaveTextContent('ConnectedAgents.AnswersOthersPending')
    expect(tree.getByTestId(id('AnswersOthersNotSaved'))).toHaveTextContent('ConnectedAgents.AnswersOthersNotSaved')
    // control: with neither, neither line.
    tree.rerender(
      <BasicAppContext>
        <AnswersOthersRow {...answersRow()} />
      </BasicAppContext>
    )
    expect(tree.queryByTestId(id('AnswersOthersPending'))).toBeNull()
    expect(tree.queryByTestId(id('AnswersOthersNotSaved'))).toBeNull()
  })

  it("after 'notSaved' the switch is at its old value, with the line, and still usable", async () => {
    const set = jest.fn(async (): Promise<AnswersOthersSetResult> => 'notSaved')
    const tree = show(<Composed value={true} set={set} />)
    turn(tree, false)
    await waitFor(() => expect(tree.getByTestId(id('AnswersOthersNotSaved'))).toBeTruthy())
    expect(tree.getByTestId(id('AnswersOthersSwitch')).props.value).toBe(true)
    expect(tree.getByTestId(id('AnswersOthersValue'))).toHaveTextContent('ConnectedAgents.AnswersOn')
    // Not a refusal: the switch stays, and the next change is tried. control: it reaches set again.
    turn(tree, false)
    await waitFor(() => expect(set).toHaveBeenCalledTimes(2))
  })
})

describe('OthersReply', () => {
  // §3.13's table, read from the plan: | en | "…" |, and the same for fr and pt-br.
  const PLAN = readFileSync(path.resolve(__dirname, '../../../../../../docs/plans/agent-connect-plan.md'), 'utf8')
  const start = PLAN.indexOf('\n### 3.13 ')
  const SECTION = PLAN.slice(start, PLAN.indexOf('\n#', start + 1))
  const cell = (locale: string) => SECTION.match(new RegExp(`^\\| ${locale} \\| "(.+)" \\|$`, 'm'))?.[1]
  const word = (file: unknown) => (file as { ConnectedAgents: Record<string, string> }).ConnectedAgents.OthersReply

  it.each([
    ['en', en],
    ['fr', fr],
    ['pt-br', ptBr],
  ])("in %s equals §3.13's table cell for that language", (locale, file) => {
    expect(cell(locale)).toBeDefined()
    expect(word(file)).toBe(cell(locale))
  })

  it('reads the table, not anything (control)', () => {
    // control: the reader finds §3.13 and its en cell, and a language the table lacks has no cell.
    expect(start).toBeGreaterThan(0)
    expect(cell('en')).toContain("I'm an AI agent")
    expect(cell('de')).toBeUndefined()
    expect(word(fr)).not.toBe(cell('en'))
  })
})

// The details and the list, with the props a container gives only when isAgentRoomsEnabled() (backlog 3 Section B, T3
// "The containers"): the rule is restated here as the switches-off control's subject, not built in a shared file.
const detailsProps = (over: Partial<AgentDetailsViewProps> = {}): AgentDetailsViewProps => ({
  agent: detailsAgent(),
  counts: {},
  warnAbove: 1000,
  onChangeMemories: none,
  onRestore: none,
  onRetryPending: none,
  onExtend: none,
  onRemove: none,
  onConnectAgain: none,
  ...over,
})
const P1_DETAILS: Partial<AgentDetailsViewProps> = {
  handle: 'notes-helper-7f3k',
  persona: 'Ada',
  actNames: ['Education', 'Healthcare', 'Ada'],
  answersOthers: answersRow(),
}
const listProps = (agents: AgentRowData[]): AgentListViewProps => ({
  agents,
  onOpen: none,
  onConnect: none,
  onExtend: none,
  onRemove: none,
  onConnectAgain: none,
})
const LIST_ROWS = [listRow(), listRow({ id: 'c', name: 'Inbox triage', status: 'unreachable', until: undefined })]
const ANSWERS = [false, true]

describe('AgentDetailsView, the P1 lines', () => {
  it('with persona shows "Can use … in every room it is in" and one "every open room … as", not the no-room line', () => {
    const tree = show(<AgentDetailsView {...detailsProps(P1_DETAILS)} />)
    expect(tree.getAllByText('ConnectedAgents.CanUseInEveryRoom')).toHaveLength(1)
    expect(tree.getAllByText('ConnectedAgents.CanUseEveryRoomAs')).toHaveLength(1)
    expect(tree.queryByText('ConnectedAgents.CanUseMemory')).toBeNull()
    expect(tree.getByText('ConnectedAgents.MentionAs')).toBeTruthy()
    expect(tree.getByTestId(id('AnswersOthers'))).toBeTruthy()
  })

  it('without persona draws the no-room line and never "every room"', () => {
    const tree = show(<AgentDetailsView {...detailsProps({ ...P1_DETAILS, persona: undefined })} />)
    expect(tree.getByText('ConnectedAgents.CanUseMemory')).toBeTruthy()
    expect(tree.queryByText('ConnectedAgents.CanUseInEveryRoom')).toBeNull()
    expect(tree.queryByText('ConnectedAgents.CanUseEveryRoomAs')).toBeNull()
  })

  it("names every context in act, the persona's included, and the persona by name", () => {
    // The shared i18n mock returns the key alone; here it also shows the values, to read the names drawn.
    const t = (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key)
    // jest.config.js maps react-i18next to that mock file, so require() gives the very module the views read.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mocked = require('react-i18next') as { useTranslation: () => unknown }
    const shared = mocked.useTranslation
    mocked.useTranslation = () => ({ t, i18n: { language: 'en', t } })
    try {
      const tree = show(<AgentDetailsView {...detailsProps(P1_DETAILS)} />)
      expect(
        tree.getByText(`ConnectedAgents.CanUseInEveryRoom ${JSON.stringify({ names: 'Education, Healthcare, Ada' })}`)
      ).toBeTruthy()
      expect(tree.getByText(`ConnectedAgents.CanUseEveryRoomAs ${JSON.stringify({ persona: 'Ada' })}`)).toBeTruthy()
      expect(
        tree.getByText(`ConnectedAgents.MentionAs ${JSON.stringify({ handle: 'notes-helper-7f3k' })}`)
      ).toBeTruthy()
      // control: the bound memories alone are not what the room line names when act holds more.
      expect(
        tree.queryByText(`ConnectedAgents.CanUseInEveryRoom ${JSON.stringify({ names: 'Education, Healthcare' })}`)
      ).toBeNull()
    } finally {
      mocked.useTranslation = shared
    }
  })
})

describe('AgentListView, the P1 line', () => {
  it('shows "Answers other people: Off" and "On" under the status, by the row', () => {
    const tree = show(<AgentListView {...listProps(LIST_ROWS.map((r, i) => ({ ...r, answersOthers: ANSWERS[i] })))} />)
    const lines = tree.getAllByTestId(id('AgentRowAnswersOthers'))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toHaveTextContent('ConnectedAgents.AnswersOthersOffLine')
    expect(lines[1]).toHaveTextContent('ConnectedAgents.AnswersOthersOnLine')
  })
})

describe('ChangeMemoriesView, the widening body', () => {
  it('is WidenBody in every case: there is no rooms form (removed by #1124, ruling 6)', () => {
    const tree = show(
      <ChangeMemoriesView
        agentName="Notes helper"
        memories={[
          { id: 'keyring-memory-aaaa', name: 'Education', containsOthers: false },
          { id: 'keyring-memory-cccc', name: 'Housing', containsOthers: false },
        ]}
        current={['keyring-memory-aaaa']}
        onCreateMemory={jest.fn()}
        confirm={async () => false}
        onWiden={jest.fn()}
        onNarrow={jest.fn()}
      />
    )
    const housing = tree
      .getAllByTestId(id('MemoryPickerRow'), { includeHiddenElements: true })
      .find((r) => r.props.accessibilityLabel === 'Housing')!
    fireEvent.press(housing)
    expect(tree.getByText('ConnectedAgents.WidenBody')).toBeTruthy()
    // The rooms form would list only the rooms the agent was added to, which ruling 6 makes false; its key is gone.
    expect('WidenBodyRooms' in (en as unknown as { ConnectedAgents: object }).ConnectedAgents).toBe(false)
    // control: the key reader sees a key that is there.
    expect('WidenBody' in (en as unknown as { ConnectedAgents: object }).ConnectedAgents).toBe(true)
  })
})

describe('with the switches off, the details and the list are as on the tip', () => {
  // What the container passes: the P1 props only when isAgentRoomsEnabled().
  const gatedDetails = () => (isAgentRoomsEnabled() ? P1_DETAILS : {})
  const gatedRows = () => LIST_ROWS.map((r, i) => (isAgentRoomsEnabled() ? { ...r, answersOthers: ANSWERS[i] } : r))
  const drawn = () => {
    const details = show(<AgentDetailsView {...detailsProps(gatedDetails())} />)
    const list = show(<AgentListView {...listProps(gatedRows())} />)
    return { details, list }
  }
  // The rendered trees as text: the handlers are new functions on each render, and only what is drawn is compared.
  const text = (tree: { toJSON: () => unknown }) => JSON.stringify(tree.toJSON())
  const tip = () => ({
    details: text(show(<AgentDetailsView {...detailsProps()} />)),
    list: text(show(<AgentListView {...listProps(LIST_ROWS)} />)),
  })
  const noP1 = ({ details, list }: ReturnType<typeof drawn>) => {
    expect(details.queryByText('ConnectedAgents.MentionAs')).toBeNull()
    expect(details.queryByTestId(id('AnswersOthers'))).toBeNull()
    expect(details.queryByText('ConnectedAgents.CanUseInEveryRoom')).toBeNull()
    expect(details.queryByText('ConnectedAgents.CanUseEveryRoomAs')).toBeNull()
    expect(details.getByText('ConnectedAgents.CanUseMemory')).toBeTruthy()
    expect(list.queryByTestId(id('AgentRowAnswersOthers'))).toBeNull()
    expect({ details: text(details), list: text(list) }).toEqual(tip())
  }

  afterEach(() => {
    setAgentRoomsEnabled(false)
    setAgentConnectEnabled(false)
  })

  it('with both switches off', () => {
    noP1(drawn())
  })

  it('with agent connect on and the rooms switch off', () => {
    setAgentConnectEnabled(true)
    noP1(drawn())
  })

  it('with the rooms switch on and agent connect off', () => {
    setAgentRoomsEnabled(true)
    noP1(drawn())
  })

  it('control: with both on, the P1 lines are drawn, so the checks above can fail', () => {
    setAgentConnectEnabled(true)
    setAgentRoomsEnabled(true)
    const { details, list } = drawn()
    expect(details.getByText('ConnectedAgents.MentionAs')).toBeTruthy()
    expect(details.getByTestId(id('AnswersOthers'))).toBeTruthy()
    expect(list.getAllByTestId(id('AgentRowAnswersOthers'))).toHaveLength(2)
    expect({ details: text(details), list: text(list) }).not.toEqual(tip())
  })
})
