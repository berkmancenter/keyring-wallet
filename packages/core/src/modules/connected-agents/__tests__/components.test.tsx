/**
 * Agent connect, the pieces the 7.7 screens share (plan §6; the UI/UX canvas, D41): the agent's contact card and its
 * token, the status chip, the memory picker and the memory-access notice; and the ConnectedAgents.* words in en, fr
 * and pt-br, with the proposals the plan does not have yet listed in PROPOSED_COPY.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { StyleSheet } from 'react-native'
import { container } from 'tsyringe'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { TOKENS } from '../../../container-api'
import { MainContainer } from '../../../container-impl'
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { testIdWithKey } from '../../../utils/testable'
import AgentContactCard from '../components/AgentContactCard'
import { AGENT_STATUSES, AgentStatusChip } from '../components/AgentStatusChip'
import MemoryAccessNotice from '../components/MemoryAccessNotice'
import MemoryPicker, { CreateMemoryResult, PickerMemory } from '../components/MemoryPicker'
import { PROPOSED_COPY } from '../proposedCopy'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)

type Strings = Record<string, string>
const EN = (en as unknown as { ConnectedAgents: Strings }).ConnectedAgents
const FR = (fr as unknown as { ConnectedAgents: Strings }).ConnectedAgents
const PT = (ptBr as unknown as { ConnectedAgents: Strings }).ConnectedAgents
const placeholders = (text: string) => (text.match(/{{\s*\w+\s*}}/g) ?? []).map((p) => p.replace(/\s/g, '')).sort()

describe('ConnectedAgents words', () => {
  it('has every key in fr and pt-br, with the same placeholders, and nothing else', () => {
    expect(Object.keys(EN).length).toBeGreaterThan(90)
    for (const other of [FR, PT]) {
      expect(Object.keys(other).sort()).toEqual(Object.keys(EN).sort())
      for (const key of Object.keys(EN)) {
        expect([key, placeholders(other[key])]).toEqual([key, placeholders(EN[key])])
        expect(other[key].trim()).not.toBe('')
      }
    }
  })

  it('lists every proposal it carries, and lists none it does not carry', () => {
    for (const key of Object.keys(PROPOSED_COPY)) expect([key, key in EN]).toEqual([key, true])
    // Control: a key the plan does define is not a proposal.
    expect('ApproveOwnTerminal' in PROPOSED_COPY).toBe(false)
    expect(EN.ApproveOwnTerminal).toBe('Only continue if you ran the command in your own terminal just now.')
  })

  it('keeps the plan copy rules: no "instant", "encrypted", "private" or "no trace" (§6, §7.10)', () => {
    const banned = /\binstant|\bencrypt|\bprivate\b|\bno trace\b/i
    const hits = Object.entries(EN).filter(([, text]) => banned.test(text))
    expect(hits).toEqual([])
    // Control: the pattern does bite.
    expect(banned.test('Revoking is instant.')).toBe(true)
  })

  it('carries the §6 words for the number step in both forms, picked by the digit count', () => {
    expect(EN.NumberBodyTwoDigits).toBe('Type the two digits your terminal shows. You get one try.')
    expect(EN.NumberBodyFourDigits).toBe('Type the four digits your terminal shows. You get one try.')
  })
})

describe('AgentContactCard', () => {
  it('is the token the container registers', () => {
    const main = new MainContainer(container.createChildContainer()).init()
    expect(main.resolve(TOKENS.COMPONENT_AGENT_CONTACT_CARD)).toBe(AgentContactCard)
  })

  it('draws the name, the mark, "Your AI agent", a dashed edge and no badge, and says "AI agent" aloud', () => {
    const onPress = jest.fn()
    const tree = show(<AgentContactCard name="Notes helper" onPress={onPress} />)
    const card = tree.getByTestId(id('AgentContactCard'))
    expect(tree.getByText('Notes helper')).toBeTruthy()
    expect(tree.getByText('Rooms.AgentBadge')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.YourAgent')).toBeTruthy()
    expect(card.props.accessibilityLabel).toContain('Rooms.AgentBadge')
    expect(StyleSheet.flatten(card.props.style).borderStyle).toBe('dashed')
    expect(tree.queryByTestId('WitnessVerifiedBadge')).toBeNull()
    expect(tree.queryByTestId(id('ContactAvatarImage'))).toBeNull()
    fireEvent.press(card)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('takes a second line in place of "Your AI agent"', () => {
    const tree = show(<AgentContactCard name="Notes helper" subtitle="See you at nine" onPress={jest.fn()} />)
    expect(tree.getByText('See you at nine')).toBeTruthy()
    expect(tree.queryByText('ConnectedAgents.YourAgent')).toBeNull()
  })
})

describe('AgentStatusChip', () => {
  it('says each of the seven statuses in words', () => {
    const words = AGENT_STATUSES.map((status) => {
      const tree = show(
        status === 'connectedUntil' ? (
          <AgentStatusChip status={status} until="14:30" />
        ) : (
          <AgentStatusChip status={status} />
        )
      )
      return tree.getByTestId(id('AgentStatusChip')).props.accessibilityLabel
    })
    expect(words).toEqual([
      'ConnectedAgents.StatusConnected',
      'ConnectedAgents.ConnectedUntil',
      'ConnectedAgents.StatusUnreachable',
      'ConnectedAgents.StatusExpired',
      'ConnectedAgents.StatusNotFinished',
      'ConnectedAgents.StatusRevokeNotConfirmed',
      'ConnectedAgents.StatusRevoked',
    ])
  })

  it('says a temporary agent with its end time', () => {
    // The end time is required by AgentStatusChipProps for connectedUntil; tsc checks that at every call site in
    // src/ (test files are outside the package's tsconfig, so this file cannot hold the type-level case itself).
    const tree = show(<AgentStatusChip status="connectedUntil" until="14:30" />)
    expect(tree.getByText('ConnectedAgents.ConnectedUntil')).toBeTruthy()
    expect(tree.queryByText('ConnectedAgents.StatusConnected')).toBeNull()
  })
})

describe('MemoryPicker', () => {
  const MEMORIES: PickerMemory[] = [
    { id: 'keyring-memory-aaaa', name: 'Education', containsOthers: false },
    { id: 'keyring-memory-bbbb', name: 'Healthcare', containsOthers: false },
    { id: 'keyring-memory-cccc', name: 'Work', containsOthers: true },
  ]

  const Harness: React.FC<{ onCreate: (name: string) => Promise<CreateMemoryResult>; start?: string[] }> = ({
    onCreate,
    start = [],
  }) => {
    const [selected, setSelected] = React.useState<string[]>(start)
    const [memories, setMemories] = React.useState(MEMORIES)
    return (
      <MemoryPicker
        memories={memories}
        selected={selected}
        onToggle={(memoryId) =>
          setSelected((s) => (s.includes(memoryId) ? s.filter((x) => x !== memoryId) : [...s, memoryId]))
        }
        onCreate={async (name) => {
          const result = await onCreate(name)
          if (result.ok) setMemories((m) => [...m, result.memory])
          return result
        }}
      />
    )
  }

  const rows = (tree: ReturnType<typeof show>) => tree.getAllByTestId(id('MemoryPickerRow'))

  it('shows each memory by name as a checkbox and toggles it; nothing picked is allowed', () => {
    const tree = show(<Harness onCreate={jest.fn()} start={['keyring-memory-aaaa']} />)
    expect(rows(tree).map((r) => [r.props.accessibilityLabel, r.props.accessibilityState.checked])).toEqual([
      ['Education', true],
      ['Healthcare', false],
      ['Work, ConnectedAgents.ContainsOtherMemories', false],
    ])
    fireEvent.press(rows(tree)[0])
    expect(rows(tree)[0].props.accessibilityState.checked).toBe(false)
    expect(tree.queryByText(/keyring-memory-/)).toBeNull()
  })

  it('greys a memory that contains others and does not let it be picked', () => {
    const tree = show(<Harness onCreate={jest.fn()} />)
    const work = rows(tree)[2]
    expect(work.props.accessibilityState.disabled).toBe(true)
    fireEvent.press(work)
    expect(rows(tree)[2].props.accessibilityState.checked).toBe(false)
    // Control: a plain memory does get picked by the same press.
    fireEvent.press(rows(tree)[1])
    expect(rows(tree)[1].props.accessibilityState.checked).toBe(true)
  })

  it('creates a memory from "New memory" and picks it', async () => {
    const onCreate = jest.fn(
      async (name: string): Promise<CreateMemoryResult> => ({
        ok: true,
        memory: { id: 'keyring-memory-dddd', name, containsOthers: false },
      })
    )
    const tree = show(<Harness onCreate={onCreate} />)
    expect(tree.queryByTestId(id('MemoryPickerName'))).toBeNull()
    fireEvent.press(tree.getByTestId(id('MemoryPickerNew')))
    const create = tree.getByTestId(id('MemoryPickerCreate'))
    expect(create.props.accessibilityState.disabled).toBe(true)
    fireEvent.changeText(tree.getByTestId(id('MemoryPickerName')), '  Housing ')
    fireEvent.press(tree.getByTestId(id('MemoryPickerCreate')))
    await waitFor(() => expect(tree.queryByTestId(id('MemoryPickerName'))).toBeNull())
    expect(onCreate).toHaveBeenCalledWith('Housing')
    const housing = rows(tree).find((r) => r.props.accessibilityLabel === 'Housing')
    expect(housing?.props.accessibilityState.checked).toBe(true)
  })

  it('refuses a name already taken without asking the VTA', async () => {
    const onCreate = jest.fn()
    const tree = show(<Harness onCreate={onCreate} />)
    fireEvent.press(tree.getByTestId(id('MemoryPickerNew')))
    fireEvent.changeText(tree.getByTestId(id('MemoryPickerName')), 'Healthcare')
    fireEvent.press(tree.getByTestId(id('MemoryPickerCreate')))
    expect(tree.getByText('ConnectedAgents.MemoryNameTaken')).toBeTruthy()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it.each([
    [
      'the logic says the name is taken',
      { ok: false, code: 'duplicateName' } as const,
      'ConnectedAgents.MemoryNameTaken',
    ],
    ['the logic says it failed', { ok: false, code: 'failed' } as const, 'ConnectedAgents.MemoryCreateFailed'],
  ])('says why when %s, and creates nothing', async (_, result, words) => {
    const tree = show(<Harness onCreate={async () => result} />)
    fireEvent.press(tree.getByTestId(id('MemoryPickerNew')))
    fireEvent.changeText(tree.getByTestId(id('MemoryPickerName')), 'Housing')
    fireEvent.press(tree.getByTestId(id('MemoryPickerCreate')))
    await waitFor(() => expect(tree.getByText(words)).toBeTruthy())
    expect(rows(tree)).toHaveLength(3)
  })

  it('says it failed when the create throws', async () => {
    const tree = show(<Harness onCreate={() => Promise.reject(new Error('offline'))} />)
    fireEvent.press(tree.getByTestId(id('MemoryPickerNew')))
    fireEvent.changeText(tree.getByTestId(id('MemoryPickerName')), 'Housing')
    fireEvent.press(tree.getByTestId(id('MemoryPickerCreate')))
    await waitFor(() => expect(tree.getByText('ConnectedAgents.MemoryCreateFailed')).toBeTruthy())
  })
})

describe('MemoryAccessNotice', () => {
  const EDU = { id: 'keyring-memory-aaaa', name: 'Education' }
  const HEALTH = { id: 'keyring-memory-bbbb', name: 'Healthcare' }

  it('draws nothing when the entry matches', () => {
    const tree = show(<MemoryAccessNotice extra={[]} missing={[]} onRestore={jest.fn()} />)
    expect(tree.queryByTestId(id('MemoryAccessNotice'))).toBeNull()
  })

  it('says its access changed when the entry names more, with Restore', () => {
    const onRestore = jest.fn()
    const tree = show(<MemoryAccessNotice extra={[EDU]} missing={[]} onRestore={onRestore} />)
    expect(tree.getByText('ConnectedAgents.MemoryAccessChanged')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.MemoryAccessChangedLine')).toBeTruthy()
    expect(tree.queryByText('ConnectedAgents.LostAccessTo')).toBeNull()
    fireEvent.press(tree.getByTestId(id('MemoryAccessRestore')))
    expect(onRestore).toHaveBeenCalledTimes(1)
    // Revoke is step 7.10's: no button until it is passed in.
    expect(tree.queryByTestId(id('MemoryAccessRevoke'))).toBeNull()
  })

  it('says "Lost access to" when the entry names fewer', () => {
    const tree = show(<MemoryAccessNotice extra={[]} missing={[HEALTH]} onRevoke={jest.fn()} />)
    expect(tree.getByText('ConnectedAgents.LostAccessTo')).toBeTruthy()
    expect(tree.queryByText('ConnectedAgents.MemoryAccessChanged')).toBeNull()
    expect(tree.getByTestId(id('MemoryAccessRevoke'))).toBeTruthy()
  })

  it('leaves the buttons off the list row', () => {
    const tree = show(<MemoryAccessNotice extra={[EDU]} missing={[]} onRestore={jest.fn()} compact />)
    expect(tree.getByText('ConnectedAgents.MemoryAccessChanged')).toBeTruthy()
    expect(tree.queryByTestId(id('MemoryAccessRestore'))).toBeNull()
  })
})
