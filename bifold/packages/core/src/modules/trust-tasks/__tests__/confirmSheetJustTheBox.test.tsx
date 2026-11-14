/**
 * The chat's "Confirm with {{name}}" sheet, cut to just the box (mock D1, Alberto's pick 2026-11-13: the sheet on
 * 278.18 was "way too verbose and long"): one line, the note and Send. The last answer is one line; what a
 * confirmation proves sits behind the (i); Earlier stays on the contact page. Never cut: the red "not them" card,
 * whole, and "don't act on it" while waiting or after no answer. Each row has a control, mostly the contact page's
 * row, which is unchanged.
 */
import { act, fireEvent, render, within } from '@testing-library/react-native'
import React from 'react'
import { Modal } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'

import { useAgent } from '@bifold/react-hooks'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'
import { testIdWithKey } from '../../../utils/testable'
import * as confirmItsYou from '../confirmItsYou'
import { NOTE_MAX } from '../confirmItsYouSpec'
import ConfirmWithSheet, { ConfirmWithSheetIds } from '../components/ConfirmWithSheet'
import { CONFIRM_ITS_YOU_REMOTE_OFF, setConfirmItsYouEnabled } from '../module/confirmItsYouFlag'
import { SEDI_KERI_REMOTE_OFF } from '../module/sediKeriRemoteOff'
import ConfirmItsYouRow, { ConfirmItsYouRowIds as Ids, SHEET_COUNTER_FROM } from '../screens/ConfirmItsYouRow'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const CONN = 'c-jordan'
const MIN = 60 * 1000
type Tree = ReturnType<typeof render>

const ask = (over: Partial<confirmItsYou.ConfirmAsk> = {}): confirmItsYou.ConfirmAsk => ({
  threadId: 't-1',
  challenge: 'c'.repeat(43),
  note: 'Did you just send me an address?',
  askedAt: new Date(Date.now() - 2 * MIN).toISOString(),
  expiresAt: new Date(Date.now() + 13 * MIN).toISOString(),
  state: 'waiting',
  ...over,
})
const CONFIRMED = ask({ state: 'itsMe', answeredAt: new Date().toISOString() })
const NOT_ME = ask({ state: 'notMe', answeredAt: new Date().toISOString() })
const EXPIRED = ask({ expiresAt: new Date(Date.now() - MIN).toISOString() })

const show = async (element: React.ReactElement, asks: confirmItsYou.ConfirmAsk[] = []) => {
  jest.spyOn(confirmItsYou, 'confirmAsksOn').mockResolvedValue(asks)
  const tree = render(<BasicAppContext>{element}</BasicAppContext>)
  await act(async () => undefined)
  return tree
}
const sheet = (asks: confirmItsYou.ConfirmAsk[] = []) =>
  show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" variant="sheet" />, asks)
/** The contact page's row, opened the way the page opens it: a tap on its entry. */
const contactRow = async (asks: confirmItsYou.ConfirmAsk[] = []) => {
  const tree = await show(<ConfirmItsYouRow connectionId={CONN} name="Jordan" />, asks)
  fireEvent.press(tree.getByTestId(id(Ids.open)))
  return tree
}
const has = (tree: Tree, key: string) => tree.queryByTestId(id(key)) !== null
const statusOf = (tree: Tree) => tree.getByTestId(id(Ids.status)).props.children

beforeEach(() => {
  jest.restoreAllMocks()
  ;(useAgent as jest.Mock).mockReturnValue({ agent: {} })
  CONFIRM_ITS_YOU_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  setConfirmItsYouEnabled(true)
})
afterAll(() => setConfirmItsYouEnabled(false))

describe('the chat sheet, just the box (D1)', () => {
  test('nothing asked yet: one line, the (i), the note and Send; none of the long text (control: the contact row keeps it)', async () => {
    const tree = await sheet()
    expect(tree.getByText('ConfirmItsYou.SheetHint')).toBeTruthy()
    expect(has(tree, Ids.proofToggle)).toBe(true)
    expect(tree.getByTestId(id(Ids.note)).props.placeholder).toBe('ConfirmItsYou.SheetPlaceholder')
    expect(has(tree, Ids.send)).toBe(true)
    for (const gone of ['ConfirmItsYou.ComposeTitle', 'ConfirmItsYou.ComposeBody', 'ConfirmItsYou.NoteOnlyThey'])
      expect(tree.queryByText(gone)).toBeNull()
    expect(has(tree, Ids.counter)).toBe(false)
    expect(has(tree, Ids.cancelCompose)).toBe(false)
    tree.unmount()
    const row = await contactRow()
    expect(row.getByText('ConfirmItsYou.ComposeBody')).toBeTruthy()
    expect(has(row, Ids.counter)).toBe(true)
  })

  test('the counter shows only near the limit', async () => {
    const tree = await sheet()
    fireEvent.changeText(tree.getByTestId(id(Ids.note)), 'x'.repeat(SHEET_COUNTER_FROM - 1))
    expect(has(tree, Ids.counter)).toBe(false)
    fireEvent.changeText(tree.getByTestId(id(Ids.note)), 'x'.repeat(SHEET_COUNTER_FROM))
    expect(has(tree, Ids.counter)).toBe(true)
    // Pinned by literals: within 40 of the 280 limit (ac, #1066), not whatever the constant says.
    expect(NOTE_MAX).toBe(280)
    expect(SHEET_COUNTER_FROM).toBe(240)
  })

  test('Send sends the note as typed (control: an empty note sends nothing)', async () => {
    const send = jest.spyOn(confirmItsYou, 'sendConfirmRequest').mockResolvedValue('sent')
    const tree = await sheet()
    await act(async () => fireEvent.press(tree.getByTestId(id(Ids.send))))
    expect(send).not.toHaveBeenCalled()
    fireEvent.changeText(tree.getByTestId(id(Ids.note)), 'Is this you?')
    await act(async () => fireEvent.press(tree.getByTestId(id(Ids.send))))
    expect(send).toHaveBeenCalledWith({}, CONN, 'Is this you?')
  })

  test('confirmed: one line; what it proves only behind the (i), and again hidden (control: the contact row shows it all)', async () => {
    const tree = await sheet([CONFIRMED])
    expect(statusOf(tree)).toBe('ConfirmItsYou.LastConfirmed')
    expect(has(tree, Ids.last)).toBe(true)
    expect(tree.queryByText('ConfirmItsYou.ConfirmedBody')).toBeNull()
    expect(tree.queryByText('ConfirmItsYou.ConfirmedCaveat')).toBeNull()
    expect(has(tree, Ids.proof)).toBe(false)
    fireEvent.press(tree.getByTestId(id(Ids.proofToggle)))
    expect(has(tree, Ids.proof)).toBe(true)
    expect(tree.getByText('ConfirmItsYou.ConfirmedCaveat')).toBeTruthy()
    expect(tree.getByText('ConfirmItsYou.EarlierOnContact')).toBeTruthy()
    fireEvent.press(tree.getByTestId(id(Ids.last)))
    expect(has(tree, Ids.proof)).toBe(false)
    expect(has(tree, Ids.note)).toBe(true)
    tree.unmount()
    const row = await contactRow([CONFIRMED])
    expect(row.getByText('ConfirmItsYou.ConfirmedBody')).toBeTruthy()
    expect(row.getByText('ConfirmItsYou.ConfirmedCaveat')).toBeTruthy()
  })

  test('Earlier never shows in the sheet (control: the contact row lists it)', async () => {
    const asks = [CONFIRMED, { ...EXPIRED, threadId: 't-2' }, { ...NOT_ME, threadId: 't-3' }]
    const tree = await sheet(asks)
    expect(has(tree, Ids.earlier)).toBe(false)
    tree.unmount()
    const row = await contactRow(asks)
    expect(has(row, Ids.earlier)).toBe(true)
  })

  test('not them: the whole red card with what to do, never cut to a line (control: confirmed is one line)', async () => {
    const tree = await sheet([NOT_ME])
    expect(has(tree, Ids.alarm)).toBe(true)
    expect(has(tree, Ids.steps)).toBe(true)
    expect(tree.getByText('ConfirmItsYou.NotThemBody')).toBeTruthy()
    expect(has(tree, Ids.last)).toBe(false)
    // The box stays under it, as on 278.18's sheet: asking again is the person's choice.
    expect(has(tree, Ids.note)).toBe(true)
    expect(has(tree, Ids.send)).toBe(true)
  })

  test('waiting: "don\'t act on it" and Cancel, and no note box, so no second request (control: confirmed has the box)', async () => {
    const tree = await sheet([ask()])
    expect(statusOf(tree)).toBe('ConfirmItsYou.WaitingTitle')
    expect(tree.getByText('ConfirmItsYou.WaitingBody')).toBeTruthy()
    expect(has(tree, Ids.cancelRequest)).toBe(true)
    expect(has(tree, Ids.note)).toBe(false)
    expect(has(tree, Ids.send)).toBe(false)
  })

  test("no answer: one line that still says don't act, and the box to ask again", async () => {
    const tree = await sheet([EXPIRED])
    expect(statusOf(tree)).toBe('ConfirmItsYou.LastExpired')
    expect(has(tree, Ids.note)).toBe(true)
  })
})

describe('the sheet around it', () => {
  test('opens on the short form; the ✕ and a tap above it both close it', async () => {
    const onClose = jest.fn()
    const tree = await show(<ConfirmWithSheet connectionId={CONN} name="Jordan" visible onClose={onClose} />)
    expect(has(tree, Ids.sheet)).toBe(true)
    expect(has(tree, Ids.row)).toBe(false)
    fireEvent.press(tree.getByTestId(id(ConfirmWithSheetIds.close)))
    fireEvent.press(tree.getByTestId(id(ConfirmWithSheetIds.backdrop), { includeHiddenElements: true }))
    expect(onClose).toHaveBeenCalledTimes(2)
    // A screen reader skips the backdrop and starts at the title; the ✕ is its way out.
    const backdrop = tree.getByTestId(id(ConfirmWithSheetIds.backdrop), { includeHiddenElements: true })
    expect(backdrop.props.accessible).toBe(false)
    expect(backdrop.props.importantForAccessibility).toBe('no')
    expect(tree.getByTestId(id(ConfirmWithSheetIds.close)).props.accessibilityRole).toBe('button')
  })

  test('the switch off: nothing, even opened (control: on, above)', async () => {
    setConfirmItsYouEnabled(false)
    const tree = await show(<ConfirmWithSheet connectionId={CONN} name="Jordan" visible onClose={jest.fn()} />)
    expect(has(tree, ConfirmWithSheetIds.sheet)).toBe(false)
    expect(has(tree, Ids.sheet)).toBe(false)
  })

  test('the keyboard never covers the note or Send: the sheet sits in a view that lifts it by the whole keyboard', async () => {
    // 278.19 on an iPhone: the keyboard hid the note and Send. The sheet is a Modal, its own window, so the chat's
    // keyboard handling never reaches it; the lift has to be inside. (keyboard-controller's view is a View in jest.)
    const tree = await show(<ConfirmWithSheet connectionId={CONN} name="Jordan" visible onClose={jest.fn()} />)
    const lift = tree
      .UNSAFE_getAllByType(KeyboardAvoidingView)
      .find((v) => v.props.testID === id(ConfirmWithSheetIds.lift))
    expect(lift).toBeTruthy()
    expect(lift!.props.behavior).toBe('padding')
    // It fills the window, which is drawn under both bars on Android, so the lift is the keyboard's full height.
    expect(lift!.props.keyboardVerticalOffset).toBe(0)
    const modal = tree.UNSAFE_getByType(Modal)
    expect(modal.props.statusBarTranslucent).toBe(true)
    expect(modal.props.navigationBarTranslucent).toBe(true)
    // What it lifts: the note and Send are inside it.
    const inside = within(tree.getByTestId(id(ConfirmWithSheetIds.lift)))
    expect(inside.queryByTestId(id(Ids.note))).not.toBeNull()
    expect(inside.queryByTestId(id(Ids.send))).not.toBeNull()
  })
})

describe('after answering: "contact", never "call" (Alberto, 278.19)', () => {
  const LOCALES = { en, fr, 'pt-BR': ptBr } as unknown as Record<string, { ConfirmItsYou: Record<string, string> }>
  const CALL = { en: /\bcall/i, fr: /\bappel/i, 'pt-BR': /\bligue|\bligar/i } as Record<string, RegExp>
  test.each(Object.keys(LOCALES).flatMap((lng) => ['SentItsMeAfter', 'SentNotMeAfter'].map((key) => [lng, key])))(
    '%s %s says contact {{asker}}, not call',
    (lng, key) => {
      const line = LOCALES[lng].ConfirmItsYou[key]
      expect(line).toContain('{{asker}}')
      expect(line).not.toMatch(CALL[lng])
      // And what it must say, by literal: contact.
      expect(line).toContain(
        { en: 'contact {{asker}}', fr: 'contactez {{asker}}', 'pt-BR': 'entre em contato com {{asker}}' }[lng]
      )
      // The control: the same pattern does catch the word it guards against in that language.
      expect({ en: 'call them', fr: 'appelez-les', 'pt-BR': 'ligue para' }[lng]).toMatch(CALL[lng])
    }
  )
})
