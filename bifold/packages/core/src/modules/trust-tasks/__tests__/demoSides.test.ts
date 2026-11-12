/**
 * 278.16 hand run, item 5: "Set up the SEDI demo" put the Guardian card AND the ward on whichever phone ran it, so the
 * state card showed on both phones. Now each phone says which side it is: "Set up as the guardian" (Jordan: the card
 * and the state card, no ward) and "Set up as the person" (Sam: the ward, no card, the state card off).
 */
import { K0_TEST_GUARDIAN_CARD } from '../../sedi/guardian/k0TestCard'
import { K0_TEST_WARD } from '../../sedi/guardian/stateRoots'
import { STATE_CARD_REMOTE_OFF, isStateCardEnabled, setStateCardEnabled } from '../../sedi/holder/stateCardFlag'
import {
  sediDemoHiddenByKill,
  setUpSediDemo,
  setUpSediDemoAsGuardian,
  setUpSediDemoAsPerson,
  turnOffSediDemo,
} from '../developerTestState'
import * as evidenceModule from '../guardianEvidence'
import { GUARDIAN_EVIDENCE_HELD, STATE_WARD, heldGuardianEvidence, stateWardOf } from '../guardianEvidence'
import {
  CONFIRM_ITS_YOU_REMOTE_OFF,
  isConfirmItsYouEnabled,
  setConfirmItsYouEnabled,
} from '../module/confirmItsYouFlag'
import { SEDI_KERI_REMOTE_OFF } from '../module/sediKeriRemoteOff'
import {
  STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  isStateVerifiedApproversEnabled,
  setStateVerifiedApproversEnabled,
} from '../module/stateVerifiedApproversFlag'
import {
  TRUSTED_APPROVERS_REMOTE_OFF,
  isTrustedApproversEnabled,
  setTrustedApproversEnabled,
} from '../module/trustedApproversFlag'
import { isTrustTestStateEnabled, setTrustTestStateEnabled } from '../module/trustTestStateFlag'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Row = { id: string; content: Record<string, unknown>; tags: Record<string, string> }

/** A phone's record store; `fail.save` makes one record type's writes throw. Nothing here may delete a record. */
function phone() {
  const rows: Row[] = []
  const fail = { save: new Set<string>() }
  let n = 0
  const copy = (r: Row): Row => ({ ...r, content: JSON.parse(JSON.stringify(r.content)) })
  const agent = {
    genericRecords: {
      findAllByQuery: jest.fn(async (query: Record<string, string>) =>
        rows.filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v)).map(copy)
      ),
      save: jest.fn(async ({ content, tags }: { content: Record<string, unknown>; tags: Record<string, string> }) => {
        if (fail.save.has(tags.recordType)) throw new Error('storage')
        rows.push({ id: `r${++n}`, content: JSON.parse(JSON.stringify(content)), tags })
      }),
      update: jest.fn(async (record: Row) => {
        if (fail.save.has(record.tags.recordType)) throw new Error('storage')
        rows[rows.findIndex((r) => r.id === record.id)] = copy(record)
      }),
      delete: jest.fn(async () => {
        throw new Error('the demo setup overwrites its records, never deletes them')
      }),
      deleteById: jest.fn(async () => {
        throw new Error('the demo setup overwrites its records, never deletes them')
      }),
    },
  }
  return { agent: agent as never, rows, fail }
}

const count = (p: ReturnType<typeof phone>, recordType: string) =>
  p.rows.filter((r) => r.tags.recordType === recordType).length

/** In order: trusted approvers, state-verified approvers, the test state, the state card, Confirm it's you. */
const states = () => [
  isTrustedApproversEnabled(),
  isStateVerifiedApproversEnabled(),
  isTrustTestStateEnabled(),
  isStateCardEnabled(),
  isConfirmItsYouEnabled(),
]
const ALL_OFF = [false, false, false, false, false]
const GUARDIAN = [true, true, true, true, true]
const PERSON = [true, true, true, false, true]

const allSwitchesOff = () => turnOffSediDemo()
const clearKills = () => {
  SEDI_KERI_REMOTE_OFF.off = false
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = false
  STATE_CARD_REMOTE_OFF.off = false
  CONFIRM_ITS_YOU_REMOTE_OFF.off = false
}

beforeEach(() => {
  clearKills()
  allSwitchesOff()
})
afterEach(() => {
  jest.restoreAllMocks()
  clearKills()
  allSwitchesOff()
})

describe('Set up as the guardian (Jordan)', () => {
  test('from everything off: all five switches on, the K0 card held, no ward (control: before it, all off)', async () => {
    expect(states()).toEqual(ALL_OFF)
    const jordan = phone()
    expect(await setUpSediDemoAsGuardian(jordan.agent)).toBe('done')
    expect(states()).toEqual(GUARDIAN)
    expect((await heldGuardianEvidence(jordan.agent))?.guardianSaid).toBe(K0_TEST_GUARDIAN_CARD.guardianSaid)
    expect(await stateWardOf(jordan.agent)).toBeNull()
  })

  test('after the old one-tap set a ward on this phone, the ward is unset (overwritten, not deleted) and the card kept (control: the old one-tap leaves the ward)', async () => {
    const jordan = phone()
    expect(await setUpSediDemo(jordan.agent)).toBe('done')
    expect(await stateWardOf(jordan.agent)).toBe(K0_TEST_WARD)
    expect(await setUpSediDemoAsGuardian(jordan.agent)).toBe('done')
    expect(await stateWardOf(jordan.agent)).toBeNull()
    expect(jordan.rows.filter((r) => r.tags.recordType === STATE_WARD).map((r) => r.content)).toEqual([
      { ward: '', unsetAt: expect.any(String) },
    ])
    expect(count(jordan, GUARDIAN_EVIDENCE_HELD)).toBe(1)
    expect((jordan.agent as { genericRecords: { delete: jest.Mock } }).genericRecords.delete).not.toHaveBeenCalled()
  })

  test('after "Set up as the person" on this phone, it becomes the guardian: state card on, card held, ward gone', async () => {
    const p = phone()
    await setUpSediDemoAsPerson(p.agent)
    expect(states()).toEqual(PERSON)
    expect(await setUpSediDemoAsGuardian(p.agent)).toBe('done')
    expect(states()).toEqual(GUARDIAN)
    expect(await heldGuardianEvidence(p.agent)).toBeDefined()
    expect(await stateWardOf(p.agent)).toBeNull()
  })

  test('the card step fails: cardNotHeld, the ward still unset and the switches on (control: no failure, done)', async () => {
    const jordan = phone()
    await setUpSediDemo(jordan.agent)
    jest.spyOn(evidenceModule, 'keepK0TestGuardianCard').mockResolvedValue('tooLarge')
    expect(await setUpSediDemoAsGuardian(jordan.agent)).toBe('cardNotHeld')
    expect(states()).toEqual(GUARDIAN)
    expect(await stateWardOf(jordan.agent)).toBeNull()
    jest.restoreAllMocks()
    expect(await setUpSediDemoAsGuardian(phone().agent)).toBe('done')
  })

  test('the card step throws: cardNotHeld', async () => {
    jest.spyOn(evidenceModule, 'keepK0TestGuardianCard').mockRejectedValue(new Error('storage'))
    const unset = jest.spyOn(evidenceModule, 'unsetStateWard')
    const jordan = phone()
    expect(await setUpSediDemoAsGuardian(jordan.agent)).toBe('cardNotHeld')
    expect(await heldGuardianEvidence(jordan.agent)).toBeUndefined()
    expect(count(jordan, GUARDIAN_EVIDENCE_HELD)).toBe(0)
    expect(unset).toHaveBeenCalledTimes(1)
  })

  test('the ward cannot be unset: wardNotCleared, the card still held (control: the same phone, writes working, done)', async () => {
    const jordan = phone()
    await setUpSediDemo(jordan.agent)
    jordan.fail.save.add(STATE_WARD)
    expect(await setUpSediDemoAsGuardian(jordan.agent)).toBe('wardNotCleared')
    expect(states()).toEqual(GUARDIAN)
    expect(await heldGuardianEvidence(jordan.agent)).toBeDefined()
    jordan.fail.save.clear()
    expect(await setUpSediDemoAsGuardian(jordan.agent)).toBe('done')
  })

  test('both steps fail: the card is named first, and the ward step was still attempted', async () => {
    const jordan = phone()
    await setUpSediDemo(jordan.agent)
    jest.spyOn(evidenceModule, 'keepK0TestGuardianCard').mockResolvedValue('tooLarge')
    jordan.fail.save.add(STATE_WARD)
    const clear = jest.spyOn(evidenceModule, 'unsetStateWard')
    expect(await setUpSediDemoAsGuardian(jordan.agent)).toBe('cardNotHeld')
    expect(clear).toHaveBeenCalledTimes(1)
    // The ward step really failed too (control for the order: the row above, where only it fails, says wardNotCleared).
    expect(await stateWardOf(jordan.agent)).toBe(K0_TEST_WARD)
  })

  test("the state card's own remote off: doneSomeHidden naming the card (control: the person side ignores it)", async () => {
    STATE_CARD_REMOTE_OFF.off = true
    expect(await setUpSediDemoAsGuardian(phone().agent)).toBe('doneSomeHidden')
    expect(sediDemoHiddenByKill('guardian')).toEqual(['stateCard'])
  })
})

describe('Set up as the person (Sam)', () => {
  test('from everything off: four switches on, the state card OFF, the K0 ward set, no card (control: before it, all off)', async () => {
    expect(states()).toEqual(ALL_OFF)
    const sam = phone()
    expect(await setUpSediDemoAsPerson(sam.agent)).toBe('done')
    expect(states()).toEqual(PERSON)
    expect(isConfirmItsYouEnabled()).toBe(true)
    expect(await stateWardOf(sam.agent)).toBe(K0_TEST_WARD)
    expect(await heldGuardianEvidence(sam.agent)).toBeUndefined()
  })

  test('the state card was on (the old one-tap): turned off, and the card held here put away (control: the old one-tap holds it)', async () => {
    const sam = phone()
    expect(await setUpSediDemo(sam.agent)).toBe('done')
    expect(isStateCardEnabled()).toBe(true)
    expect(await heldGuardianEvidence(sam.agent)).toBeDefined()
    expect(await setUpSediDemoAsPerson(sam.agent)).toBe('done')
    expect(isStateCardEnabled()).toBe(false)
    expect(await heldGuardianEvidence(sam.agent)).toBeUndefined()
    // Overwritten with no card in it, never deleted: not one of the card's fields is left.
    expect(sam.rows.filter((r) => r.tags.recordType === GUARDIAN_EVIDENCE_HELD).map((r) => r.content)).toEqual([
      { noneSince: expect.any(String) },
    ])
    expect((sam.agent as { genericRecords: { delete: jest.Mock } }).genericRecords.delete).not.toHaveBeenCalled()
    expect(await stateWardOf(sam.agent)).toBe(K0_TEST_WARD)
  })

  test('the state card switch turned on by hand beforehand is turned off', async () => {
    setStateCardEnabled(true)
    expect(isStateCardEnabled()).toBe(true)
    await setUpSediDemoAsPerson(phone().agent)
    expect(isStateCardEnabled()).toBe(false)
  })

  test('the ward step fails: wardNotSet, the card still put away and the switches set (control: no failure, done)', async () => {
    const sam = phone()
    await setUpSediDemo(sam.agent)
    // Only the card is left here (the ward the old one-tap set is removed), so a ward found afterwards was set now.
    sam.rows.splice(0, sam.rows.length, ...sam.rows.filter((r) => r.tags.recordType === GUARDIAN_EVIDENCE_HELD))
    sam.fail.save.add(STATE_WARD)
    expect(await setUpSediDemoAsPerson(sam.agent)).toBe('wardNotSet')
    expect(states()).toEqual(PERSON)
    expect(await heldGuardianEvidence(sam.agent)).toBeUndefined()
    expect(await stateWardOf(sam.agent)).toBeNull()
    sam.fail.save.clear()
    expect(await setUpSediDemoAsPerson(sam.agent)).toBe('done')
  })

  test('the card cannot be put away: cardNotRemoved, the ward still set (control: writes working, done)', async () => {
    const sam = phone()
    await setUpSediDemo(sam.agent)
    sam.fail.save.add(GUARDIAN_EVIDENCE_HELD)
    expect(await setUpSediDemoAsPerson(sam.agent)).toBe('cardNotRemoved')
    expect(await stateWardOf(sam.agent)).toBe(K0_TEST_WARD)
    sam.fail.save.clear()
    expect(await setUpSediDemoAsPerson(sam.agent)).toBe('done')
  })

  test('both steps fail: the ward is named first, and the put-away was still attempted', async () => {
    const sam = phone()
    await setUpSediDemo(sam.agent) // a card held here, so the put-away has something to fail on
    sam.rows.splice(0, sam.rows.length, ...sam.rows.filter((r) => r.tags.recordType === GUARDIAN_EVIDENCE_HELD))
    sam.fail.save.add(STATE_WARD)
    sam.fail.save.add(GUARDIAN_EVIDENCE_HELD)
    const forget = jest.spyOn(evidenceModule, 'holdNoGuardianEvidence')
    expect(await setUpSediDemoAsPerson(sam.agent)).toBe('wardNotSet')
    expect(forget).toHaveBeenCalledTimes(1)
    // The put-away really failed too (control for the order: the row above, where only it fails, says cardNotRemoved).
    expect(await heldGuardianEvidence(sam.agent)).toBeDefined()
  })

  test("the state card's own remote off hides nothing here: done, not doneSomeHidden (control: the guardian side names it)", async () => {
    STATE_CARD_REMOTE_OFF.off = true
    expect(await setUpSediDemoAsPerson(phone().agent)).toBe('done')
    expect(sediDemoHiddenByKill('person')).toEqual([])
    expect(sediDemoHiddenByKill()).toEqual(['stateCard'])
  })

  test("Confirm it's you's own remote off: doneSomeHidden naming it", async () => {
    CONFIRM_ITS_YOU_REMOTE_OFF.off = true
    expect(await setUpSediDemoAsPerson(phone().agent)).toBe('doneSomeHidden')
    expect(sediDemoHiddenByKill('person')).toEqual(['confirmItsYou'])
  })
})

describe('both sides under a remote off', () => {
  const kills: [string, () => void][] = [
    ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
    ['trusted approvers turned off remotely', () => (TRUSTED_APPROVERS_REMOTE_OFF.off = true)],
    ['state-verified approvers turned off remotely', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true)],
  ]
  const sides = [
    ['guardian', setUpSediDemoAsGuardian],
    ['person', setUpSediDemoAsPerson],
  ] as const

  describe.each(sides)('as the %s', (_side, setUp) => {
    test.each(kills)(
      '%s up front: remoteOff, no switch touched, nothing kept or deleted (control: cleared, it sets up)',
      async (_, kill) => {
        const p = phone()
        await setUpSediDemo(p.agent) // a card and a ward already here
        setStateCardEnabled(false)
        setConfirmItsYouEnabled(false)
        setTrustTestStateEnabled(false)
        setStateVerifiedApproversEnabled(false)
        setTrustedApproversEnabled(false)
        const before = JSON.stringify(p.rows)
        kill()
        expect(await setUp(p.agent)).toBe('remoteOff')
        clearKills()
        expect(states()).toEqual(ALL_OFF)
        expect(JSON.stringify(p.rows)).toBe(before)
        expect(await setUp(p.agent)).toBe('done')
      }
    )

    test('a kill landing during the steps: remoteOff, not done', async () => {
      jest.spyOn(evidenceModule, 'keepK0TestGuardianCard').mockImplementation(async () => {
        SEDI_KERI_REMOTE_OFF.off = true
        return 'off'
      })
      jest.spyOn(evidenceModule, 'becomeK0TestWard').mockImplementation(async () => {
        SEDI_KERI_REMOTE_OFF.off = true
        return 'off'
      })
      expect(await setUp(phone().agent)).toBe('remoteOff')
    })
  })
})
