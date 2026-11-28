/**
 * Agent connect, the pieces the 7.7 screens share (plan §6; the UI/UX canvas, D41): the agent's contact card and its
 * token, the status chip, the memory picker and the memory-access notice; and the ConnectedAgents.* words in en, fr
 * and pt-br, with the proposals the plan does not have yet listed in PROPOSED_COPY.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
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
import { NO_ROOM_FORMS, PROPOSED_COPY, SETTLED_ELSEWHERE } from '../proposedCopy'

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

  // The plan's §6 is the source: a string it quotes is settled, one it does not is a proposal (or a no-room cut of a
  // settled one). Derived, not kept by hand, so the list cannot drift from the plan in either direction.
  const PLAN = readFileSync(path.resolve(__dirname, '../../../../../../docs/plans/agent-connect-plan.md'), 'utf8')
  const SECTION_6 = PLAN.slice(PLAN.indexOf('\n## 6. UX'), PLAN.indexOf('\n## 7. Steps'))
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // "{{name}}" in a locale string is "<name>" (or "<n>", "<time>") in the plan's prose, and "{{name}}" itself in its
  // key list, which quotes the i18n strings as they are written.
  const asPlan = (text: string) =>
    text
      .split(/{{\s*\w+\s*}}/)
      .map(escape)
      .join('(?:<[^>"]+>|\\{\\{\\s*\\w+\\s*\\}\\})')
  // The plan's prose names i18next's {{count}} "<n>"; every other placeholder keeps its name. Measured over §6: "n" is
  // the only name that differs.
  // An entry is a measured fact about the plan, not an exemption: a new one needs the same enumeration (every settled
  // string's slot names against §6's), and a test below fails any entry no settled string needs.
  const PLAN_NAME_ALIAS: Readonly<Record<string, string>> = { n: 'count' }
  const placeholderNames = (text: string) => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1])
  /**
   * Quoted in `section` with the same words AND the same placeholder names in the same order (after the alias), so a
   * string whose plan line has "<time>" where it has "{{name}}" does not read as settled.
   */
  const quotedIn = (section: string, text: string, alias: Readonly<Record<string, string>> = PLAN_NAME_ALIAS) => {
    const names = placeholderNames(text)
    const capture = text
      .split(/{{\s*\w+\s*}}/)
      .map(escape)
      .join('(?:<([^>"]+)>|\\{\\{\\s*(\\w+)\\s*\\}\\})')
    return [...section.matchAll(new RegExp(`"${capture}"`, 'g'))].some((m) => {
      const found = names.map((_, i) => m[1 + 2 * i] ?? m[2 + 2 * i])
      return found.every((name, i) => (alias[name] ?? name) === names[i])
    })
  }
  const quotedIn6 = (text: string) => quotedIn(SECTION_6, text)
  const partOf6 = (text: string) => new RegExp(asPlan(text)).test(SECTION_6)
  // A plural's "_one" stands or falls with its "_other", which is the form the plan quotes.
  const settled = (key: string) => quotedIn6(EN[key.endsWith('_one') ? `${key.slice(0, -4)}_other` : key])

  it('reads the plan: §6 is found and quotes the words it is known to quote', () => {
    expect(SECTION_6.length).toBeGreaterThan(10000)
    expect(settled('ApproveOwnTerminal')).toBe(true)
    // Control: a proposal's words are not in §6, and a key word-for-word in §6 inside a longer string is not "quoted".
    // The control's subject is a string still proposed. Guarded first, so the day none is left (or this one settles)
    // the failure is here and says so ("Received array" without it), not a confusing one below: repoint it then.
    expect(Object.keys(PROPOSED_COPY)).toContain('MemoryChangeFailed')
    expect(settled('MemoryChangeFailed')).toBe(false)
    // Control that never runs out: a sentence the plan does not say is not settled, and a settled key reads true.
    expect(settled('SeeDetails')).toBe(true)
    expect(quotedIn6('Keyring never says this sentence anywhere.')).toBe(false)
    expect(quotedIn6('It will be able to read and change it.')).toBe(false)
  })

  it('binds placeholder names, not only words: a plan line with another placeholder name does not settle a string', () => {
    // §6 quotes "Connected until <time>": the same words with a different name are not that line.
    expect(quotedIn6(EN.ConnectedUntil)).toBe(true)
    expect(quotedIn6('Connected until {{owner}}')).toBe(false)
    // The one alias: the prose's "<n>" is i18next's {{count}}.
    expect(quotedIn6(EN.MemoryCountRose)).toBe(true)
    expect(quotedIn6('Up {{total}} since you last looked.')).toBe(false)
  })

  it('keeps no alias that no settled string needs', () => {
    const unneeded = Object.keys(PLAN_NAME_ALIAS).filter((planName) => {
      const without = Object.fromEntries(Object.entries(PLAN_NAME_ALIAS).filter(([k]) => k !== planName))
      // Needed: some string is quoted in §6 with the full map and not without this entry.
      return !Object.values(EN).some((text) => quotedIn(SECTION_6, text) && !quotedIn(SECTION_6, text, without))
    })
    expect(unneeded).toEqual([])
  })

  it('carries no words that are neither in the plan nor listed as a proposal', () => {
    const unlisted = Object.keys(EN).filter(
      (key) => !settled(key) && !(key in PROPOSED_COPY) && !(key in NO_ROOM_FORMS) && !(key in SETTLED_ELSEWHERE)
    )
    expect(unlisted).toEqual([])
  })

  it('lists no proposal the plan has since settled, and none it does not carry', () => {
    for (const key of Object.keys(PROPOSED_COPY)) expect([key, key in EN, settled(key)]).toEqual([key, true, false])
  })

  it('finds each string settled elsewhere quoted in the section it names, and not in §6', () => {
    // A section runs from its "### 3.15" heading to the next heading.
    const section = (number: string) => {
      const start = PLAN.indexOf(`\n### ${number.replace('§', '')} `)
      return start < 0 ? '' : PLAN.slice(start, PLAN.indexOf('\n#', start + 1))
    }
    for (const [key, where] of Object.entries(SETTLED_ELSEWHERE)) {
      const quoted = quotedIn(section(where), EN[key])
      expect([key, where, quoted, settled(key), key in PROPOSED_COPY]).toEqual([key, where, true, false, false])
    }
    // Control: the section reader finds §3.15 and not a string it lacks.
    expect(section('§3.15')).toContain('Memories: a fixed set per agent')
    expect(new RegExp(`"${asPlan(EN.SeeDetails)}"`).test(section('§3.15'))).toBe(false)
  })

  it('keeps each no-room form a cut of a §6 string', () => {
    for (const key of Object.keys(NO_ROOM_FORMS))
      expect([key, settled(key), partOf6(EN[key])]).toEqual([key, false, true])
  })

  // Global flag: use it with matchAll only, which clones it. A .test() or .exec() on this shared regex would start
  // from the last match's index and silently miss.
  const REACHES_MODULE = /(?:from|require\(|import\()\s*['"]([^'"]*connected-agents(?:\/[^'"]*)?)['"]/g
  it('finds every way a file can reach the module, so the next test cannot pass by missing one', () => {
    const found = (text: string) => [...text.matchAll(REACHES_MODULE)].map((m) => m[1])
    expect(found(`import x from '../connected-agents/components/AgentMark'`)).toEqual([
      '../connected-agents/components/AgentMark',
    ])
    expect(found(`import x from '../connected-agents'`)).toEqual(['../connected-agents'])
    expect(found(`const x = require("../../connected-agents/pairing")`)).toEqual(['../../connected-agents/pairing'])
    expect(found(`const x = await import('../connected-agents/screens/ApproveView')`)).toEqual([
      '../connected-agents/screens/ApproveView',
    ])
    // Control: a name that only starts the same is not the module.
    expect(found(`import x from '../connected-agents-old/thing'`)).toEqual([])
  })

  it('is reachable from nowhere yet: only the container and the flag reach into the module', () => {
    // Until the screens are wired (S2 onwards), the proposed words cannot show: no screen, navigator or hook outside
    // the module imports it, and only the container names the agent card's token.
    const src = path.resolve(__dirname, '../../..')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) {
          if (name !== '__tests__' && full !== path.join(src, 'modules', 'connected-agents')) walk(full)
        } else if (/\.tsx?$/.test(name)) files.push(full)
      }
    }
    walk(src)
    const reaches = files.flatMap((file) =>
      // A static import, a require() and a dynamic import(), of a file in the module or of the module as a whole.
      [...readFileSync(file, 'utf8').matchAll(REACHES_MODULE)].map(
        (m) => `${path.relative(src, file)} -> ${m[1].replace(/^.*connected-agents\/?/, '') || '(index)'}`
      )
    )
    expect(reaches.sort()).toEqual([
      'container-impl.ts -> components/AgentContactCard',
      // The build setting (agentConnectBuild.ts), exported for the Developer screen to hide the switch rows: a switch,
      // like agentConnectFlag, with no words.
      'index.ts -> agentConnectBuild',
      'modules/rooms/roomLinks.ts -> agentConnectFlag',
      'modules/trust-tasks/module/triggerLink.ts -> agentConnectFlag',
      'modules/trust-tasks/module/vtiLinks.ts -> agentConnectFlag',
      'modules/vrc/screens/ListContacts.tsx -> ConnectedAgentsProvider',
      'modules/vrc/screens/ListContacts.tsx -> ConnectedAgentsRoot',
      'modules/vrc/screens/ListContacts.tsx -> agentConnectFlag',
      'navigators/MyAgentStack.tsx -> ConnectedAgentsRoot',
      'navigators/MyAgentStack.tsx -> agentConnectFlag',
      'navigators/SettingStack.tsx -> agentConnectFlag',
      // Sorted by code unit, so an upper-case name comes before `agents/`.
      'screens/Settings.tsx -> agentConnectFlag',
      'screens/agents/AgentDetailsScreen.tsx -> ConnectedAgentsProvider',
      'screens/agents/AgentDetailsScreen.tsx -> memories',
      'screens/agents/AgentDetailsScreen.tsx -> pairing',
      'screens/agents/AgentDetailsScreen.tsx -> revoke',
      'screens/agents/AgentDetailsScreen.tsx -> screens/AgentDetailsView',
      'screens/agents/AgentDetailsScreen.tsx -> screens/ApproveView',
      'screens/agents/AgentDetailsScreen.tsx -> screens/ChangeMemoriesView',
      'screens/agents/AgentDetailsScreen.tsx -> screens/RevokeAgentSheet',
      'screens/agents/AgentMemoriesScreen.tsx -> ConnectedAgentsProvider',
      'screens/agents/AgentMemoriesScreen.tsx -> screens/DeleteMemorySheet',
      'screens/agents/AgentMemoriesScreen.tsx -> screens/MemoriesListView',
      'screens/agents/AiAgentsScreen.tsx -> ConnectedAgentsProvider',
      'screens/agents/AiAgentsScreen.tsx -> screens/AgentListView',
      'screens/agents/ConnectAgentScreen.tsx -> ConnectedAgentsProvider',
      'screens/agents/ConnectAgentScreen.tsx -> pairing',
      'screens/agents/ConnectAgentScreen.tsx -> screens/ApproveView',
      'screens/agents/ConnectAgentScreen.tsx -> screens/ConnectAgentForm',
      'screens/agents/ConnectAgentScreen.tsx -> screens/ConnectFailureView',
      'screens/agents/ConnectAgentScreen.tsx -> screens/ConnectNumberView',
      'screens/agents/ConnectAgentScreen.tsx -> screens/ConnectScanView',
      'screens/agents/ConnectAgentScreen.tsx -> screens/ConnectedView',
    ])
    const namesToken = files
      .filter((file) => readFileSync(file, 'utf8').includes('COMPONENT_AGENT_CONTACT_CARD'))
      .map((file) => path.relative(src, file))
    expect(namesToken.sort()).toEqual([
      'container-api.ts',
      'container-impl.ts',
      'modules/vrc/screens/ListContacts.tsx',
      'types/agent-contact-card.ts',
    ])
  })

  it('keeps the plan copy rules: no "instant", "encrypted", "private" or "no trace" (§6, §7.10)', () => {
    const banned = /\binstant|\bencrypt|\bprivate\b|\bno trace\b/i
    const hits = Object.entries(EN).filter(([, text]) => banned.test(text))
    expect(hits).toEqual([])
    // Control: the pattern does bite.
    expect(banned.test('Revoking is instant.')).toBe(true)
  })

  it("never offers to try again when the owner's VTA holds a create for approval, in any language", () => {
    // A retry fails the same way until the owner's rule changes, so these words must not suggest one (#1060 finding
    // 20). The control: each pattern does match the transient failure, which may well work on a retry.
    const retry: Array<[string, Strings, RegExp]> = [
      ['en', EN, /try again/i],
      ['fr', FR, /réessa/i],
      ['pt-br', PT, /tente de novo|tentar de novo|tente novamente/i],
    ]
    for (const [lang, words, pattern] of retry) {
      expect([lang, pattern.test(words.MemoryHeldForApproval)]).toEqual([lang, false])
      expect([lang, pattern.test(words.MemoryCreateFailed)]).toEqual([lang, true])
    }
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

  it('says a temporary agent with its end time, and cannot be drawn without it', () => {
    // CI's "Type check (ratchet)" type-checks this file (packages/core/tsconfig.ratchet.json adds the tests back), so
    // the directive below is evaluated there: if the props ever allowed a missing time, it would be unused, and fail.
    // @ts-expect-error: "Connected" alone is a persistent agent's status, so connectedUntil requires `until`.
    const missing = <AgentStatusChip status="connectedUntil" />
    expect(missing).toBeTruthy()
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
    // Settle the create's own promise inside act before looking: the picker closes the name field only after it
    // resolves, and a bare waitFor (1 s by default) timed out once on a loaded CI runner (#1127, part 2/4).
    expect(onCreate).toHaveBeenCalledTimes(1)
    await act(async () => {
      await onCreate.mock.results[0].value
    })
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
    [
      "the owner's VTA holds a create for approval",
      { ok: false, code: 'heldForApproval' } as const,
      'ConnectedAgents.MemoryHeldForApproval',
    ],
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
