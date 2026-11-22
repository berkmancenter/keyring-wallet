import type { RelationshipLayer } from '../relationshipLayers'
import { localDay, relationshipDays } from '../relationshipDays'

// Local wall-clock times, so the day is the same whatever zone the test runs in.
const at = (month: number, day: number, hour = 12) => new Date(2026, month - 1, day, hour).toISOString()
const card = (when?: string, hardwareEvidence = true): RelationshipLayer => ({
  kind: 'card',
  at: when,
  hardwareEvidence,
  raw: {},
})
const witnessed = (when?: string, witnessName?: string, inPerson = false): RelationshipLayer => ({
  kind: 'witnessed',
  at: when,
  witnessName,
  inPerson,
})

describe('one entry per day', () => {
  test('three exchanges on one day are one entry, said as three', () => {
    const days = relationshipDays([card(at(10, 15, 9)), card(at(10, 15, 11)), card(at(10, 15, 16))], {
      0: true,
      1: true,
      2: true,
    })
    expect(days).toHaveLength(1)
    expect(days[0]).toMatchObject({ day: '2026-10-15', cards: 3, hardwareVerified: 3, hardwareChecking: 0 })
    expect(days[0].at).toBe(at(10, 15, 16))
  })

  test('a day partly signed with secure hardware says how many: 2 of 3', () => {
    const days = relationshipDays([card(at(10, 15, 9)), card(at(10, 15, 11)), card(at(10, 15, 16))], {
      0: true,
      1: false,
      2: true,
    })
    expect(days[0]).toMatchObject({ cards: 3, hardwareVerified: 2, hardwareChecking: 0 })
  })

  test('a card with no hardware evidence counts as an exchange, never as signed with hardware', () => {
    const days = relationshipDays([card(at(10, 15), false), card(at(10, 15))], { 1: true })
    expect(days[0]).toMatchObject({ cards: 2, hardwareVerified: 1, hardwareChecking: 0 })
  })

  test('a check still running is counted apart, so nothing is said about hardware until it is known', () => {
    const days = relationshipDays([card(at(10, 15)), card(at(10, 15))], { 0: true })
    expect(days[0]).toMatchObject({ hardwareVerified: 1, hardwareChecking: 1 })
  })

  test("a witness on the same day joins that day's entry; one who confirmed you were near makes it in person", () => {
    const days = relationshipDays([card(at(10, 15, 9)), witnessed(at(10, 15, 10), 'keyring-witness', true)], {
      0: true,
    })
    expect(days).toHaveLength(1)
    expect(days[0]).toMatchObject({ cards: 1, witnesses: ['keyring-witness'], unnamedWitness: false, inPerson: true })
    expect(days[0].layers).toHaveLength(2)
  })

  test('the same witness twice in a day is named once; one with no name is said as unnamed', () => {
    const days = relationshipDays(
      [witnessed(at(10, 15), 'keyring-witness'), witnessed(at(10, 15), 'keyring-witness'), witnessed(at(10, 15))],
      {}
    )
    expect(days[0]).toMatchObject({ witnesses: ['keyring-witness'], unnamedWitness: true, inPerson: false })
  })
})

describe('the days in order', () => {
  test('newest day first; records with no date form one day of their own, last', () => {
    const days = relationshipDays([card(at(10, 1)), card(undefined), card(at(10, 15)), witnessed(undefined, 'w')], {})
    expect(days.map((d) => d.day)).toEqual(['2026-10-15', '2026-10-01', ''])
    expect(days[2]).toMatchObject({ cards: 1, witnesses: ['w'] })
  })

  test('two exchanges either side of local midnight are two days', () => {
    const days = relationshipDays([card(at(10, 15, 23)), card(at(10, 16, 0))], {})
    expect(days.map((d) => d.day)).toEqual(['2026-10-16', '2026-10-15'])
  })
})

describe('a local day', () => {
  test('from a timestamp, in the phone’s zone; nothing for none or for one that cannot be read', () => {
    expect(localDay(at(3, 9))).toBe('2026-03-09')
    expect(localDay(undefined)).toBe('')
    expect(localDay('not a date')).toBe('')
  })
})
