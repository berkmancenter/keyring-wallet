/**
 * "How you know <name>", one entry per day, read through the real locale files and the app's default escaping: three
 * exchanges on one day are one entry; a day partly signed with secure hardware says "2 of 3"; a witness on the same
 * day joins it; a day opens a sheet with the witness's record and each exchange; and a name reads as given, never
 * HTML-escaped. Before, each set of cards was its own line, the same words and
 * date two or three times, and the witness record sat in another block in another date format.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import RelationshipLayers from '../../../../src/modules/vrc/components/RelationshipLayers'
import { verifyVrcHardwareEvidence } from '../../../../src/modules/vrc/services/BiometricSignatureVerifier'
import type { RelationshipLayer } from '../../../../src/modules/vrc/utils/relationshipLayers'
import type { WitnessRecord } from '../../../../src/modules/vrc/utils/witnessCredentialUtils'
import { testIdWithKey } from '../../../../src/utils/testable'
import { speak } from '../../../helpers/appLanguage'
import { BasicAppContext } from '../../../helpers/app'

// The screen's words from the real locale files, so a test reads what a person reads (the shared mock gives keys).
jest.mock('react-i18next', () => {
  const shared = jest.requireActual('../../../../__mocks__/react-i18next')
  const actual = jest.requireActual('i18next')
  const real = actual.default ?? actual
  return {
    ...shared,
    useTranslation: () => ({ t: real.t.bind(real), i18n: real }),
  }
})
jest.mock('../../../../src/modules/vrc/services/BiometricSignatureVerifier', () => ({
  verifyVrcHardwareEvidence: jest.fn(),
}))
const verify = verifyVrcHardwareEvidence as jest.Mock

// Local wall-clock times, so the day is the same whatever zone the test runs in.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString()
const card = (when: string, id: string, hardwareEvidence = true): RelationshipLayer => ({
  kind: 'card',
  at: when,
  hardwareEvidence,
  raw: { id },
})
// A record as extractWitnessInfo makes one: credentialId is always set (the sheet does not read it).
const record = (over: Partial<WitnessRecord> = {}): WitnessRecord => ({
  credentialId: 'urn:uuid:witness-1',
  witnessDid: 'did:example:witness',
  witnessName: 'keyring-witness',
  issuanceDate: at(15, 10),
  locality: { outcome: 'confirmed', venue: 'Room 101' },
  ...over,
})
const witnessed = (when: string, w: WitnessRecord = record()): RelationshipLayer => ({
  kind: 'witnessed',
  at: when,
  witnessName: w.witnessName,
  inPerson: w.locality?.outcome === 'confirmed',
  record: w,
})

const show = async (layers: RelationshipLayer[], name = 'Bob') => {
  const tree = render(
    <BasicAppContext>
      <RelationshipLayers name={name} layers={layers} />
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}
beforeEach(async () => {
  await speak('en')
  verify.mockReset()
  verify.mockImplementation(async () => ({ valid: true }))
})

describe('one entry per day', () => {
  test('three exchanges on one day, each signed with secure hardware: one entry, said once', async () => {
    const tree = await show([card(at(15, 9), 'a'), card(at(15, 11), 'b'), card(at(15, 16), 'c')])
    expect(tree.getAllByTestId(testIdWithKey('RelationshipLayer'))).toHaveLength(1)
    expect(tree.getByText('15 Oct 2026')).toBeTruthy()
    expect(tree.getByText('Cards exchanged 3 times, each signed with secure hardware.')).toBeTruthy()
  })

  test('a day partly signed with secure hardware says how many: 2 of 3', async () => {
    verify.mockImplementation(async (raw: { id: string }) => ({ valid: raw.id !== 'b' }))
    const tree = await show([card(at(15, 9), 'a'), card(at(15, 11), 'b'), card(at(15, 16), 'c')])
    expect(tree.getByText('Cards exchanged 3 times; 2 of 3 signed with secure hardware.')).toBeTruthy()
  })

  test('while a check is still running, nothing is said about hardware; then it is', async () => {
    let answer: (v: { valid: boolean }) => void = () => undefined
    verify.mockImplementation(async (raw: { id: string }) =>
      raw.id === 'b' ? new Promise((r) => (answer = r)) : { valid: true }
    )
    const tree = await show([card(at(15, 9), 'a'), card(at(15, 11), 'b')])
    expect(tree.getByText('Cards exchanged 2 times.')).toBeTruthy()
    await act(async () => answer({ valid: true }))
    expect(tree.getByText('Cards exchanged 2 times, each signed with secure hardware.')).toBeTruthy()
  })

  test("a witness on the same day joins that day's entry, in person", async () => {
    const tree = await show([card(at(15, 9), 'a'), witnessed(at(15, 10)), card(at(3, 9), 'old', false)])
    expect(tree.getAllByTestId(testIdWithKey('RelationshipLayer'))).toHaveLength(2)
    expect(tree.getByText('15 Oct 2026 · in person')).toBeTruthy()
    expect(tree.getByText('Witnessed by keyring-witness. Cards exchanged, signed with secure hardware.')).toBeTruthy()
    // The older day, with no hardware evidence, is said plainly.
    expect(tree.getByText('3 Oct 2026')).toBeTruthy()
    expect(tree.getByText('Cards exchanged.')).toBeTruthy()
  })
})

describe("a day's sheet", () => {
  test("opens on a tap: the witness's record and each exchange with its time; Close closes it", async () => {
    const tree = await show([
      card(at(15, 9, 5), 'a'),
      card(at(15, 16, 40), 'b', false),
      witnessed(at(15, 10), record({ event: 'Spring meetup' })),
    ])
    expect(tree.queryByTestId(testIdWithKey('RelationshipDaySheet'))).toBeNull()
    fireEvent.press(tree.getByTestId(testIdWithKey('RelationshipLayer')))
    const sheet = tree.getByTestId(testIdWithKey('RelationshipDaySheet'))
    expect(sheet).toBeTruthy()
    expect(tree.getByText('15 Oct 2026 with Bob')).toBeTruthy()
    expect(tree.getByText('In person: the witness confirmed you were near.')).toBeTruthy()
    // The witness's record, every line in the app's words.
    expect(tree.getByTestId('WitnessRecord')).toBeTruthy()
    expect(tree.getByText('keyring-witness')).toBeTruthy()
    expect(tree.getByText('Spring meetup')).toBeTruthy()
    expect(tree.getByText('Confirmed: you were near · Room 101')).toBeTruthy()
    // Each exchange with its time: hardware said only for the one whose evidence verified.
    const exchanges = tree.getAllByTestId(testIdWithKey('RelationshipDayExchange'))
    expect(exchanges).toHaveLength(2)
    expect(tree.getByText('Signed with secure hardware')).toBeTruthy()
    expect(tree.getByText('Exchanged')).toBeTruthy()

    fireEvent.press(tree.getByTestId(testIdWithKey('RelationshipDaySheetClose')))
    expect(tree.queryByTestId(testIdWithKey('RelationshipDaySheet'))).toBeNull()
  })

  test('a location check that was interrupted, or declined, says so', async () => {
    const tree = await show([
      witnessed(at(15, 10), record({ locality: { outcome: 'declined', reason: 'windowLost' } })),
      witnessed(at(14, 10), record({ witnessName: undefined, locality: { outcome: 'declined' } })),
    ])
    fireEvent.press(tree.getAllByTestId(testIdWithKey('RelationshipLayer'))[0])
    expect(tree.getByText('Interrupted')).toBeTruthy()
    fireEvent.press(tree.getByTestId(testIdWithKey('RelationshipDaySheetClose')))
    fireEvent.press(tree.getAllByTestId(testIdWithKey('RelationshipLayer'))[1])
    expect(tree.getByText('Declined')).toBeTruthy()
    // A witness with no name is said in the app's words, never as an English placeholder.
    expect(tree.getByText('A witness')).toBeTruthy()
  })

  // The real instance escapes by default, as the app's does: names must read as given, never as "&amp;" or "&#x2F;".
  test('a name or a witness with characters the default escaping rewrites reads as given', async () => {
    const tree = await show([witnessed(at(15, 10), record({ witnessName: 'Wit <Ness> & Co' }))], "Bob O'Brien & Co")
    const section = tree.getByTestId(testIdWithKey('RelationshipLayers'))
    expect(section).toHaveTextContent("How you know Bob O'Brien & Co", { exact: false })
    expect(tree.getByText('Witnessed by Wit <Ness> & Co.')).toBeTruthy()
    fireEvent.press(tree.getByTestId(testIdWithKey('RelationshipLayer')))
    expect(tree.getByText("15 Oct 2026 with Bob O'Brien & Co")).toBeTruthy()
    expect(tree.getByText('Wit <Ness> & Co')).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('RelationshipDaySheet'))).not.toHaveTextContent(/&#|&amp;|&lt;|&gt;|&quot;/)
    expect(section).not.toHaveTextContent(/&#|&amp;|&lt;|&gt;|&quot;/)
  })

  test('records with no date are a day of their own, last, said as having no date', async () => {
    // No hardware evidence on either: this case is about the days, so it reads nothing asynchronously.
    const tree = await show([card(at(15, 9), 'a', false), { kind: 'card', hardwareEvidence: false, raw: {} }])
    const rows = tree.getAllByTestId(testIdWithKey('RelationshipLayer'))
    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveTextContent('No date', { exact: false })
    fireEvent.press(rows[1])
    expect(tree.getByText('No date with Bob')).toBeTruthy()
  })

  test('in French, the day, the sheet and the record read in French', async () => {
    await speak('fr')
    const tree = await show([card(at(15, 9), 'a'), witnessed(at(15, 10))])
    expect(tree.queryByText(/Oct 2026|Cards|Witness/)).toBeNull()
    // The hardware words too, once the evidence has verified.
    expect(
      tree.getByText('Avec pour témoin keyring-witness. Cartes échangées, signées avec du matériel sécurisé.')
    ).toBeTruthy()
    fireEvent.press(tree.getByTestId(testIdWithKey('RelationshipLayer')))
    expect(tree.getByText('Le relevé du témoin')).toBeTruthy()
    expect(tree.getByText('Confirmée : vous étiez à proximité · Room 101')).toBeTruthy()
    expect(tree.queryByText(/Signed|Exchanged|Location|Event/)).toBeNull()
  })
})
