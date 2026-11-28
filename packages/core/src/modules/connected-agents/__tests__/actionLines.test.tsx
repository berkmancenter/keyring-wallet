/**
 * Agent connect, the lines an agent action's outcome leaves (ac's #1122 obligation 1): Extend, Restore, a pending
 * memory's retry, Remove, Keep it connected, and a memory widened or narrowed. Each failure has its own words, never a
 * generic line, and the line spends the action: it is drawn where the control was, and the control is not. Views
 * only: the map from an action's code to its line, and the containers that pass the lines, are the logic's.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { testIdWithKey } from '../../../utils/testable'
import { AgentActionLine, AgentActionLineKey, agentActionLineTone } from '../components/AgentActionNotice'
import { PickerMemory } from '../components/MemoryPicker'
import { PROPOSED_COPY } from '../proposedCopy'
import AgentDetailsView, { AgentDetailsData, AgentDetailsViewProps } from '../screens/AgentDetailsView'
import AgentListView, { AgentRowData } from '../screens/AgentListView'
import ChangeMemoriesView, { ChangeMemoriesViewProps } from '../screens/ChangeMemoriesView'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)
const words = (key: AgentActionLineKey) => `ConnectedAgents.${key}`

// Every key of the union, by a record the type checker holds to it: a key added to the union and not here, or here
// and not in the union, fails to compile.
const EVERY_KEY: Record<AgentActionLineKey, true> = {
  ActionGone: true,
  ActionNotOffered: true,
  ActionNotListed: true,
  ActionNotConfirmed: true,
  ActionNotApplied: true,
  RestoreLastMemory: true,
  ExtendNoCredential: true,
  RemoveNotAvailable: true,
  RemoveNotConfirmed: true,
  RemoveGoneUnproven: true,
  KeepNotSaved: true,
  KeepNotRecorded: true,
  KeepNoCredential: true,
}
const KEYS = Object.keys(EVERY_KEY) as AgentActionLineKey[]

describe("the action lines' words", () => {
  type Strings = Record<string, string>
  const EN = (en as unknown as { ConnectedAgents: Strings }).ConnectedAgents
  const FR = (fr as unknown as { ConnectedAgents: Strings }).ConnectedAgents
  const PT = (ptBr as unknown as { ConnectedAgents: Strings }).ConnectedAgents

  it('has every line in en, fr and pt-br, each a proposal until §6 quotes it', () => {
    for (const key of KEYS) {
      expect([key, typeof EN[key], typeof FR[key], typeof PT[key], key in PROPOSED_COPY]).toEqual([
        key,
        'string',
        'string',
        'string',
        true,
      ])
    }
  })

  it('tells a partly done action as a warning, and every other line as an error', () => {
    expect(KEYS.filter((k) => agentActionLineTone(k) === 'warn').sort()).toEqual(
      ['ExtendNoCredential', 'KeepNoCredential', 'KeepNotRecorded'].sort()
    )
  })

  it('never promises a later fix, never offers "Try again", and never says "nothing changed" of an unconfirmed send', () => {
    for (const key of KEYS) {
      expect([key, /try again|will check|later|soon/i.test(EN[key])]).toEqual([key, false])
    }
    // The line for "not reached, refused, or sent with no answer" must be true in all three.
    expect(EN.ActionNotConfirmed).not.toMatch(/nothing (was )?changed|couldn't reach/i)
    // control: the pattern bites on the words this rule replaced.
    expect(/nothing (was )?changed/i.test(EN.MemoryChangeFailed)).toBe(true)
  })
})

const row = (over: Partial<AgentRowData> = {}): AgentRowData => ({
  id: 'did:key:z6MkNotes',
  name: 'Notes helper',
  status: 'connectedUntil',
  until: '14:30',
  temporary: true,
  keyChanged: false,
  ...over,
})

describe('AgentDetailsView with action lines', () => {
  const EDU = { id: 'keyring-memory-aaaa', name: 'Education' }
  const agent = (over: Partial<AgentDetailsData> = {}): AgentDetailsData => ({
    ...row(),
    ownerName: 'Ada',
    memories: [EDU],
    pending: [],
    ...over,
  })
  const details = (over: Partial<AgentDetailsViewProps> = {}) => {
    const props: AgentDetailsViewProps = {
      agent: agent(),
      counts: { [EDU.id]: { count: 3, failed: false } },
      warnAbove: 1000,
      onChangeMemories: jest.fn(),
      onRestore: jest.fn(),
      onRetryPending: jest.fn(),
      onExtend: jest.fn(),
      onRemove: jest.fn(),
      onConnectAgain: jest.fn(),
      onKeepConnected: jest.fn(),
      ...over,
    }
    return { props, tree: show(<AgentDetailsView {...props} />) }
  }
  const line = (key: AgentActionLineKey): AgentActionLine => ({ key, name: 'Notes helper' })

  it('// control: with no lines, every control is drawn as before', () => {
    const { tree } = details({
      agent: agent({ pending: [{ id: 'keyring-memory-bbbb', name: 'Healthcare' }] }),
    })
    expect(tree.getByTestId(id('AgentDetailsExtend'))).toBeTruthy()
    expect(tree.getByTestId(id('AgentDetailsKeepConnected'))).toBeTruthy()
    expect(tree.getByTestId(id('AgentDetailsRetryPending'))).toBeTruthy()
    expect(tree.queryByTestId(id('AgentActionLine'))).toBeNull()
    expect(tree.queryByTestId(id('AgentDetailsExtendLine'))).toBeNull()
  })

  it("draws Extend's line in place of Extend: the line spends it", () => {
    const { tree } = details({ actionLines: { extend: line('ActionNotConfirmed') } })
    expect(tree.queryByTestId(id('AgentDetailsExtend'))).toBeNull()
    expect(tree.getByTestId(id('AgentDetailsExtendLine'))).toBeTruthy()
    expect(tree.getByText(words('ActionNotConfirmed'))).toBeTruthy()
  })

  it("draws Remove's line in place of Remove", () => {
    const { tree } = details({
      agent: agent({ status: 'expired', until: undefined }),
      actionLines: { remove: line('RemoveGoneUnproven') },
    })
    expect(tree.queryByTestId(id('AgentDetailsRemove'))).toBeNull()
    expect(tree.getByText(words('RemoveGoneUnproven'))).toBeTruthy()
    // Connect again is another action, and stays.
    expect(tree.getByTestId(id('AgentDetailsConnectAgain'))).toBeTruthy()
  })

  it("draws Keep it connected's line even once the agent is persistent, where the button is no longer offered", () => {
    const { tree } = details({
      agent: agent({ status: 'connected', temporary: false, until: undefined }),
      actionLines: { keepConnected: line('KeepNoCredential') },
    })
    expect(tree.queryByTestId(id('AgentDetailsKeepConnected'))).toBeNull()
    expect(tree.getByTestId(id('AgentDetailsKeepConnectedLine'))).toBeTruthy()
    expect(tree.getByText(words('KeepNoCredential'))).toBeTruthy()
  })

  it('takes Restore off the memory notice when Restore left a line, and keeps Revoke there', () => {
    const drift = { extra: [{ id: 'x', name: 'Finance' }], missing: [] }
    const { tree } = details({
      agent: agent({ drift }),
      onRevoke: jest.fn(),
      actionLines: { restore: line('RestoreLastMemory') },
    })
    expect(tree.queryByTestId(id('MemoryAccessRestore'))).toBeNull()
    expect(tree.getByTestId(id('MemoryAccessRevoke'))).toBeTruthy()
    expect(tree.getByText(words('RestoreLastMemory'))).toBeTruthy()
  })

  it('keeps §6\'s "Try again" on a pending memory unless the retry left a line', () => {
    const pending = [{ id: 'keyring-memory-bbbb', name: 'Healthcare' }]
    const spent = details({ agent: agent({ pending }), actionLines: { retryPending: line('ActionGone') } }).tree
    expect(spent.queryByTestId(id('AgentDetailsRetryPending'))).toBeNull()
    expect(spent.getByTestId(id('AgentDetailsRetryPendingLine'))).toBeTruthy()
    // The pending line itself stays: the memory is still not held.
    expect(spent.getByText('ConnectedAgents.PendingMemory')).toBeTruthy()
  })

  it('gives each action its own line: a line for one action takes away no other action', () => {
    const { tree } = details({ actionLines: { keepConnected: line('KeepNotSaved') } })
    expect(tree.getByTestId(id('AgentDetailsExtend'))).toBeTruthy()
  })
})

describe('AgentListView with action lines', () => {
  const list = (agents: AgentRowData[], actionLines?: React.ComponentProps<typeof AgentListView>['actionLines']) =>
    show(
      <AgentListView
        agents={agents}
        actionLines={actionLines}
        onOpen={jest.fn()}
        onConnect={jest.fn()}
        onExtend={jest.fn()}
        onRemove={jest.fn()}
        onConnectAgain={jest.fn()}
      />
    )

  it("draws a row's line in place of that row's action, and leaves the other rows as they are", () => {
    const other = row({ id: 'did:key:z6MkOther', name: 'Travel agent' })
    const tree = list([row(), other], {
      'did:key:z6MkNotes': { extend: { key: 'ActionNotListed', name: 'Notes helper' } },
    })
    expect(tree.getAllByTestId(id('AgentRowExtend'))).toHaveLength(1)
    expect(tree.getAllByTestId(id('AgentRowExtendLine'))).toHaveLength(1)
    expect(tree.getByText(words('ActionNotListed'))).toBeTruthy()
  })

  it('// control: with no lines, every row offers its actions', () => {
    const tree = list([row(), row({ id: 'b', name: 'Travel agent' })])
    expect(tree.getAllByTestId(id('AgentRowExtend'))).toHaveLength(2)
    expect(tree.queryByTestId(id('AgentRowExtendLine'))).toBeNull()
  })
})

describe('ChangeMemoriesView with a line', () => {
  const MEMORIES: PickerMemory[] = [
    { id: 'keyring-memory-aaaa', name: 'Education', containsOthers: false },
    { id: 'keyring-memory-cccc', name: 'Housing', containsOthers: false },
  ]
  const view = (over: Partial<ChangeMemoriesViewProps> = {}) => {
    const props: ChangeMemoriesViewProps = {
      agentName: 'Notes helper',
      memories: MEMORIES,
      current: ['keyring-memory-aaaa'],
      onCreateMemory: jest.fn(),
      confirm: jest.fn(async () => true),
      onWiden: jest.fn(async () => ({ ok: true as const })),
      onNarrow: jest.fn(async () => ({ ok: true as const })),
      ...over,
    }
    return { props, tree: show(<ChangeMemoriesView {...props} />) }
  }
  const rowFor = (tree: ReturnType<typeof show>, name: string) =>
    tree
      .getAllByTestId(id('MemoryPickerRow'), { includeHiddenElements: true })
      .find((r) => r.props.accessibilityLabel === name)!
  const widenHousing = async (tree: ReturnType<typeof show>) => {
    fireEvent.press(rowFor(tree, 'Housing'))
    await act(async () => {
      fireEvent.press(tree.getByTestId(id('ChangeMemoriesYes')))
    })
  }

  it('draws the result\'s line, and spends the change: "Allow" is gone and only "Not now" closes', async () => {
    const onWiden = jest.fn(async () => ({
      ok: false as const,
      code: 'notApplied',
      line: { key: 'ActionNotApplied' as const, name: 'Notes helper' },
    }))
    const { tree } = view({ onWiden })
    await widenHousing(tree)
    expect(tree.getByText(words('ActionNotApplied'))).toBeTruthy()
    expect(tree.queryByTestId(id('ChangeMemoriesYes'))).toBeNull()
    expect(tree.queryByTestId(id('ChangeMemoriesFailed'))).toBeNull()
    expect(onWiden).toHaveBeenCalledTimes(1)
    fireEvent.press(tree.getByTestId(id('ChangeMemoriesNo')))
    expect(tree.queryByTestId(id('ChangeMemoriesSheet'))).toBeNull()
  })

  it('says the VTA did not confirm a change whose call threw, and never "nothing changed"', async () => {
    const onWiden = jest.fn(async () => {
      throw new Error('socket closed')
    })
    const { tree } = view({ onWiden })
    await widenHousing(tree)
    expect(tree.getByText(words('ActionNotConfirmed'))).toBeTruthy()
    expect(tree.queryByText('ConnectedAgents.MemoryChangeFailed')).toBeNull()
  })

  it('// control: a failure with no line is drawn as before, until every caller passes one', async () => {
    const onWiden = jest.fn(async () => ({ ok: false as const, code: 'notApplied' }))
    const { tree } = view({ onWiden })
    await widenHousing(tree)
    expect(tree.getByText('ConnectedAgents.MemoryChangeFailed')).toBeTruthy()
    expect(tree.queryByTestId(id('ChangeMemoriesLine'))).toBeNull()
  })
})
