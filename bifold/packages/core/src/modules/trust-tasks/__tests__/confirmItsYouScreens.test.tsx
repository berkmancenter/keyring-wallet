/**
 * The "Confirm it's you" screens (mocks GVGac4je…), each behind its switch: the contact's row (compose, waiting,
 * confirmed, not them, no answer, cancelled) and the request sheet on the asked phone. The protocol is tested in
 * __tests__/modules/trust-tasks/confirmItsYou.test.ts; here, what each screen calls, with what, and what it says.
 */
import { act, fireEvent, render, userEvent, within } from '@testing-library/react-native'
import React from 'react'
import { StyleSheet } from 'react-native'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { ColorPalette } from '../../../theme'
import { testIdWithKey } from '../../../utils/testable'
import * as confirmItsYou from '../confirmItsYou'
import ConfirmItsYouModal, {
  ConfirmItsYouModalIds,
  resetConfirmPutOff,
  setConfirmOwnerCheckForTests,
} from '../components/ConfirmItsYouModal'
import { CONFIRM_ITS_YOU_REMOTE_OFF, setConfirmItsYouEnabled } from '../module/confirmItsYouFlag'
import * as ownerConfirm from '../module/ownerConfirm'
import { SEDI_KERI_REMOTE_OFF } from '../module/sediKeriRemoteOff'
import ConfirmItsYouRow, { ConfirmItsYouRowIds } from '../screens/ConfirmItsYouRow'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const AGENT = {} as never
const CONN = 'c-jordan'
const NOTE = 'Is this you calling? <b>Send</b> https://pay.example now'
const MIN = 60 * 1000

const show = async (element: React.ReactElement) => {
  const tree = render(<BasicAppContext>{element}</BasicAppContext>)
  await act(async () => undefined)
  return tree
}
const press = async (tree: Awaited<ReturnType<typeof show>>, key: string) =>
  act(async () => {
    fireEvent.press(tree.getByTestId(id(key)))
  })

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

beforeEach(() => {
  jest.restoreAllMocks()
  ;(useAgent as jest.Mock).mockReturnValue({ agent: AGENT })
  CONFIRM_ITS_YOU_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  setConfirmItsYouEnabled(true)
  confirmItsYou.confirmPromptStore.clear()
  resetConfirmPutOff()
  setConfirmOwnerCheckForTests(null)
  jest.spyOn(ownerConfirm, 'ownerLockKind').mockResolvedValue('faceId')
})
afterAll(() => setConfirmItsYouEnabled(false))

describe("the contact's row", () => {
  test('with nothing asked yet: the entry and the hint; Send sends the note as typed (control: Cancel sends nothing)', async () => {
    const read = jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([])
    const send = jest.spyOn(confirmItsYou, 'sendConfirmRequest').mockResolvedValue('sent')
    const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByText('ConfirmItsYou.Title')).toBeTruthy()
    expect(tree.getByText('ConfirmItsYou.Hint')).toBeTruthy()

    await press(tree, ConfirmItsYouRowIds.open)
    await act(async () => {
      fireEvent.changeText(tree.getByTestId(id(ConfirmItsYouRowIds.note)), NOTE)
    })
    await press(tree, ConfirmItsYouRowIds.cancelCompose)
    expect(send).not.toHaveBeenCalled()

    await press(tree, ConfirmItsYouRowIds.open)
    await act(async () => {
      fireEvent.changeText(tree.getByTestId(id(ConfirmItsYouRowIds.note)), NOTE)
    })
    read.mockResolvedValue([ask()])
    await press(tree, ConfirmItsYouRowIds.send)
    expect(send).toHaveBeenCalledWith(AGENT, CONN, NOTE)
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.WaitingTitle')
  })

  test('an empty note is not sent and the row says why', async () => {
    jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([])
    const send = jest.spyOn(confirmItsYou, 'sendConfirmRequest').mockResolvedValue('sent')
    const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    await press(tree, ConfirmItsYouRowIds.open)
    await press(tree, ConfirmItsYouRowIds.send)
    expect(send).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.said)).props.children).toBe('ConfirmItsYou.NoteNeeded')
  })

  test('waiting: the note exactly as typed, as plain text, and Cancel the request cancels that one', async () => {
    jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([ask()])
    const cancel = jest.spyOn(confirmItsYou, 'cancelConfirmRequest').mockResolvedValue('cancelled')
    const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.asked)).props.children).toBe(NOTE)
    expect(tree.getByText('ConfirmItsYou.CancelNote')).toBeTruthy()
    await press(tree, ConfirmItsYouRowIds.cancelRequest)
    expect(cancel).toHaveBeenCalledWith(AGENT, CONN, 't-1')
  })

  test('not them is the full alert with what to do now, never read as confirmed (control: itsMe is confirmed, no alert)', async () => {
    const read = jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([ask({ state: 'notMe' })])
    const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.NotThemTitle')
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.steps))).toBeTruthy()
    expect(tree.getByText('ConfirmItsYou.NotThemBody')).toBeTruthy()
    expect(tree.queryByText('ConfirmItsYou.ConfirmedTitle')).toBeNull()

    read.mockResolvedValue([ask({ state: 'itsMe', respondedAt: new Date().toISOString(), confirmedWith: 'faceId' })])
    const other = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(other.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.ConfirmedTitle')
    expect(other.queryByTestId(id(ConfirmItsYouRowIds.steps))).toBeNull()
    expect(other.getByText('ConfirmItsYou.ConfirmedCaveat')).toBeTruthy()
  })

  test.each([
    ['no lock named', undefined],
    ["'unknown'", 'unknown'],
  ] as const)(
    'an answer with %s says "confirmed on their phone", naming no lock (control: Face ID names it)',
    async (_label, confirmedWith) => {
      const read = jest
        .spyOn(confirmItsYou, 'confirmAsksOn')
        .mockResolvedValue([ask({ state: 'itsMe', respondedAt: new Date().toISOString(), confirmedWith })])
      const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
      expect(tree.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe(
        'ConfirmItsYou.ConfirmedTitleOnPhone'
      )
      expect(tree.queryByText('ConfirmItsYou.ConfirmedTitle')).toBeNull()

      read.mockResolvedValue([ask({ state: 'notMe', respondedAt: new Date().toISOString(), confirmedWith })])
      const notThem = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
      expect(notThem.getByText('ConfirmItsYou.NotThemSignedOnPhone')).toBeTruthy()
      expect(notThem.queryByText('ConfirmItsYou.NotThemSigned')).toBeNull()

      read.mockResolvedValue([ask({ state: 'itsMe', respondedAt: new Date().toISOString(), confirmedWith: 'faceId' })])
      const named = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
      expect(named.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.ConfirmedTitle')
    }
  )

  test('the words that name no lock carry no lock in any language (control: the lock words do)', () => {
    for (const lang of ['en', 'fr', 'pt-br']) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const words = require(`../../../localization/${lang}/${lang}.json`).ConfirmItsYou
      const locks = Object.values(words.Lock as Record<string, string>)
      for (const key of ['ConfirmedTitleOnPhone', 'NotThemSignedOnPhone', 'SentSignedNoLock']) {
        expect(words[key]).toEqual(expect.any(String))
        expect(words[key]).not.toMatch(/\{\{(lock|method)\}\}/)
        for (const lock of locks) expect(words[key]).not.toContain(lock)
      }
      expect(words.ConfirmedTitle).toMatch(/\{\{lock\}\}/)
      expect(words.SentSigned).toMatch(/\{\{method\}\}/)
    }
  })

  test('a waiting request turns into no answer on a clock, with no event (control: before its time it still waits)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    try {
      jest
        .spyOn(confirmItsYou, 'confirmAsksOn')
        .mockResolvedValue([ask({ expiresAt: new Date(Date.now() + 2 * MIN).toISOString() })])
      const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
      expect(tree.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.WaitingTitle')
      await act(async () => {
        jest.advanceTimersByTime(MIN)
      })
      expect(tree.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.WaitingTitle')
      await act(async () => {
        jest.advanceTimersByTime(2 * MIN)
      })
      expect(tree.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.ExpiredTitle')
    } finally {
      jest.useRealTimers()
    }
  })

  test('no answer: Ask again sends a new request with the same note', async () => {
    jest
      .spyOn(confirmItsYou, 'confirmAsksOn')
      .mockResolvedValue([ask({ expiresAt: new Date(Date.now() - MIN).toISOString() })])
    const send = jest.spyOn(confirmItsYou, 'sendConfirmRequest').mockResolvedValue('sent')
    const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.ExpiredTitle')
    expect(tree.getByText('ConfirmItsYou.AskAgainNote')).toBeTruthy()
    await press(tree, ConfirmItsYouRowIds.askAgain)
    expect(send).toHaveBeenCalledWith(AGENT, CONN, NOTE)
  })

  test('a cancelled request says so, and the entry is back to ask again', async () => {
    jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([ask({ state: 'cancelled' })])
    const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.status)).props.children).toBe('ConfirmItsYou.CancelledTitle')
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.open))).toBeTruthy()
  })

  test.each(OFFS)('%s: no row at all, and nothing read (control: on, the row shows)', async (_name, switchOff) => {
    const read = jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([])
    const on = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(on.queryByTestId(id(ConfirmItsYouRowIds.row))).not.toBeNull()
    on.unmount()
    read.mockClear()

    switchOff()
    const off = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(off.queryByTestId(id(ConfirmItsYouRowIds.row))).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })
})

describe('the request sheet on the asked phone', () => {
  test('shows the note exactly as written, as plain text, with both answers and the lock line', async () => {
    jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
    confirmItsYou.confirmPromptStore.set(prompt())
    const tree = await show(<ConfirmItsYouModal />)
    expect(tree.getByTestId(id(ConfirmItsYouModalIds.note)).props.children).toBe(NOTE)
    expect(tree.getByTestId(id(ConfirmItsYouModalIds.itsMe))).toBeTruthy()
    expect(tree.getByTestId(id(ConfirmItsYouModalIds.notMe))).toBeTruthy()
    expect(tree.getByText('ConfirmItsYou.PinInstead')).toBeTruthy()
  })

  test.each(['itsMe', 'notMe'] as const)(
    '%s goes through the owner check, then the sheet says what was sent',
    async (decision) => {
      jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
      confirmItsYou.confirmPromptStore.set(prompt())
      const check = jest.fn(async () => ({ ok: true }))
      setConfirmOwnerCheckForTests(check)
      const answer = jest
        .spyOn(confirmItsYou, 'answerConfirmRequest')
        .mockImplementation(async (_agent, _conn, _decision, confirm, reason) => {
          await confirm(reason)
          return 'sent'
        })
      const tree = await show(<ConfirmItsYouModal />)
      await press(tree, decision === 'itsMe' ? ConfirmItsYouModalIds.itsMe : ConfirmItsYouModalIds.notMe)
      expect(answer.mock.calls[0].slice(0, 3)).toEqual([AGENT, CONN, decision])
      expect(answer.mock.calls[0][4]).toBe(
        decision === 'itsMe' ? 'ConfirmItsYou.ItsMeReason' : 'ConfirmItsYou.NotMeReason'
      )
      expect(answer.mock.calls[0][5]).toBe('faceId')
      expect(check).toHaveBeenCalledTimes(1)
      expect(tree.getByTestId(id(ConfirmItsYouModalIds.sent))).toBeTruthy()
      expect(
        tree.getByText(decision === 'itsMe' ? 'ConfirmItsYou.YouToldItsMe' : 'ConfirmItsYou.YouToldNotMe')
      ).toBeTruthy()
    }
  )

  test('a quick answer before the lock probe resolves sends the lock read at answer time, never the starting value', async () => {
    jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
    confirmItsYou.confirmPromptStore.set(prompt())
    setConfirmOwnerCheckForTests(jest.fn(async () => ({ ok: true })))
    jest
      .spyOn(ownerConfirm, 'ownerLockKind')
      .mockReturnValueOnce(new Promise(() => undefined)) // the mount probe never answers
      .mockResolvedValue('faceId')
    const answer = jest.spyOn(confirmItsYou, 'answerConfirmRequest').mockResolvedValue('sent')
    const tree = await show(<ConfirmItsYouModal />)
    await press(tree, ConfirmItsYouModalIds.itsMe)
    expect(answer.mock.calls[0][5]).toBe('faceId')
    expect(tree.getByText('ConfirmItsYou.SentSigned')).toBeTruthy()
  })

  test('when the phone cannot tell its lock, the sheet says "signed", naming none (control: Face ID is named, above)', async () => {
    jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
    confirmItsYou.confirmPromptStore.set(prompt())
    setConfirmOwnerCheckForTests(jest.fn(async () => ({ ok: true })))
    jest.spyOn(ownerConfirm, 'ownerLockKind').mockResolvedValue('unknown')
    jest.spyOn(confirmItsYou, 'answerConfirmRequest').mockResolvedValue('sent')
    const tree = await show(<ConfirmItsYouModal />)
    await press(tree, ConfirmItsYouModalIds.itsMe)
    expect(tree.getByText('ConfirmItsYou.SentSignedNoLock')).toBeTruthy()
    expect(tree.queryByText('ConfirmItsYou.SentSigned')).toBeNull()
  })

  test('switched off, the sheet runs nothing: no lock probe on mount (control: on, it probes)', async () => {
    jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
    const probe = jest.spyOn(ownerConfirm, 'ownerLockKind').mockResolvedValue('faceId')
    setConfirmItsYouEnabled(false)
    await show(<ConfirmItsYouModal />)
    expect(probe).not.toHaveBeenCalled()

    setConfirmItsYouEnabled(true)
    await show(<ConfirmItsYouModal />)
    expect(probe).toHaveBeenCalled()
  })

  test('cancelled at the lock: nothing failed, the request stays (control: a failure says so)', async () => {
    jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
    confirmItsYou.confirmPromptStore.set(prompt())
    const answer = jest.spyOn(confirmItsYou, 'answerConfirmRequest').mockResolvedValue('cancelled')
    const tree = await show(<ConfirmItsYouModal />)
    await press(tree, ConfirmItsYouModalIds.itsMe)
    expect(tree.queryByTestId(id(ConfirmItsYouModalIds.failed))).toBeNull()
    expect(tree.queryByTestId(id(ConfirmItsYouModalIds.sent))).toBeNull()
    expect(tree.getByTestId(id(ConfirmItsYouModalIds.itsMe))).toBeTruthy()

    answer.mockResolvedValue('failed')
    await press(tree, ConfirmItsYouModalIds.itsMe)
    expect(tree.getByTestId(id(ConfirmItsYouModalIds.failed)).props.children).toBe('ConfirmItsYou.Failed')
  })

  test('Not now sends nothing and hides it', async () => {
    jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
    confirmItsYou.confirmPromptStore.set(prompt())
    const answer = jest.spyOn(confirmItsYou, 'answerConfirmRequest')
    const tree = await show(<ConfirmItsYouModal />)
    await press(tree, ConfirmItsYouModalIds.notNow)
    expect(answer).not.toHaveBeenCalled()
    expect(tree.queryByTestId(id(ConfirmItsYouModalIds.sheet))).toBeNull()
  })

  test('a request past its time is not shown (control: one in time is)', async () => {
    jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
    confirmItsYou.confirmPromptStore.set(prompt({ expiresAt: new Date(Date.now() - 1000).toISOString() }))
    const late = await show(<ConfirmItsYouModal />)
    expect(late.queryByTestId(id(ConfirmItsYouModalIds.sheet))).toBeNull()
    late.unmount()
    confirmItsYou.confirmPromptStore.set(prompt())
    const inTime = await show(<ConfirmItsYouModal />)
    expect(inTime.queryByTestId(id(ConfirmItsYouModalIds.sheet))).not.toBeNull()
  })

  test.each(OFFS)(
    '%s: no sheet, nothing brought back, even with a request waiting (control: on, it shows)',
    async (_name, switchOff) => {
      const restore = jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
      confirmItsYou.confirmPromptStore.set(prompt())
      const on = await show(<ConfirmItsYouModal />)
      expect(on.queryByTestId(id(ConfirmItsYouModalIds.sheet))).not.toBeNull()
      on.unmount()
      restore.mockClear()

      switchOff()
      const off = await show(<ConfirmItsYouModal />)
      expect(off.queryByTestId(id(ConfirmItsYouModalIds.sheet))).toBeNull()
      expect(restore).not.toHaveBeenCalled()
    }
  )
})

// ---------------------------------------------------------------------------------------------------------------
// 278.17: the maintainer's points on Confirm it's you (IN-677/678), each with its control.

const LANGS = ['en', 'fr', 'pt-br'] as const
const wordsOf = (lang: string): Record<string, unknown> =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  require(`../../../localization/${lang}/${lang}.json`).ConfirmItsYou
const allStrings = (words: Record<string, unknown>): string[] =>
  Object.values(words).flatMap((v) => (typeof v === 'string' ? [v] : allStrings(v as Record<string, unknown>)))

describe('the words (IN-677/678)', () => {
  test('no "Demo" anywhere on Confirm it\'s you, in any language, and no DemoChip key left to show', () => {
    for (const lang of LANGS) {
      const words = wordsOf(lang)
      expect(words.DemoChip).toBeUndefined()
      for (const text of allStrings(words)) expect(text).not.toMatch(/d[eé]mo/i)
      // Control: the block is there and read.
      expect(allStrings(words).length).toBeGreaterThan(60)
    }
  })

  test('no money wording in any language (the example note, the hint, the caveat, the alert, the card-details step)', () => {
    for (const lang of LANGS) {
      for (const text of allStrings(wordsOf(lang)))
        expect(text).not.toMatch(/money|argent|dinheiro|card details|bancaire|cartão/i)
    }
    expect(wordsOf('en').NotePlaceholder).toBe('Is this really you?')
  })

  test('general wording: "Confirm with", "asks you to confirm", Confirm / No, that wasn\'t me, "Confirmed"', () => {
    const en = wordsOf('en')
    expect(en.Title).toBe('Confirm with {{name}}')
    expect(en.PromptTitle).toBe('{{asker}} asks you to confirm')
    expect(en.ItsMe).toBe('Confirm')
    expect(en.NotMe).toBe("No, that wasn't me")
    expect(en.ConfirmedTitle).toBe('Confirmed by {{name}} with {{lock}} at {{time}}')
    expect(en.ConfirmedTitleOnPhone).toBe('Confirmed by {{name}} on their phone at {{time}}')
    for (const text of allStrings(en)) expect(text).not.toMatch(/it's me|it's you/i)
  })

  test('every language has exactly the keys English has', () => {
    const keys = (w: Record<string, unknown>) => Object.keys(w).sort()
    for (const lang of ['fr', 'pt-br']) expect(keys(wordsOf(lang))).toEqual(keys(wordsOf('en')))
  })

  test('the row and the sheet show no Demo chip (control: they show their titles)', async () => {
    jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([])
    jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
    const row = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(row.getByText('ConfirmItsYou.Title')).toBeTruthy()
    expect(row.queryByText('ConfirmItsYou.DemoChip')).toBeNull()
    confirmItsYou.confirmPromptStore.set(prompt())
    const sheet = await show(<ConfirmItsYouModal />)
    expect(sheet.getByText('ConfirmItsYou.PromptTitle')).toBeTruthy()
    expect(sheet.queryByText('ConfirmItsYou.DemoChip')).toBeNull()
  })
})

describe('the red card (IN-677)', () => {
  type Node = { props: Record<string, unknown> }
  const flat = (node: Node): { backgroundColor?: unknown } => StyleSheet.flatten(node.props.style as never) ?? {}

  test('not them: ONE solid red card, white words, and what to do now inside it', async () => {
    jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([ask({ state: 'notMe' })])
    const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    const alarm = tree.getByTestId(id(ConfirmItsYouRowIds.alarm))
    expect(flat(alarm).backgroundColor).toBe(ColorPalette.semantic.error)
    expect(alarm.props.accessibilityRole).toBe('alert')
    const steps = within(alarm).getByTestId(id(ConfirmItsYouRowIds.steps))
    expect(within(steps).getByText('ConfirmItsYou.WhatToDo')).toBeTruthy()
    // Every line on the red carries the alarm's own white words, not the theme's text colour (which can be anything:
    // in the test theme it is white already, so the colour alone would prove nothing).
    const own = (line: Node) =>
      [line.props.style].flat(Infinity).some((part) => {
        const style = part as Record<string, unknown> | null
        return !!style && style.color === ColorPalette.grayscale.white && Object.keys(style).length === 1
      })
    const lines = [
      within(alarm).getByText('ConfirmItsYou.NotThemBody'),
      within(steps).getByText('ConfirmItsYou.WhatToDo'),
      within(steps).getByText(/ConfirmItsYou\.StepHangUp/),
      within(steps).getByText(/ConfirmItsYou\.StepCallBack/),
      within(steps).getByText(/ConfirmItsYou\.StepNoCodes/),
    ]
    for (const line of lines) expect(own(line)).toBe(true)
    // Control: the confirmed card's words do not carry it.
    jest
      .spyOn(confirmItsYou, 'confirmAsksOn')
      .mockResolvedValue([ask({ state: 'itsMe', respondedAt: new Date().toISOString(), confirmedWith: 'faceId' })])
    const good = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(own(good.getByText('ConfirmItsYou.ConfirmedBody'))).toBe(false)
  })

  test.each([
    ['confirmed', ask({ state: 'itsMe', respondedAt: new Date().toISOString(), confirmedWith: 'faceId' })],
    ['no answer', ask({ expiresAt: new Date(Date.now() - MIN).toISOString() })],
    ['cancelled', ask({ state: 'cancelled' })],
    ['waiting', ask()],
  ])('%s: no red card (stays grey)', async (_name, one) => {
    jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([one])
    const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.status))).toBeTruthy()
    expect(tree.queryByTestId(id(ConfirmItsYouRowIds.alarm))).toBeNull()
  })

  test('showing a not-them answer, or showing it again, never vibrates: only its arrival does (confirmItsYou.test)', async () => {
    const { Vibration } = jest.requireActual('react-native')
    const buzz = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined)
    buzz.mockClear()
    jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([ask({ state: 'notMe' })])
    const first = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(first.getByTestId(id(ConfirmItsYouRowIds.alarm))).toBeTruthy()
    first.unmount()
    const again = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />)
    expect(again.getByTestId(id(ConfirmItsYouRowIds.alarm))).toBeTruthy()
    expect(buzz).not.toHaveBeenCalled()
  })
})

describe('the "Confirm with <name>" button (IN-678)', () => {
  test('a full-width button; one tap opens the note form in place, and Send sends the note as typed', async () => {
    const read = jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([])
    const send = jest.spyOn(confirmItsYou, 'sendConfirmRequest').mockResolvedValue('sent')
    const tree = await show(<ConfirmItsYouRow variant="button" connectionId={CONN} name="Jordan" />)
    const button = tree.getByTestId(id(ConfirmItsYouRowIds.button))
    expect(within(button).getByText('ConfirmItsYou.Title')).toBeTruthy()
    // The button form never shows the Safety row's own entry or status.
    expect(tree.queryByTestId(id(ConfirmItsYouRowIds.row))).toBeNull()

    const user = userEvent.setup()
    await user.press(button)
    await user.type(tree.getByTestId(id(ConfirmItsYouRowIds.note)), 'Is this really you?')
    read.mockResolvedValue([ask({ note: 'Is this really you?' })])
    await user.press(tree.getByTestId(id(ConfirmItsYouRowIds.send)))
    expect(send).toHaveBeenCalledWith(AGENT, CONN, 'Is this really you?')
    // A request now waits: the button steps aside (control: it showed before the send).
    expect(tree.queryByTestId(id(ConfirmItsYouRowIds.button))).toBeNull()
  })

  test.each([
    ['confirmed', ask({ state: 'itsMe', respondedAt: new Date().toISOString() })],
    ['not them', ask({ state: 'notMe' })],
    ['no answer', ask({ expiresAt: new Date(Date.now() - MIN).toISOString() })],
  ])('after a request that is %s, the button is back to ask again', async (_name, one) => {
    jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([one])
    const tree = await show(<ConfirmItsYouRow variant="button" connectionId={CONN} name="Jordan" />)
    expect(tree.getByTestId(id(ConfirmItsYouRowIds.button))).toBeTruthy()
  })

  test.each(OFFS)('%s: no button, and nothing read (control: on, it shows)', async (_name, switchOff) => {
    const read = jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([])
    const on = await show(<ConfirmItsYouRow variant="button" connectionId={CONN} name="Jordan" />)
    expect(on.queryByTestId(id(ConfirmItsYouRowIds.button))).not.toBeNull()
    on.unmount()
    read.mockClear()

    switchOff()
    const off = await show(<ConfirmItsYouRow variant="button" connectionId={CONN} name="Jordan" />)
    expect(off.queryByTestId(id(ConfirmItsYouRowIds.button))).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  test('with no relationship to ask over (no connection), no button', async () => {
    jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue([])
    const tree = await show(<ConfirmItsYouRow variant="button" connectionId={null} name="Jordan" />)
    expect(tree.queryByTestId(id(ConfirmItsYouRowIds.button))).toBeNull()
  })
})

describe('"This request has expired" on the asked phone (local only)', () => {
  test('the time runs out with the sheet up: it says so, with no way left to answer, until Close', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    try {
      jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
      const answer = jest.spyOn(confirmItsYou, 'answerConfirmRequest')
      confirmItsYou.confirmPromptStore.set(prompt({ expiresAt: new Date(Date.now() + 2 * MIN).toISOString() }))
      const tree = await show(<ConfirmItsYouModal />)
      await act(async () => {
        jest.advanceTimersByTime(MIN)
      })
      // Control: before its time, it is still answerable.
      expect(tree.getByTestId(id(ConfirmItsYouModalIds.itsMe))).toBeTruthy()
      expect(tree.queryByTestId(id(ConfirmItsYouModalIds.expired))).toBeNull()

      await act(async () => {
        jest.advanceTimersByTime(2 * MIN)
      })
      expect(tree.getByTestId(id(ConfirmItsYouModalIds.expired)).props.children).toBe(
        'ConfirmItsYou.ExpiredPromptTitle'
      )
      expect(tree.queryByTestId(id(ConfirmItsYouModalIds.itsMe))).toBeNull()
      expect(tree.queryByTestId(id(ConfirmItsYouModalIds.notMe))).toBeNull()
      expect(tree.queryByTestId(id(ConfirmItsYouModalIds.notNow))).toBeNull()
      expect(answer).not.toHaveBeenCalled()

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
      await user.press(tree.getByTestId(id(ConfirmItsYouModalIds.close)))
      expect(tree.queryByTestId(id(ConfirmItsYouModalIds.sheet))).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  test('a new request arriving while "expired" shows waits behind it: Close, then the new one', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    try {
      jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
      confirmItsYou.confirmPromptStore.set(prompt({ expiresAt: new Date(Date.now() + MIN).toISOString() }))
      const tree = await show(<ConfirmItsYouModal />)
      await act(async () => {
        jest.advanceTimersByTime(2 * MIN)
      })
      expect(tree.getByTestId(id(ConfirmItsYouModalIds.expired))).toBeTruthy()

      await act(async () => {
        confirmItsYou.confirmPromptStore.set(prompt({ connectionId: 'c-alex', asker: 'Alex', note: 'second' }))
        confirmItsYou.confirmEvents.emit('prompt', { connectionId: 'c-alex' })
      })
      expect(tree.getByTestId(id(ConfirmItsYouModalIds.expired))).toBeTruthy()
      expect(tree.queryByTestId(id(ConfirmItsYouModalIds.itsMe))).toBeNull()

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
      await user.press(tree.getByTestId(id(ConfirmItsYouModalIds.close)))
      expect(tree.getByTestId(id(ConfirmItsYouModalIds.note)).props.children).toBe('second')
      expect(tree.getByTestId(id(ConfirmItsYouModalIds.itsMe))).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })

  test('an answer tried just after the time ran out says expired, rather than the sheet vanishing', async () => {
    jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
    const open = prompt()
    confirmItsYou.confirmPromptStore.set(open)
    jest.spyOn(confirmItsYou, 'answerConfirmRequest').mockImplementation(async () => {
      open.expiresAt = new Date(Date.now() - 1000).toISOString()
      return 'gone'
    })
    const tree = await show(<ConfirmItsYouModal />)
    await userEvent.setup().press(tree.getByTestId(id(ConfirmItsYouModalIds.itsMe)))
    expect(tree.getByTestId(id(ConfirmItsYouModalIds.expired))).toBeTruthy()
    expect(tree.queryByTestId(id(ConfirmItsYouModalIds.itsMe))).toBeNull()
  })

  test.each([
    ["unreadable ('not-a-date')", (open: confirmItsYou.ConfirmPrompt) => (open.expiresAt = 'not-a-date')],
    ['missing (null)', (open: confirmItsYou.ConfirmPrompt) => ((open as { expiresAt: unknown }).expiresAt = null)],
    ['missing (absent)', (open: confirmItsYou.ConfirmPrompt) => delete (open as { expiresAt?: unknown }).expiresAt],
  ])(
    'an expiresAt that becomes %s reads as expired: the sheet says so and no answer is sent (owner never asked)',
    async (_name, spoil) => {
      jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
      const open = prompt()
      confirmItsYou.confirmPromptStore.set(open)
      const owner = jest.fn(async () => ({ ok: true }))
      setConfirmOwnerCheckForTests(owner)
      // The real answer, not a stand-in: it must itself refuse the request as past due.
      const answer = jest.spyOn(confirmItsYou, 'answerConfirmRequest')
      const tree = await show(<ConfirmItsYouModal />)
      expect(tree.getByTestId(id(ConfirmItsYouModalIds.itsMe))).toBeTruthy()
      spoil(open)
      await userEvent.setup().press(tree.getByTestId(id(ConfirmItsYouModalIds.itsMe)))
      await expect(answer.mock.results[0].value).resolves.toBe('gone')
      expect(owner).not.toHaveBeenCalled()
      expect(tree.getByTestId(id(ConfirmItsYouModalIds.expired)).props.children).toBe(
        'ConfirmItsYou.ExpiredPromptTitle'
      )
      expect(tree.queryByTestId(id(ConfirmItsYouModalIds.itsMe))).toBeNull()
      expect(tree.queryByTestId(id(ConfirmItsYouModalIds.notMe))).toBeNull()
    }
  )

  test("'gone' for a request still in time (answered elsewhere) is not called expired", async () => {
    jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
    confirmItsYou.confirmPromptStore.set(prompt())
    jest.spyOn(confirmItsYou, 'answerConfirmRequest').mockImplementation(async () => {
      confirmItsYou.confirmPromptStore.clear()
      return 'gone'
    })
    const tree = await show(<ConfirmItsYouModal />)
    await userEvent.setup().press(tree.getByTestId(id(ConfirmItsYouModalIds.itsMe)))
    expect(tree.queryByTestId(id(ConfirmItsYouModalIds.expired))).toBeNull()
  })

  test.each(OFFS)('%s: no expired sheet either', async (_name, switchOff) => {
    jest.spyOn(confirmItsYou, 'restoreConfirmPrompts').mockResolvedValue(undefined)
    confirmItsYou.confirmPromptStore.set(prompt({ expiresAt: new Date(Date.now() + 50).toISOString() }))
    switchOff()
    const tree = await show(<ConfirmItsYouModal />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150))
    })
    expect(tree.queryByTestId(id(ConfirmItsYouModalIds.sheet))).toBeNull()
  })
})
