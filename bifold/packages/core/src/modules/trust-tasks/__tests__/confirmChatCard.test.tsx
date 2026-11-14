/**
 * "Confirm it's you" as a card in the chat (ConfirmChatCard, useConfirmChatItems; mocks RstEUM32… A3–A9): each state
 * on both phones, what each button calls, and that nothing shows with the switch off or either remote off: not the
 * items, and not the card itself. The protocol is tested in confirmItsYou.test.ts; the contact row and sheet in
 * confirmItsYouScreens.test.tsx.
 */
import { act, fireEvent, render, renderHook } from '@testing-library/react-native'
import React from 'react'
import { AppState, StyleSheet } from 'react-native'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { ColorPalette } from '../../../theme'
import { Role } from '../../../types/chat'
import { testIdWithKey } from '../../../utils/testable'
import * as confirmItsYou from '../confirmItsYou'
import { CONFIRM_ITS_YOU_REMOTE_OFF, setConfirmItsYouEnabled } from '../module/confirmItsYouFlag'
import * as ownerConfirm from '../module/ownerConfirm'
import { SEDI_KERI_REMOTE_OFF } from '../module/sediKeriRemoteOff'
import ConfirmChatCard, {
  ConfirmChatCardIds,
  setConfirmChatOwnerCheckForTests,
  theirStatusOf,
  type ConfirmChatEntry,
} from '../screens/ConfirmChatCard'
import { useConfirmChatItems } from '../screens/useConfirmChatItems'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const CONN = 'c-jordan'
const NOTE = 'Did you just send me an address? <b>Open</b> https://x.example'
const MIN = 60 * 1000

const findAllByQuery = jest.fn()
const AGENT = { genericRecords: { findAllByQuery } } as never

const ask = (over: Partial<confirmItsYou.ConfirmAsk> = {}): confirmItsYou.ConfirmAsk => ({
  threadId: 't-1',
  challenge: 'c'.repeat(43),
  note: NOTE,
  askedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 15 * MIN).toISOString(),
  state: 'waiting',
  ...over,
})
const prompt = (over: Partial<confirmItsYou.ConfirmPrompt> = {}): confirmItsYou.ConfirmPrompt => ({
  open: true,
  connectionId: CONN,
  asker: 'Sam',
  note: NOTE,
  expiresAt: new Date(Date.now() + 15 * MIN).toISOString(),
  request: { payload: { challenge: 'c'.repeat(43) } },
  receivedAt: new Date().toISOString(),
  ...over,
})

const OFFS: [string, () => void][] = [
  ['the switch off', () => setConfirmItsYouEnabled(false)],
  ['its remote off', () => (CONFIRM_ITS_YOU_REMOTE_OFF.off = true)],
  ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
]

const show = async (entry: ConfirmChatEntry, onChanged?: () => void) => {
  const tree = render(
    <BasicAppContext>
      <ConfirmChatCard entry={entry} connectionId={CONN} name="Jordan" onChanged={onChanged} />
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}
/** The jest t() returns the key; this records what each key was given, so a time or a count can be read. */
const i18nArgs = () => {
  const calls: [string, unknown][] = []
  const t = (key: string, args?: unknown) => {
    calls.push([key, args])
    return key
  }
  // The module the card gets (jest maps react-i18next to __mocks__; a namespace import would be a copy).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const i18nModule = require('react-i18next')
  jest.spyOn(i18nModule, 'useTranslation').mockReturnValue({ t, i18n: { language: 'en', t } } as never)
  return { argsOf: (key: string) => [...calls].reverse().find(([k]) => k === key)?.[1] }
}
/** A settled card starts as one line: tap it open first (a waiting or open card has no line; this does nothing). */
const opened = async (entry: ConfirmChatEntry, onChanged?: () => void) => {
  const tree = await show(entry, onChanged)
  const line =
    tree.queryByTestId(id(ConfirmChatCardIds.mineLine)) ??
    tree.queryByTestId(id(ConfirmChatCardIds.earlier)) ??
    tree.queryByTestId(id(ConfirmChatCardIds.theirLine))
  if (line)
    await act(async () => {
      fireEvent.press(line)
    })
  return tree
}
const press = async (tree: Awaited<ReturnType<typeof show>>, key: string) =>
  act(async () => {
    fireEvent.press(tree.getByTestId(id(key)))
  })
const statusOf = (tree: Awaited<ReturnType<typeof show>>) =>
  tree.getByTestId(id(ConfirmChatCardIds.status)).props.children

beforeEach(() => {
  jest.restoreAllMocks()
  findAllByQuery.mockReset().mockResolvedValue([])
  ;(useAgent as jest.Mock).mockReturnValue({ agent: AGENT })
  CONFIRM_ITS_YOU_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  setConfirmItsYouEnabled(true)
  confirmItsYou.confirmPromptStore.clear()
  setConfirmChatOwnerCheckForTests(null)
  jest.spyOn(ownerConfirm, 'ownerLockKind').mockResolvedValue('faceId')
})
afterAll(() => setConfirmItsYouEnabled(false))

describe('hidden when off', () => {
  test.each(OFFS)('with %s: no items, nothing read (control: on, the items are there)', async (_label, turnOff) => {
    const read = jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([ask()])
    confirmItsYou.confirmPromptStore.set(prompt())
    turnOff()
    const off = renderHook(() => useConfirmChatItems(CONN, 'Jordan'))
    await act(async () => undefined)
    expect(off.result.current).toEqual([])
    expect(read).not.toHaveBeenCalled()

    CONFIRM_ITS_YOU_REMOTE_OFF.off = false
    SEDI_KERI_REMOTE_OFF.off = false
    setConfirmItsYouEnabled(true)
    const on = renderHook(() => useConfirmChatItems(CONN, 'Jordan'))
    await act(async () => undefined)
    expect(on.result.current).toHaveLength(2)
  })

  test.each(OFFS)('with %s: the card itself draws nothing, on either side (control: on, it draws)', async (_l, off) => {
    off()
    for (const entry of [
      { side: 'mine', ask: ask(), newest: true },
      { side: 'theirs', prompt: prompt() },
    ] as ConfirmChatEntry[]) {
      const tree = await show(entry)
      expect(tree.queryByTestId(id(ConfirmChatCardIds.status))).toBeNull()
      expect(tree.queryByTestId(id(ConfirmChatCardIds.itsMe))).toBeNull()
    }
    CONFIRM_ITS_YOU_REMOTE_OFF.off = false
    SEDI_KERI_REMOTE_OFF.off = false
    setConfirmItsYouEnabled(true)
    expect((await show({ side: 'theirs', prompt: prompt() })).getByTestId(id(ConfirmChatCardIds.itsMe))).toBeTruthy()
  })
})

describe('the items', () => {
  test("mine are this phone's, newest first as a full card; the contact's prompt is theirs; all are cards, not messages", async () => {
    jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([ask({ threadId: 'new' }), ask({ threadId: 'old' })])
    confirmItsYou.confirmPromptStore.set(prompt())
    const { result } = renderHook(() => useConfirmChatItems(CONN, 'Jordan'))
    await act(async () => undefined)
    const items = result.current
    expect(items.map((item) => [item._id, item.user._id, item.confirmCard])).toEqual([
      ['confirm-ask-new', Role.me, true],
      ['confirm-ask-old', Role.me, true],
      [expect.stringMatching(/^confirm-prompt-c-jordan-/), Role.them, true],
    ])
    // None of them is a chat event or a stored message, so none can be reacted to, replied to or deleted for me.
    expect(items.some((item) => item.chatEventId || item.basicMessageId)).toBe(false)
  })

  test('with no live prompt, the kept record is read for that connection (an answered one shows as answered)', async () => {
    jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([])
    findAllByQuery.mockResolvedValue([
      { content: { ...prompt({ open: false, answered: 'notMe' }), answeredAt: '2026-11-12T10:41:00Z' } },
    ])
    const { result } = renderHook(() => useConfirmChatItems(CONN, 'Jordan'))
    await act(async () => undefined)
    expect(findAllByQuery).toHaveBeenCalledWith({ recordType: confirmItsYou.CONFIRM_PROMPT, connectionId: CONN })
    const tree = render(<BasicAppContext>{result.current[0].renderEvent()}</BasicAppContext>)
    // Settled, so it starts as one line; the record opens on a tap.
    expect(tree.getByTestId(id(ConfirmChatCardIds.theirLine))).toBeTruthy()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(ConfirmChatCardIds.theirLine)))
    })
    expect(tree.getByTestId(id(ConfirmChatCardIds.status)).props.children).toBe('ConfirmItsYou.YouToldNotMe')
    // The time it was answered, from the kept record (control: without it, no time line at all).
    expect(tree.getByText('ConfirmItsYou.SentSignedNoLock')).toBeTruthy()
  })

  test('a waiting request turns into no answer on a clock, with no event (control: before its time it still waits)', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-11-12T10:00:00Z') })
    try {
      jest
        .spyOn(confirmItsYou, 'confirmAsksOn')
        .mockResolvedValue([ask({ expiresAt: new Date(Date.now() + 2 * MIN).toISOString() })])
      // One live tree, driven only by the hook: nothing outside re-renders it, so only the hook's own clock can.
      const Chat = () => <>{useConfirmChatItems(CONN, 'Jordan').map((item) => item.renderEvent())}</>
      const tree = render(
        <BasicAppContext>
          <Chat />
        </BasicAppContext>
      )
      await act(async () => undefined)
      expect(statusOf(tree)).toBe('ConfirmItsYou.WaitingTitle')
      await act(async () => {
        jest.advanceTimersByTime(MIN)
      })
      expect(statusOf(tree)).toBe('ConfirmItsYou.WaitingTitle')
      await act(async () => {
        jest.advanceTimersByTime(MIN + 100)
      })
      expect(statusOf(tree)).toBe('ConfirmItsYou.ExpiredTitle')
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('mine (this phone asked)', () => {
  test('waiting: the note exactly as typed, and Cancel cancels that request (here only)', async () => {
    const cancel = jest.spyOn(confirmItsYou, 'cancelConfirmRequest').mockResolvedValue('cancelled')
    const changed = jest.fn()
    const tree = await opened({ side: 'mine', ask: ask(), newest: true }, changed)
    expect(statusOf(tree)).toBe('ConfirmItsYou.WaitingTitle')
    expect(tree.getByTestId(id(ConfirmChatCardIds.note)).props.children).toBe(NOTE)
    await press(tree, ConfirmChatCardIds.cancel)
    expect(cancel).toHaveBeenCalledWith(AGENT, CONN, 't-1')
    expect(changed).toHaveBeenCalled()
  })

  test('not confirmed is the red alert with what to do now (control: confirmed has no steps)', async () => {
    const bad = await opened({ side: 'mine', ask: ask({ state: 'notMe' }), newest: true })
    expect(statusOf(bad)).toBe('ConfirmItsYou.NotThemTitle')
    expect(bad.getByTestId(id(ConfirmChatCardIds.steps))).toBeTruthy()
    expect(bad.getByTestId(id(ConfirmChatCardIds.mine)).props.accessibilityRole).toBe('alert')

    const good = await opened({
      side: 'mine',
      ask: ask({ state: 'itsMe', respondedAt: new Date().toISOString(), confirmedWith: 'faceId' }),
      newest: true,
    })
    expect(statusOf(good)).toBe('ConfirmItsYou.ConfirmedTitle')
    expect(good.queryByTestId(id(ConfirmChatCardIds.steps))).toBeNull()
  })

  test('confirmed with no lock named says "on their phone"', async () => {
    const tree = await opened({ side: 'mine', ask: ask({ state: 'itsMe', confirmedWith: 'unknown' }), newest: true })
    expect(statusOf(tree)).toBe('ConfirmItsYou.ConfirmedTitleOnPhone')
  })

  test('no answer: Ask again sends a new request with the same note', async () => {
    const send = jest.spyOn(confirmItsYou, 'sendConfirmRequest').mockResolvedValue('sent')
    const tree = await opened({
      side: 'mine',
      ask: ask({ expiresAt: new Date(Date.now() - MIN).toISOString() }),
      newest: true,
    })
    expect(statusOf(tree)).toBe('ConfirmItsYou.ExpiredTitle')
    await press(tree, ConfirmChatCardIds.askAgain)
    expect(send).toHaveBeenCalledWith(AGENT, CONN, NOTE)
  })

  test('an older request is one quiet line, with nothing to press', async () => {
    const tree = await show({ side: 'mine', ask: ask({ state: 'cancelled' }), newest: false })
    expect(tree.getByTestId(id(ConfirmChatCardIds.earlier))).toBeTruthy()
    expect(tree.queryByTestId(id(ConfirmChatCardIds.cancel))).toBeNull()
    expect(tree.queryByTestId(id(ConfirmChatCardIds.status))).toBeNull()
  })
})

describe('theirs (the contact asked this phone)', () => {
  test('open: Confirm answers itsMe behind the lock, then says what was sent', async () => {
    const check = jest.fn()
    setConfirmChatOwnerCheckForTests(check)
    const answer = jest.spyOn(confirmItsYou, 'answerConfirmRequest').mockResolvedValue('sent')
    const tree = await opened({ side: 'theirs', prompt: prompt() })
    expect(statusOf(tree)).toBe('ConfirmItsYou.PromptTitle')
    expect(tree.getByTestId(id(ConfirmChatCardIds.note)).props.children).toBe(NOTE)
    await press(tree, ConfirmChatCardIds.itsMe)
    expect(answer).toHaveBeenCalledWith(
      AGENT,
      CONN,
      'itsMe',
      expect.any(Function),
      'ConfirmItsYou.ItsMeReason',
      'faceId'
    )
    expect(statusOf(tree)).toBe('ConfirmItsYou.YouToldItsMe')
    expect(tree.queryByTestId(id(ConfirmChatCardIds.itsMe))).toBeNull()
  })

  test('No, that wasn’t me answers notMe; a lock not set says so and the request stays', async () => {
    const answer = jest.spyOn(confirmItsYou, 'answerConfirmRequest').mockResolvedValue('unavailable')
    const tree = await opened({ side: 'theirs', prompt: prompt() })
    await press(tree, ConfirmChatCardIds.notMe)
    expect(answer.mock.calls[0][2]).toBe('notMe')
    expect(tree.getByTestId(id(ConfirmChatCardIds.said)).props.children).toBe('ConfirmItsYou.NoLock')
    expect(tree.getByTestId(id(ConfirmChatCardIds.itsMe))).toBeTruthy()
  })

  test('past its time: "This request has expired" and nothing to press, from the same expiry (control: before it, open)', async () => {
    const late = prompt({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    expect(theirStatusOf(late)).toBe('expired')
    expect(theirStatusOf(prompt())).toBe('open')
    const tree = await opened({ side: 'theirs', prompt: late })
    expect(statusOf(tree)).toBe('ConfirmItsYou.ExpiredPromptTitle')
    expect(tree.queryByTestId(id(ConfirmChatCardIds.itsMe))).toBeNull()
    expect(tree.queryByTestId(id(ConfirmChatCardIds.notMe))).toBeNull()
  })

  test.each([
    ['unreadable', 'not a time'],
    ['empty', ''],
  ])(
    'an %s expiry is expired, never answerable (control: a readable future time is open)',
    async (_label, expiresAt) => {
      const odd = prompt({ expiresAt })
      expect(theirStatusOf(odd)).toBe('expired')
      const tree = await opened({ side: 'theirs', prompt: odd })
      expect(statusOf(tree)).toBe('ConfirmItsYou.ExpiredPromptTitle')
      expect(tree.queryByTestId(id(ConfirmChatCardIds.itsMe))).toBeNull()
      expect(theirStatusOf(prompt())).toBe('open')
    }
  )

  test('answered: what was told, no buttons, even with a time still left on it', async () => {
    const tree = await opened({ side: 'theirs', prompt: prompt({ open: false, answered: 'itsMe' }) })
    expect(statusOf(tree)).toBe('ConfirmItsYou.YouToldItsMe')
    expect(tree.queryByTestId(id(ConfirmChatCardIds.itsMe))).toBeNull()
  })
})

describe('settled cards fold to one line (Alberto, 278.19)', () => {
  const SETTLED_MINE: [string, confirmItsYou.ConfirmAsk][] = [
    ['confirmed', ask({ state: 'itsMe', respondedAt: new Date().toISOString(), confirmedWith: 'faceId' })],
    ['not them', ask({ state: 'notMe', respondedAt: new Date().toISOString() })],
    ['no answer', ask({ expiresAt: new Date(Date.now() - MIN).toISOString() })],
    ['cancelled', ask({ state: 'cancelled' })],
  ]
  test.each(SETTLED_MINE)('mine, %s: one line; a tap opens the whole card; Hide folds it back', async (_l, settled) => {
    const tree = await show({ side: 'mine', ask: settled, newest: true })
    expect(tree.getByTestId(id(ConfirmChatCardIds.mineLine))).toBeTruthy()
    expect(tree.queryByTestId(id(ConfirmChatCardIds.mine))).toBeNull()
    await press(tree, ConfirmChatCardIds.mineLine)
    expect(tree.getByTestId(id(ConfirmChatCardIds.mine))).toBeTruthy()
    expect(tree.queryByTestId(id(ConfirmChatCardIds.mineLine))).toBeNull()
    await press(tree, ConfirmChatCardIds.hide)
    expect(tree.getByTestId(id(ConfirmChatCardIds.mineLine))).toBeTruthy()
    expect(tree.queryByTestId(id(ConfirmChatCardIds.mine))).toBeNull()
  })

  test('mine, waiting: the whole card, no line and no Hide (control for the rows above)', async () => {
    const tree = await show({ side: 'mine', ask: ask(), newest: true })
    expect(tree.getByTestId(id(ConfirmChatCardIds.mine))).toBeTruthy()
    expect(tree.queryByTestId(id(ConfirmChatCardIds.mineLine))).toBeNull()
    expect(tree.queryByTestId(id(ConfirmChatCardIds.hide))).toBeNull()
  })

  test('"not them" folds to a red line, never a quiet grey one (control: confirmed folds grey)', async () => {
    const colourOf = (tree: Awaited<ReturnType<typeof show>>) =>
      StyleSheet.flatten(tree.getByText(/ConfirmItsYou\.Earlier/).props.style).color
    const red = await show({ side: 'mine', ask: SETTLED_MINE[1][1], newest: true })
    expect(colourOf(red)).toBe(ColorPalette.semantic.error)
    const grey = await show({ side: 'mine', ask: SETTLED_MINE[0][1], newest: true })
    expect(colourOf(grey)).toBe(ColorPalette.grayscale.mediumGrey)
  })

  test('theirs, answered or expired: one line saying what happened, with the time; a tap opens the record', async () => {
    const answered = await show({
      side: 'theirs',
      prompt: prompt({ open: false, answered: 'itsMe' }),
      answeredAt: '2026-11-14T10:41:00Z',
    })
    expect(answered.getByText('ConfirmItsYou.TheirLineItsMe')).toBeTruthy()
    await press(answered, ConfirmChatCardIds.theirLine)
    expect(statusOf(answered)).toBe('ConfirmItsYou.YouToldItsMe')
    await press(answered, ConfirmChatCardIds.hide)
    expect(answered.getByTestId(id(ConfirmChatCardIds.theirLine))).toBeTruthy()

    const notMe = await show({ side: 'theirs', prompt: prompt({ open: false, answered: 'notMe' }), answeredAt: 'x' })
    expect(notMe.getByText('ConfirmItsYou.TheirLineNotMe')).toBeTruthy()
    // No time kept: the line says what was told, without a time (never "at " and nothing).
    const noTime = await show({ side: 'theirs', prompt: prompt({ open: false, answered: 'itsMe' }) })
    expect(noTime.getByText('ConfirmItsYou.YouToldItsMe')).toBeTruthy()
    const late = await show({
      side: 'theirs',
      prompt: prompt({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    })
    expect(late.getByText('ConfirmItsYou.TheirLineExpired')).toBeTruthy()
    // Control: an open request is the whole card, with nothing to fold.
    const open = await show({ side: 'theirs', prompt: prompt() })
    expect(open.queryByTestId(id(ConfirmChatCardIds.theirLine))).toBeNull()
    expect(open.queryByTestId(id(ConfirmChatCardIds.hide))).toBeNull()
  })

  test('an answer that arrives while the chat is open is seen whole (control: drawn already settled, it is a line)', async () => {
    const waiting: ConfirmChatEntry = { side: 'mine', ask: ask(), newest: true }
    const confirmed: ConfirmChatEntry = {
      side: 'mine',
      ask: ask({ state: 'itsMe', respondedAt: new Date().toISOString(), confirmedWith: 'faceId' }),
      newest: true,
    }
    const card = (entry: ConfirmChatEntry) => (
      <BasicAppContext>
        <ConfirmChatCard entry={entry} connectionId={CONN} name="Jordan" />
      </BasicAppContext>
    )
    const tree = render(card(waiting))
    await act(async () => undefined)
    tree.rerender(card(confirmed))
    await act(async () => undefined)
    expect(statusOf(tree)).toBe('ConfirmItsYou.ConfirmedTitle')
    expect(tree.queryByTestId(id(ConfirmChatCardIds.mineLine))).toBeNull()
    expect(tree.getByTestId(id(ConfirmChatCardIds.hide))).toBeTruthy()
    expect((await show(confirmed)).getByTestId(id(ConfirmChatCardIds.mineLine))).toBeTruthy()
  })

  test.each([
    ['notMe', 'ConfirmItsYou.NotMe' as const, 'ConfirmItsYou.TheirLineNotMe'],
    ['itsMe (control)', 'ConfirmItsYou.ItsMe' as const, 'ConfirmItsYou.TheirLineItsMe'],
  ])(
    'answered %s here, then Hide at once: the line says what was just sent, before any reload',
    async (_label, button, line) => {
      setConfirmChatOwnerCheckForTests(jest.fn())
      jest.spyOn(confirmItsYou, 'answerConfirmRequest').mockResolvedValue('sent')
      // No reload ever lands here: the entry stays the open prompt, as on a phone until the record is read again.
      const tree = await show({ side: 'theirs', prompt: prompt() })
      await press(tree, button === 'ConfirmItsYou.NotMe' ? ConfirmChatCardIds.notMe : ConfirmChatCardIds.itsMe)
      await press(tree, ConfirmChatCardIds.hide)
      expect(tree.getByText(line)).toBeTruthy()
    }
  )

  test('an older request folds to `earlier`; the newest, settled, to its own line (never `earlier`)', async () => {
    const older = await show({ side: 'mine', ask: ask({ state: 'itsMe' }), newest: false })
    expect(older.getByTestId(id(ConfirmChatCardIds.earlier))).toBeTruthy()
    expect(older.queryByTestId(id(ConfirmChatCardIds.mineLine))).toBeNull()
    const newest = await show({ side: 'mine', ask: ask({ state: 'itsMe' }), newest: true })
    expect(newest.getByTestId(id(ConfirmChatCardIds.mineLine))).toBeTruthy()
    expect(newest.queryByTestId(id(ConfirmChatCardIds.earlier))).toBeNull()
  })

  test('a card that settles on screen stays whole: the answer just given is seen in full, with Hide', async () => {
    setConfirmChatOwnerCheckForTests(jest.fn())
    jest.spyOn(confirmItsYou, 'answerConfirmRequest').mockResolvedValue('sent')
    const tree = await show({ side: 'theirs', prompt: prompt() })
    await press(tree, ConfirmChatCardIds.itsMe)
    expect(statusOf(tree)).toBe('ConfirmItsYou.YouToldItsMe')
    expect(tree.queryByTestId(id(ConfirmChatCardIds.theirLine))).toBeNull()
    expect(tree.getByTestId(id(ConfirmChatCardIds.hide))).toBeTruthy()
  })
})

describe('when, on both phones', () => {
  test('theirs says when it was received, and while open how long is left (control: answered has no time left)', async () => {
    const t = i18nArgs()
    const open = await show({ side: 'theirs', prompt: prompt({ receivedAt: '2026-11-14T10:30:00Z' }) })
    expect(open.getByTestId(id(ConfirmChatCardIds.received)).props.children).toBe('ConfirmItsYou.ReceivedAt')
    expect(t.argsOf('ConfirmItsYou.ReceivedAt')).toMatchObject({ received: expect.stringMatching(/\d/) })
    expect(open.getByTestId(id(ConfirmChatCardIds.expiresTheirs)).props.children).toBe('ConfirmItsYou.ExpiresIn')
    expect(t.argsOf('ConfirmItsYou.ExpiresIn')).toMatchObject({ count: 15 })

    const answered = await opened({ side: 'theirs', prompt: prompt({ open: false, answered: 'itsMe' }) })
    expect(answered.getByTestId(id(ConfirmChatCardIds.received))).toBeTruthy()
    expect(answered.queryByTestId(id(ConfirmChatCardIds.expiresTheirs))).toBeNull()
  })

  test('both waiting in one chat (I asked them, they asked me): each time left has its own id, once', async () => {
    jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([ask()])
    confirmItsYou.confirmPromptStore.set(prompt())
    const Chat = () => <>{useConfirmChatItems(CONN, 'Jordan').map((item) => item.renderEvent())}</>
    const tree = render(
      <BasicAppContext>
        <Chat />
      </BasicAppContext>
    )
    await act(async () => undefined)
    expect(tree.getAllByTestId(id(ConfirmChatCardIds.expiresMine))).toHaveLength(1)
    expect(tree.getAllByTestId(id(ConfirmChatCardIds.expiresTheirs))).toHaveLength(1)
  })

  test('mine, waiting, says how long is left', async () => {
    const t = i18nArgs()
    const tree = await show({
      side: 'mine',
      ask: ask({ expiresAt: new Date(Date.now() + 4 * MIN + 1000).toISOString() }),
      newest: true,
    })
    expect(tree.getByTestId(id(ConfirmChatCardIds.expiresMine))).toBeTruthy()
    expect(t.argsOf('ConfirmItsYou.ExpiresIn')).toMatchObject({ count: 5 })
  })
})

describe('the safety net: read again when the app comes back to the front', () => {
  test("'active' reads the records again; another state does not (control)", async () => {
    const listeners: ((state: string) => void)[] = []
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (s: string) => void) => {
      listeners.push(listener)
      return { remove: jest.fn() }
    }) as never)
    const read = jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([])
    renderHook(() => useConfirmChatItems(CONN, 'Jordan'))
    await act(async () => undefined)
    const before = read.mock.calls.length
    expect(listeners).toHaveLength(1)
    await act(async () => listeners[0]('background'))
    expect(read.mock.calls).toHaveLength(before)
    await act(async () => listeners[0]('active'))
    expect(read.mock.calls).toHaveLength(before + 1)
  })
})
