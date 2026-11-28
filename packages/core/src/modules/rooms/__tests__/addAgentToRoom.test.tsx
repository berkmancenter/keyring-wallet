/**
 * Step 7.13's views (docs/plans/agent-connect-plan.md §3.6, §3.8, §3.10; canvas frames 34 to 37): room info's "Agents
 * in this room", the agent picker, the add sheet with what an add came to, and "What it remembers".
 *
 * Built views-first (backlog 3, Section B, Part T1, on Keyring's interim of 11-28): fb's `useRoomAgents` and
 * `useAddAgentToRoom` have not merged, so every state here is drawn from fixtures typed with the seam's own types
 * (`RoomAgents`, `AddRoomOutcome`), with no hook, fake or container. The add flow's own steps (the picker skipped for
 * one agent, "What it remembers" after `'added'`) come with that container, and are tested there.
 *
 * The test translation answers the key (`__mocks__/react-i18next.ts`), so the views are checked by key and testID.
 * Where a name sits inside a key's parameters, `withParams()` swaps in a translation that also prints them.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
import React from 'react'
import type * as reactI18next from 'react-i18next'
import { AccessibilityInfo } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import { setAgentConnectEnabled } from '../../connected-agents/agentConnectFlag'
import { setAgentRoomsEnabled } from '../../connected-agents/agentRoomsFlag'
import {
  INBOX_TRIAGE,
  NOTES_HELPER,
  PERSONA,
  ROOM_AGENTS,
  section,
  STUDY_BUDDY,
} from '../../connected-agents/__tests__/fixtures/screenStatesRooms'
import WhatItRemembersSheet from '../../connected-agents/screens/WhatItRemembersSheet'
import { createSampleRoomsService } from '../sample/sampleRooms'
import type { RoomsService } from '../types'
import AgentPickerSheet from '../components/AgentPickerSheet'
import AgentRoomSection, { agentRoomSection, RoomAgents } from '../components/AgentRoomSection'
import AgentRoomSheet, { AddRoomOutcome } from '../components/AgentRoomSheet'

let mockService: RoomsService | undefined
let mockParams: Record<string, string> | undefined
jest.mock('../useRoomsService', () => ({ useRoomsService: () => mockService }))
jest.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 100 }))
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useRoute: () => ({ params: mockParams }),
}))

const id = (key: string) => testIdWithKey(key)
const show = (node: React.ReactElement) => render(<BasicAppContext>{node}</BasicAppContext>)

/** A translation that prints a key's parameters after it, so a name passed as a parameter can be seen. */
const withParams = () => {
  const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key)
  // The module object itself (jest maps it to __mocks__/react-i18next.ts), so the views' own import sees the spy.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const i18nModule = require('react-i18next') as typeof reactI18next
  return jest
    .spyOn(i18nModule, 'useTranslation')
    .mockReturnValue({ t, i18n: { language: 'en' } } as unknown as ReturnType<typeof reactI18next.useTranslation>)
}

/** Every "Section.Key" text in the tree, in the order drawn (which is the accessibility order: nothing reorders it). */
const keysInOrder = (node: unknown, out: string[] = []): string[] => {
  if (node == null) return out
  if (typeof node === 'string') {
    if (/^[A-Z]\w*\.[A-Z]\w*$/.test(node)) out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    node.forEach((child) => keysInOrder(child, out))
    return out
  }
  keysInOrder((node as { children?: unknown }).children, out)
  return out
}
const texts = (tree: ReturnType<typeof show>) => keysInOrder(tree.toJSON())

afterEach(() => {
  jest.restoreAllMocks()
  setAgentRoomsEnabled(false)
  setAgentConnectEnabled(false)
})

type SectionProps = React.ComponentProps<typeof AgentRoomSection>
const drawSection = (over: Partial<SectionProps> = {}) => {
  const props: SectionProps = {
    agents: [NOTES_HELPER],
    persona: PERSONA,
    canAdd: true,
    setting: 'yes',
    tier: 'open',
    onOpenAgent: jest.fn(),
    onAdd: jest.fn(),
    ...over,
  }
  return { props, tree: show(<AgentRoomSection {...props} />) }
}

type SheetProps = React.ComponentProps<typeof AgentRoomSheet>
const drawSheet = (over: Partial<SheetProps> = {}) => {
  const props: SheetProps = {
    name: INBOX_TRIAGE.name,
    persona: PERSONA,
    widensContext: INBOX_TRIAGE.widens?.context,
    onAdd: jest.fn(),
    onClose: jest.fn(),
    onSeeDetails: jest.fn(),
    ...over,
  }
  return { props, tree: show(<AgentRoomSheet {...props} />) }
}

describe('with the switches off', () => {
  // Every file under src, outside the tests, that imports one of these views. Until the container lands there is none.
  const VIEWS =
    /(?:from|require\(|import\()\s*['"][^'"]*\/(AgentRoomSection|AgentPickerSheet|AgentRoomSheet|WhatItRemembersSheet)['"]/g
  const importers = () => {
    const src = path.resolve(__dirname, '../../..')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) {
          if (name !== '__tests__') walk(full)
        } else if (/\.tsx?$/.test(name)) files.push(full)
      }
    }
    walk(src)
    return files.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(VIEWS)].map((m) => `${path.relative(src, file)} -> ${m[1]}`)
    )
  }

  test("room info is as on the tip: no agents section, and the hook's switches-off answer draws nothing", async () => {
    // The hook's answer with either switch off is `offered: false` (the seam), whatever else it holds.
    const off: RoomAgents = { ...ROOM_AGENTS, offered: false }
    // control: draw the section unconditionally (drop the `offered` check in agentRoomSection), and this fails.
    expect(agentRoomSection(off)).toBeNull()
    expect(show(section(off)).queryByTestId(id('AgentRoomSection'))).toBeNull()

    setAgentConnectEnabled(true)
    setAgentRoomsEnabled(false)
    mockService = createSampleRoomsService()
    mockParams = { roomId: 'did:webvh:sample:planning' }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RoomInfo = require('../screens/RoomInfo').default as React.FC
    const tree = show(<RoomInfo />)
    await waitFor(() => tree.getByTestId(id('RoomTitle')))
    expect(tree.queryByTestId(id('AgentRoomSection'))).toBeNull()
    expect(tree.queryByTestId(id('AgentRoomAdd'))).toBeNull()
  })

  test("the views are reachable from nowhere yet: their container comes with fb's room hooks", () => {
    expect(importers()).toEqual([])
    // Control: the pattern finds an import of a view, and not a name that only starts the same.
    const sample = `import X from '../components/AgentRoomSheet'\nimport Y from '../components/AgentRoomSheetOld'`
    expect([...sample.matchAll(VIEWS)].map((m) => m[1])).toEqual(['AgentRoomSheet'])
  })
})

describe('agentRoomSection: when the section shows', () => {
  test('absent when not offered, and when no agent is in the room and none can be added', () => {
    expect(agentRoomSection({ ...ROOM_AGENTS, offered: false })).toBeNull()
    expect(agentRoomSection({ ...ROOM_AGENTS, inRoom: [], addable: [] })).toBeNull()
    // control: an agent in the room with none to add still shows it, without "Add an agent".
    expect(agentRoomSection({ ...ROOM_AGENTS, addable: [] })).toEqual({
      agents: [NOTES_HELPER],
      persona: PERSONA,
      canAdd: false,
      setting: 'yes',
      tier: 'open',
    })
    expect(agentRoomSection({ ...ROOM_AGENTS, inRoom: [] })?.canAdd).toBe(true)
  })
})

describe('"Agents in this room"', () => {
  test('draws each agent with "AI agent" and its memories, and a row opens that agent', () => {
    const spy = withParams()
    const { props, tree } = drawSection({
      agents: [NOTES_HELPER, { agentId: 'agent-bare', name: 'Bare', memoryNames: [] }],
    })
    const rows = tree.getAllByTestId(id('AgentRoomRow'))
    expect(rows).toHaveLength(2)
    expect(tree.getAllByText('Rooms.AgentBadge')).toHaveLength(2)
    expect(tree.getByText('ConnectedAgents.AgentMemory {"names":"Education, Healthcare"}')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.AgentNoMemory')).toBeTruthy()
    expect(tree.getByText(`ConnectedAgents.AgentsUseEveryRoom {"persona":"${PERSONA}"}`)).toBeTruthy()
    fireEvent.press(rows[1])
    expect(props.onOpenAgent).toHaveBeenCalledWith('agent-bare')
    spy.mockRestore()
  })

  test.each([
    ['yes', false, undefined],
    ['no', true, 'ConnectedAgents.CommunityNo'],
    ['notStated', true, 'ConnectedAgents.CommunityNotStated'],
  ] as const)('setting %s: "Add an agent" is enabled only on yes (PLAN:1361)', (setting, off, line) => {
    const { props, tree } = drawSection({ setting })
    const add = tree.getByTestId(id('AgentRoomAdd'))
    expect(add.props.accessibilityState).toEqual({ disabled: off })
    fireEvent.press(add)
    expect(props.onAdd).toHaveBeenCalledTimes(off ? 0 : 1)
    const why = tree.queryByTestId(id('AgentRoomSetting'))
    if (line) expect(why?.props.children).toBe(line)
    else expect(why).toBeNull()
    // No "Add anyway" (PLAN:644): the row is the only way to add, and it is off.
    expect(texts(tree).filter((k) => /Anyway/i.test(k))).toEqual([])
  })

  test('an attributed room: "Add an agent" is off with AgentsNotInAttributed even on yes, and no every-room note', () => {
    const { props, tree } = drawSection({ tier: 'attributed', setting: 'yes' })
    // control: drop the tier check in addOffReason, and this fails.
    const add = tree.getByTestId(id('AgentRoomAdd'))
    expect(add.props.accessibilityState).toEqual({ disabled: true })
    fireEvent.press(add)
    expect(props.onAdd).not.toHaveBeenCalled()
    expect(tree.getByTestId(id('AgentRoomSetting')).props.children).toBe('ConnectedAgents.AgentsNotInAttributed')
    expect(tree.queryByTestId(id('AgentRoomNote'))).toBeNull()
    // The tier comes before the setting: an attributed room shows this line only.
    for (const setting of ['no', 'notStated'] as const) {
      const other = drawSection({ tier: 'attributed', setting }).tree
      expect(texts(other)).toContain('ConnectedAgents.AgentsNotInAttributed')
      expect(texts(other)).not.toContain('ConnectedAgents.CommunityNo')
      expect(texts(other)).not.toContain('ConnectedAgents.CommunityNotStated')
    }
  })

  test('an attributed room with an agent in it and none to add still says what applies, in place of the note', () => {
    const { tree } = drawSection({ tier: 'attributed', canAdd: false })
    expect(tree.queryByTestId(id('AgentRoomAdd'))).toBeNull()
    expect(tree.getByTestId(id('AgentRoomSetting')).props.children).toBe('ConnectedAgents.AgentsNotInAttributed')
    expect(tree.queryByTestId(id('AgentRoomNote'))).toBeNull()
  })

  test('no agent to add: no "Add an agent" row and no setting line, in an open room', () => {
    const { tree } = drawSection({ canAdd: false, setting: 'no' })
    expect(tree.queryByTestId(id('AgentRoomAdd'))).toBeNull()
    expect(tree.queryByTestId(id('AgentRoomSetting'))).toBeNull()
    expect(tree.getByTestId(id('AgentRoomNote'))).toBeTruthy()
  })
})

describe('the agent picker', () => {
  test('draws one row per agent it is given, and a row picks that agent', () => {
    const spy = withParams()
    const props = { agents: [INBOX_TRIAGE, STUDY_BUDDY], onPick: jest.fn(), onClose: jest.fn() }
    const tree = show(<AgentPickerSheet {...props} />)
    // fb's hook leaves out an expired agent and one already in the room; the view draws only what it is given.
    const rows = tree.getAllByTestId(id('AgentPickerRow'))
    expect(rows.map((r) => r.props.accessibilityLabel)).toEqual([
      'Inbox triage, Rooms.AgentBadge',
      'Study buddy, Rooms.AgentBadge',
    ])
    fireEvent.press(rows[1])
    expect(props.onPick).toHaveBeenCalledWith(STUDY_BUDDY.agentId)
    // No heading: the plan gives the picker no words; a screen reader hears "Add my agent".
    expect(tree.getByTestId(id('AgentPickerSheet')).props.accessibilityLabel).toBe('ConnectedAgents.AddMyAgent')
    // control: the only words drawn are the agents' names and "AI agent".
    expect(texts(tree)).toEqual(['Rooms.AgentBadge', 'Rooms.AgentBadge'])
    spy.mockRestore()
  })
})

describe('the add sheet', () => {
  test('with widensContext: AddToRoomBodyAllRooms and the memory notice, in order title, notices, buttons', () => {
    const { tree } = drawSheet()
    // control: the notices come before the buttons; moving the buttons up fails this.
    expect(texts(tree)).toEqual([
      'ConnectedAgents.AddToRoomTitle',
      'ConnectedAgents.AddToRoomBodyAllRooms',
      'ConnectedAgents.AddRoomMemoryNotice',
      'ConnectedAgents.MembersWillSee',
      'ConnectedAgents.AddToRoom',
      'Global.NotNow',
    ])
  })

  test('the persona and the context reach the words', () => {
    const spy = withParams()
    const { tree } = drawSheet()
    expect(tree.getByText(`ConnectedAgents.AddToRoomBodyAllRooms {"persona":"${PERSONA}"}`)).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.AddRoomMemoryNotice {"context":"Personal"}')).toBeTruthy()
    expect(tree.getByText('ConnectedAgents.AddToRoomTitle {"name":"Inbox triage"}')).toBeTruthy()
    spy.mockRestore()
  })

  test('without widensContext: AddToRoomBodyAlready and no memory notice', () => {
    const { tree } = drawSheet({ name: STUDY_BUDDY.name, widensContext: undefined })
    expect(texts(tree)).toEqual([
      'ConnectedAgents.AddToRoomTitle',
      'ConnectedAgents.AddToRoomBodyAlready',
      'ConnectedAgents.MembersWillSee',
      'ConnectedAgents.AddToRoom',
      'Global.NotNow',
    ])
    expect(tree.queryByTestId(id('AgentRoomSheetMemory'))).toBeNull()
  })

  test('its first accessibility focus is the title, and no button takes it', () => {
    // React Native's jest setup already mocks it, with the earlier tests' calls: start from none.
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined)
    focus.mockClear()
    const { tree } = drawSheet()
    // What is asked to take focus (jest's View is a component instance, with its props): the title, once.
    type Target = { props?: { accessibilityRole?: string } }
    const asked = (focus.mock.calls as unknown as [Target, string][])
      .filter(([, event]) => event === 'focus')
      .map(([target]) => target.props)
    expect(asked.filter((p) => p?.accessibilityRole === 'header')).toHaveLength(1)
    expect(asked.filter((p) => p?.accessibilityRole === 'button')).toEqual([])
    for (const key of ['AgentRoomSheetAdd', 'AgentRoomSheetNotNow']) {
      const button = tree.getByTestId(id(key))
      expect(button.props.autoFocus).toBeUndefined()
      expect(button.props.hasTVPreferredFocus).toBeUndefined()
    }
  })

  test('a double press calls onAdd once, and "Add to room" is off while the add runs', () => {
    const { props, tree } = drawSheet()
    const add = tree.getByTestId(id('AgentRoomSheetAdd'))
    fireEvent.press(add)
    fireEvent.press(add)
    fireEvent.press(tree.getByTestId(id('AgentRoomSheetAdd')))
    // control: without the once-only ref, the presses in the same frame each call onAdd.
    expect(props.onAdd).toHaveBeenCalledTimes(1)
    expect(tree.getByTestId(id('AgentRoomSheetAdd')).props.accessibilityState).toMatchObject({ disabled: true })
    // "Not now" stays: closing the sheet does not undo or repeat the add.
    fireEvent.press(tree.getByTestId(id('AgentRoomSheetNotNow')))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  const LINES: Record<Exclude<AddRoomOutcome, 'added'>, string> = {
    refused: 'ConnectedAgents.AddRoomRefused',
    unreachable: 'ConnectedAgents.AddRoomUnreachable',
    notAddable: 'ConnectedAgents.AddRoomNotAddable',
    accessChanged: 'ConnectedAgents.MemoryAccessChanged',
    settingNo: 'ConnectedAgents.CommunityNo',
    settingNotStated: 'ConnectedAgents.CommunityNotStated',
  }

  test('each outcome has its own line: no two share one', () => {
    const lines = Object.values(LINES)
    expect(new Set(lines).size).toBe(lines.length)
  })

  test.each(Object.entries(LINES))(
    '%s shows its own line and "Done", and "Add to room" is gone for good, with no "Try again"',
    async (outcome, line) => {
      const { props, tree } = drawSheet()
      fireEvent.press(tree.getByTestId(id('AgentRoomSheetAdd')))
      tree.rerender(
        <BasicAppContext>
          <AgentRoomSheet {...props} outcome={outcome as AddRoomOutcome} />
        </BasicAppContext>
      )
      await act(async () => undefined)
      expect(tree.getByTestId(id('AgentRoomSheetOutcome')).props.children).toBe(line)
      expect(tree.queryByTestId(id('AgentRoomSheetAdd'))).toBeNull()
      expect(tree.queryByTestId(id('AgentRoomSheetNotNow'))).toBeNull()
      expect(texts(tree).filter((k) => /TryAgain|Retry/.test(k))).toEqual([])
      fireEvent.press(tree.getByTestId(id('AgentRoomSheetDone')))
      expect(props.onClose).toHaveBeenCalledTimes(1)
      expect(props.onAdd).toHaveBeenCalledTimes(1)
    }
  )

  test("the outcome's line names the agent", () => {
    const spy = withParams()
    const { tree } = drawSheet({ outcome: 'refused' })
    expect(tree.getByTestId(id('AgentRoomSheetOutcome')).props.children).toBe(
      'ConnectedAgents.AddRoomRefused {"name":"Inbox triage"}'
    )
    spy.mockRestore()
  })

  test("'accessChanged' is a repair, called by useAgentActions().restore from AgentDetails' Restore: \"See details\" opens it", () => {
    // The read-back of `act` was not exactly the bound memories plus the persona's context (PLAN:1361).
    const { props, tree } = drawSheet({ outcome: 'accessChanged' })
    fireEvent.press(tree.getByTestId(id('AgentRoomSheetSeeDetails')))
    expect(props.onSeeDetails).toHaveBeenCalledTimes(1)
    // control: only this outcome offers it.
    expect(drawSheet({ outcome: 'refused' }).tree.queryByTestId(id('AgentRoomSheetSeeDetails'))).toBeNull()
  })

  test('\'added\' draws no outcome line, and "Add to room" stays off: the flow moves on to What it remembers', () => {
    const { tree } = drawSheet({ outcome: 'added' })
    expect(tree.queryByTestId(id('AgentRoomSheetOutcome'))).toBeNull()
    expect(tree.getByTestId(id('AgentRoomSheetAdd')).props.accessibilityState).toMatchObject({ disabled: true })
  })
})

describe('"What it remembers"', () => {
  test("names the agent's memories, one row each, then the persona's rooms, the note and the buttons", () => {
    const spy = withParams()
    const props = { onDone: jest.fn(), onConnectAnother: jest.fn() }
    const tree = show(
      <WhatItRemembersSheet
        name={NOTES_HELPER.name}
        persona={PERSONA}
        memoryNames={NOTES_HELPER.memoryNames}
        {...props}
      />
    )
    expect(tree.getByText('ConnectedAgents.WhatItRemembers {"name":"Notes helper"}')).toBeTruthy()
    expect(
      tree.getByText('ConnectedAgents.WhatItRemembersBody {"name":"Notes helper","names":"Education, Healthcare"}')
    ).toBeTruthy()
    expect(tree.getAllByTestId(id('WhatItRemembersRow')).map((r) => r.props.accessibilityRole)).toEqual([
      undefined,
      undefined,
    ])
    expect(tree.getByText(`ConnectedAgents.CanUseEveryRoomAs {"persona":"${PERSONA}"}`)).toBeTruthy()
    fireEvent.press(tree.getByTestId(id('WhatItRemembersDone')))
    fireEvent.press(tree.getByTestId(id('WhatItRemembersConnectAnother')))
    expect(props.onDone).toHaveBeenCalledTimes(1)
    expect(props.onConnectAnother).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  test('an agent with no memory: WhatItRemembersNone, and no rows', () => {
    const tree = show(
      <WhatItRemembersSheet
        name="Bare"
        persona={PERSONA}
        memoryNames={[]}
        onDone={jest.fn()}
        onConnectAnother={jest.fn()}
      />
    )
    // control: the body with an empty list would read "…in every room it is in: . Your VTA…"; it is never drawn.
    expect(texts(tree)).toEqual([
      'ConnectedAgents.WhatItRemembers',
      'ConnectedAgents.WhatItRemembersNone',
      'ConnectedAgents.CanUseEveryRoomAs',
      'ConnectedAgents.MemoryIsText',
      'Global.Done',
      'ConnectedAgents.ConnectAnotherAgent',
    ])
    expect(tree.queryByTestId(id('WhatItRemembersRow'))).toBeNull()
  })
})
