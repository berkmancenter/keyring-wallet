/**
 * Agent connect, the agents list and an agent's details as views (plan §6 "Agent list rows", "Agent bottom sheet and
 * agent details"; canvas frames 6, 6b, 11 in its no-room form and 11d). Views only: the routes and hooks are wired in a
 * later PR, and nothing here is reachable.
 */
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { AGENT_STATUSES } from '../components/AgentStatusChip'
import AgentDetailsView, { AgentDetailsData, AgentDetailsViewProps } from '../screens/AgentDetailsView'
import AgentListView, { AgentRowData, rowActions } from '../screens/AgentListView'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)

const row = (over: Partial<AgentRowData> = {}): AgentRowData => ({
  id: 'did:key:z6MkNotes',
  name: 'Notes helper',
  status: 'connectedUntil',
  until: '14:30',
  temporary: true,
  keyChanged: false,
  ...over,
})

describe('rowActions', () => {
  it('offers what each status allows (§6; #1060 findings 12 and 13)', () => {
    const offered = AGENT_STATUSES.map((status) => [status, rowActions(row({ status }))])
    expect(offered).toEqual([
      ['connected', ['extend', 'revoke']],
      ['connectedUntil', ['extend', 'revoke']],
      ['unreachable', ['extend', 'revoke']],
      ['expired', ['connectAgain', 'remove']],
      ['notFinished', ['remove']],
      ['revokeNotConfirmed', []],
      ['revoked', []],
    ])
  })

  it('never offers Extend to an agent that stays connected, nor to one whose key changed', () => {
    expect(rowActions(row({ status: 'connected', temporary: false }))).toEqual(['revoke'])
    expect(rowActions(row({ keyChanged: true }))).toEqual(['revoke'])
    // Control: a temporary agent with its own key is offered Extend.
    expect(rowActions(row())).toContain('extend')
  })

  it('never offers Extend to an expired agent: the VTA may have swept its entry', () => {
    expect(rowActions(row({ status: 'expired', temporary: true }))).not.toContain('extend')
  })
})

describe('AgentListView', () => {
  const list = (agents: AgentRowData[] | undefined, over: Partial<React.ComponentProps<typeof AgentListView>> = {}) => {
    const props = {
      agents,
      onOpen: jest.fn(),
      onConnect: jest.fn(),
      onExtend: jest.fn(),
      onRemove: jest.fn(),
      onConnectAgain: jest.fn(),
      ...over,
    }
    return { props, tree: show(<AgentListView {...props} />) }
  }

  it('waits while the agents are read, and always offers "Connect an agent"', () => {
    const { props, tree } = list(undefined)
    expect(tree.getByTestId(id('AgentListLoading'))).toBeTruthy()
    fireEvent.press(tree.getByTestId(id('AgentListConnect')))
    expect(props.onConnect).toHaveBeenCalledTimes(1)
  })

  it('draws a card per agent with its name and status in words, and opens the details on a tap', () => {
    const { props, tree } = list([row(), row({ id: 'b', name: 'Travel agent', status: 'expired', until: undefined })])
    expect(tree.getAllByTestId(id('AgentRow'))).toHaveLength(2)
    expect(tree.getByText('Notes helper')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.ConnectedUntil')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.StatusExpired')).toBeTruthy()
    fireEvent.press(tree.getAllByTestId(id('AgentRowOpen'))[1])
    expect(props.onOpen).toHaveBeenCalledWith('b')
  })

  it('shows no Revoke until step 7.10 passes it in, and then shows it', () => {
    const without = list([row()]).tree
    expect(without.queryByTestId(id('AgentRowRevoke'))).toBeNull()
    expect(without.getByTestId(id('AgentRowExtend'))).toBeTruthy()
    const onRevoke = jest.fn()
    const withIt = list([row()], { onRevoke }).tree
    fireEvent.press(withIt.getByTestId(id('AgentRowRevoke')))
    expect(onRevoke).toHaveBeenCalledWith('did:key:z6MkNotes')
  })

  it('offers Connect again and Remove on an expired agent, and Remove with its line on an unfinished one', () => {
    const { props, tree } = list([
      row({ id: 'x', status: 'expired', until: undefined }),
      row({ id: 'n', status: 'notFinished', until: undefined }),
    ])
    expect(tree.queryByTestId(id('AgentRowExtend'))).toBeNull()
    fireEvent.press(tree.getByTestId(id('AgentRowConnectAgain')))
    expect(props.onConnectAgain).toHaveBeenCalledWith('x')
    expect(tree.getByText('ConnectedAgents.NotFinishedLine')).toBeTruthy()
    fireEvent.press(tree.getAllByTestId(id('AgentRowRemove'))[1])
    expect(props.onRemove).toHaveBeenCalledWith('n')
  })

  it('says a changed key and a changed memory set on the row, the notice without its buttons', () => {
    const { tree } = list([row({ keyChanged: true, drift: { extra: [{ id: 'm', name: 'Work' }], missing: [] } })])
    expect(tree.getByText('ConnectedAgents.KeyChanged')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.MemoryAccessChanged')).toBeTruthy()
    expect(tree.queryByTestId(id('MemoryAccessRestore'))).toBeNull()
  })
})

describe('AgentDetailsView', () => {
  const EDU = { id: 'keyring-memory-aaaa', name: 'Education' }
  const HEALTH = { id: 'keyring-memory-bbbb', name: 'Healthcare' }
  const agent = (over: Partial<AgentDetailsData> = {}): AgentDetailsData => ({
    ...row(),
    ownerName: 'Ada',
    memories: [EDU, HEALTH],
    pending: [],
    ...over,
  })
  const details = (over: Partial<AgentDetailsViewProps> = {}) => {
    const props: AgentDetailsViewProps = {
      agent: agent(),
      counts: {
        [EDU.id]: { count: 214, lastChange: '24 November', failed: false },
        [HEALTH.id]: { count: 1240, lastChange: '26 November', rose: 830, failed: false },
      },
      warnAbove: 1000,
      onChangeMemories: jest.fn(),
      onRestore: jest.fn(),
      onRetryPending: jest.fn(),
      onExtend: jest.fn(),
      onRemove: jest.fn(),
      onConnectAgain: jest.fn(),
      ...over,
    }
    return { props, tree: show(<AgentDetailsView {...props} />) }
  }

  it('shows the name with the mark, whose agent it is, the status, the memories and the no-room lines', () => {
    const { tree } = details()
    expect(tree.getByText('Notes helper')).toBeTruthy()
    expect(tree.getByText('Rooms.AgentBadge')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.BelongsTo')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.ConnectedUntil')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.Memories')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.CanUseMemory')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.VtaKeepsItToThese')).toBeTruthy()
    // P0 has no rooms and the P1 lines wait for step 7.14.
    expect(tree.queryByText('ConnectedAgents.CanUseInEveryRoom')).toBeNull()
    expect(tree.queryByText(/MentionAs|AnswersOthers/)).toBeNull()
  })

  it('counts each memory, says a rise, and calls out a memory over the limit, and only that one', () => {
    const { tree } = details()
    expect(tree.getAllByText('ConnectedAgents.MemoryCount')).toHaveLength(2)
    expect(tree.getAllByText('ConnectedAgents.MemoryCountRose')).toHaveLength(1)
    expect(tree.getAllByTestId(id('AgentDetailsCountWarning'))).toHaveLength(1)
    // Control: at the limit exactly, no warning.
    const atLimit = details({
      counts: { [EDU.id]: { count: 1000, failed: false }, [HEALTH.id]: { count: 3, failed: false } },
    })
    expect(atLimit.tree.queryByTestId(id('AgentDetailsCountWarning'))).toBeNull()
  })

  it('says a count could not be made, and waits while they are counted', () => {
    const failed = details({ counts: { [EDU.id]: { failed: true }, [HEALTH.id]: { count: 3, failed: false } } }).tree
    expect(failed.getAllByText('ConnectedAgents.MemoryCountFailed')).toHaveLength(1)
    const waiting = details({ counts: undefined }).tree
    expect(waiting.queryByText('ConnectedAgents.MemoryCount')).toBeNull()
    expect(waiting.queryByText('ConnectedAgents.MemoryCountFailed')).toBeNull()
  })

  it('says "No memory." for an agent with none', () => {
    const { tree } = details({ agent: agent({ memories: [] }), counts: {} })
    expect(tree.getByText('ConnectedAgents.NoMemory')).toBeTruthy()
    expect(tree.queryByText('ConnectedAgents.CanUseMemory')).toBeNull()
  })

  it('says a memory not reached yet, with Try again', () => {
    const { props, tree } = details({ agent: agent({ pending: [HEALTH] }) })
    expect(tree.getByText('ConnectedAgents.PendingMemory')).toBeTruthy()
    fireEvent.press(tree.getByTestId(id('AgentDetailsRetryPending')))
    expect(props.onRetryPending).toHaveBeenCalledTimes(1)
  })

  it('shows a changed memory set with Restore, and Revoke only once 7.10 passes it', () => {
    const drift = { extra: [{ id: 'w', name: 'Work' }], missing: [] }
    const { props, tree } = details({ agent: agent({ drift }) })
    fireEvent.press(tree.getByTestId(id('MemoryAccessRestore')))
    expect(props.onRestore).toHaveBeenCalledTimes(1)
    expect(tree.queryByTestId(id('MemoryAccessRevoke'))).toBeNull()
    expect(tree.queryByTestId(id('AgentDetailsRevoke'))).toBeNull()
    const withRevoke = details({ agent: agent({ drift }), onRevoke: jest.fn() }).tree
    expect(withRevoke.getByTestId(id('MemoryAccessRevoke'))).toBeTruthy()
    expect(withRevoke.getByTestId(id('AgentDetailsRevoke'))).toBeTruthy()
  })

  it('offers Change memories and Extend on a temporary agent, and no Message or Keep it connected until passed', () => {
    const { props, tree } = details()
    fireEvent.press(tree.getByTestId(id('AgentDetailsChangeMemories')))
    fireEvent.press(tree.getByTestId(id('AgentDetailsExtend')))
    expect(props.onChangeMemories).toHaveBeenCalledTimes(1)
    expect(props.onExtend).toHaveBeenCalledTimes(1)
    expect(tree.queryByTestId(id('AgentDetailsMessage'))).toBeNull()
    expect(tree.queryByTestId(id('AgentDetailsKeepConnected'))).toBeNull()
    const later = details({ onMessage: jest.fn(), onKeepConnected: jest.fn() }).tree
    expect(later.getByTestId(id('AgentDetailsMessage'))).toBeTruthy()
    expect(later.getByTestId(id('AgentDetailsKeepConnected'))).toBeTruthy()
    // Control: an agent that stays connected is never offered "Keep it connected".
    const kept = details({
      agent: agent({ status: 'connected', temporary: false, until: undefined }),
      onKeepConnected: jest.fn(),
    })
    expect(kept.tree.queryByTestId(id('AgentDetailsKeepConnected'))).toBeNull()
  })

  it('offers Connect again and Remove on an expired agent, and no Change memories or Extend', () => {
    const { props, tree } = details({ agent: agent({ status: 'expired', until: undefined }) })
    expect(tree.queryByTestId(id('AgentDetailsExtend'))).toBeNull()
    expect(tree.queryByTestId(id('AgentDetailsChangeMemories'))).toBeNull()
    fireEvent.press(tree.getByTestId(id('AgentDetailsConnectAgain')))
    fireEvent.press(tree.getByTestId(id('AgentDetailsRemove')))
    expect(props.onConnectAgain).toHaveBeenCalledTimes(1)
    expect(props.onRemove).toHaveBeenCalledTimes(1)
  })
})
