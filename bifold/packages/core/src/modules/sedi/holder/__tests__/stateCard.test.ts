/**
 * What the state card says, from the K0 test card this phone holds and its check (sedi/holder/stateCard). The rule
 * under test: "Checks out" only from checkGuardianEvidence's `ok: true`; switched off, no root trusted and every
 * refusal each say what stopped the check, never that it checks out.
 *
 * The real K0 card and the real verifier, with the real switches; only the words are a stand-in (`t` below writes the
 * key and what it was given, so a row can see what was said and with what).
 */
import type { TFunction } from 'i18next'

import { SEDI_KERI_REMOTE_OFF } from '../../../trust-tasks/module/sediKeriRemoteOff'
import {
  STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  setStateVerifiedApproversEnabled,
} from '../../../trust-tasks/module/stateVerifiedApproversFlag'
import { setTrustTestStateEnabled } from '../../../trust-tasks/module/trustTestStateFlag'
import { setTrustedApproversEnabled } from '../../../trust-tasks/module/trustedApproversFlag'
import { resetGuardianCheckMemo, type GuardianEvidence } from '../../../trust-tasks/guardianEvidence'
import { K0_REVOKED_OMITTED_CARD } from '../../guardian/k0RevokedOmittedCard'
import { K0_REVOKED_TEST_GUARDIAN_CARD } from '../../guardian/k0RevokedTestCard'
import { K0_TEST_GUARDIAN_CARD } from '../../guardian/k0TestCard'
import { K0_TEST_ROOT } from '../../guardian/stateRoots'
import { readFileSync } from 'fs'
import { join } from 'path'

import { setDemoStateHost } from '../../webs/demoStateHost'
import type { RootKel } from '../../webs/rootKel'
import {
  STATE_CARD_AS_OF,
  STATE_CARD_AS_OF_LIVE,
  checkHeldCard,
  checkKeyOf,
  stateCardView,
  type HeldCheck,
} from '../stateCard'

const t = ((key: string, extra?: Record<string, unknown>) => {
  const { interpolation: _, ...given } = extra ?? {}
  return Object.keys(given).length ? `${key}${JSON.stringify(given)}` : key
}) as unknown as TFunction
const day = (iso: string) => `day(${iso.slice(0, 10)})`
const NOW = new Date('2026-11-12T12:00:00Z')
const card: GuardianEvidence = K0_TEST_GUARDIAN_CARD
const view = (check: HeldCheck, evidence: GuardianEvidence = card) => stateCardView(evidence, check, t, day)
const checked = (evidence: GuardianEvidence = card, now = NOW) => checkHeldCard(evidence, now, () => undefined)

const CHECKS_OUT = /^StateCard\.ChecksOut/
const realDev = (global as { __DEV__?: boolean }).__DEV__
// The K0 root's own `demo` as this build has it, put back after a row changes it.
const realDemo = Object.getOwnPropertyDescriptor(K0_TEST_ROOT, 'demo')

const switches = (sv: boolean, testState = true) => {
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(sv)
  setTrustTestStateEnabled(testState)
}

// No row may reach the network: the platform fetch refuses unless a row puts a resolver in place.
const realFetch = global.fetch
beforeEach(() => {
  // As after a restart: no row inherits a kept live result (sedi/webs/lastLive), whatever order the rows run in.
  resetGuardianCheckMemo()
  switches(true)
  global.fetch = jest.fn(async () => {
    throw new Error('no network in tests')
  }) as never
})
afterEach(() => {
  global.fetch = realFetch
  setDemoStateHost(null)
  switches(false, false)
  STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  ;(global as { __DEV__?: boolean }).__DEV__ = realDev
  delete (K0_TEST_ROOT as { demo?: boolean }).demo
  if (realDemo) Object.defineProperty(K0_TEST_ROOT, 'demo', realDemo)
})

describe('the state card: what it says', () => {
  test('the K0 card, checked: "Checks out", as of the copy this phone holds, from the state on this list', async () => {
    const v = view(await checked())
    expect(v.tone).toBe('ok')
    expect(v.status).toBe(`StateCard.ChecksOut{"asOf":"${STATE_CARD_AS_OF}"}`)
    expect(v.title).toBe(K0_TEST_ROOT.name)
    expect(v.guardianOf).toBe('StateCard.GuardianOf{"ward":"StateCard.YourContact"}')
    expect(v.technical).toEqual({
      holder: K0_TEST_GUARDIAN_CARD.holder,
      root: K0_TEST_ROOT.aid,
      said: K0_TEST_GUARDIAN_CARD.guardianSaid,
      // As the card states it: dates are never parsed here (expiryParseGuard), only worded by the screen.
      expires: '2030-11-10T00:00:00.000000+00:00',
      result: 'valid',
    })
    expect(v.issued).toEqual({ label: 'StateCard.Issued', value: 'day(2026-11-10)' })
    expect(v.validUntil).toEqual({ label: 'StateCard.ValidUntil', value: 'day(2030-11-10)' })
  })

  test('a demo root puts the cream "Demo" pill and the demo line on it', async () => {
    const v = view(await checked())
    expect(v.pill).toBe('StateCard.Demo')
    expect(v.demoNote).toBe('StateCard.DemoNote')
  })

  test('the pill follows the root entry\'s own `demo`, not its name: demo false, no "Demo" (control above: K0 = demo)', async () => {
    ;(K0_TEST_ROOT as { demo?: boolean }).demo = false
    // Not a demo root, K0 is a real one now: fetched at its own did:webs, so the state answers here.
    const kel = new Uint8Array(
      readFileSync(
        join(
          __dirname,
          '..',
          '..',
          '__tests__',
          'fixtures',
          'webs-k0-root',
          'example.org',
          'keyring-demo-state',
          K0_TEST_ROOT.aid,
          'keri.cesr'
        )
      )
    )
    const resolveRootKel = jest.fn(async () => ({ ok: true as const, aid: K0_TEST_ROOT.aid, kel }))
    const v = view(await checkHeldCard(card, NOW, () => undefined, { resolveRootKel }))
    expect(resolveRootKel).toHaveBeenCalledTimes(1)
    expect(v.tone).toBe('ok')
    expect(v.pill).toBeUndefined()
    // A real root: only its own record is fetched, so the line says the issuers' records came from the card.
    expect(v.source).toBe('Approver.GuardianFetchedRootLive{"host":"example.org"}')
    // Still the K0 test card, so it still says it is a demo card.
    expect(v.demoNote).toBe('StateCard.DemoNote')
  })

  test.each([
    ['state-verified approvers off', () => setStateVerifiedApproversEnabled(false), 'switchedOff'],
    ['the state-verified approvers remote off', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true), 'switchedOff'],
    ['the SEDI/KERI remote off', () => (SEDI_KERI_REMOTE_OFF.off = true), 'switchedOff'],
    [
      'no root trusted (a tester build without "Trust the test state (K0)")',
      () => {
        ;(global as { __DEV__?: boolean }).__DEV__ = false
        setTrustTestStateEnabled(false)
      },
      'noRoots',
    ],
  ])('%s: not checked, says what to turn on, never "Checks out" (control: on, it checks out)', async (_, off, why) => {
    expect(view(await checked()).status).toMatch(CHECKS_OUT)
    off()
    const v = view(await checked())
    expect(v.tone).toBe('notChecked')
    expect(v.status).toBe('StateCard.SetupNeeded')
    expect(v.status).not.toMatch(CHECKS_OUT)
    expect(v.pill).toBe('StateCard.PillNotChecked')
    expect(v.technical.root).toBeUndefined()
    expect(v.technical.result).toBe(why)
  })

  test('an expired card: refused as expired, red pill, never "Checks out" (control: the day before, it checks out)', async () => {
    expect(view(await checked(card, new Date('2030-11-09T00:00:00Z'))).status).toMatch(CHECKS_OUT)
    const v = view(await checked(card, new Date('2030-11-11T00:00:00Z')))
    expect(v.tone).toBe('problem')
    expect(v.technical.result).toBe('expired')
    expect([v.status, v.pill]).toEqual(['StateCard.Expired', 'StateCard.PillExpired'])
    expect(v.technical.root).toBeUndefined()
  })

  test('an edited card: refused, red pill, never "Checks out", and its dates still read from the card', async () => {
    const edited = {
      ...card,
      kels: [card.kels[0].replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), ...card.kels.slice(1)],
    }
    const v = view(await checked(edited))
    expect(v.tone).toBe('problem')
    expect(v.status).not.toMatch(CHECKS_OUT)
    expect(v.pill).toBe('StateCard.PillCouldNotVerify')
    expect(v.title).toBe('StateCard.UnknownState')
    expect(v.validUntil?.value).toBe('day(2030-11-10)')
  })

  const refused = (reason: string): HeldCheck => ({
    checked: true,
    verdict: { ok: false, reason, detail: 'x', checkedAt: NOW.toISOString() },
  })
  test.each([
    ['revoked', 'StateCard.Revoked', 'StateCard.PillRevoked'],
    ['expired', 'StateCard.Expired', 'StateCard.PillExpired'],
    ['untrustedRoot', 'StateCard.Untrusted', 'StateCard.PillNotTrusted'],
    ['statusNotCurrent', 'StateCard.StatusUnknown', 'StateCard.PillCouldNotVerify'],
    ['telUnanchored', 'StateCard.StatusUnknown', 'StateCard.PillCouldNotVerify'],
    ['kelNotReplaying', 'StateCard.Broken', 'StateCard.PillCouldNotVerify'],
    ['checkFailed', 'StateCard.Broken', 'StateCard.PillCouldNotVerify'],
    ['noWard', 'StateCard.Broken', 'StateCard.PillCouldNotVerify'],
    ['expiryUnreadable', 'StateCard.Broken', 'StateCard.PillCouldNotVerify'],
    ['stateNotResolved', 'StateCard.NotReached', 'StateCard.PillNotReached'],
    ['revokedInIssuerRecord', 'StateCard.RevokedIssuer', 'StateCard.PillRevoked'],
    ['revokedInStateRecord', 'StateCard.RevokedState', 'StateCard.PillRevoked'],
  ])('refused (%s): its words, a red pill, no state name, no root, no "Demo"', async (reason, status, pill) => {
    const v = view(refused(reason))
    expect([v.tone, v.status, v.pill, v.title, v.technical.root]).toEqual([
      'problem',
      status,
      pill,
      'StateCard.UnknownState',
      undefined,
    ])
    expect(v.technical.result).toBe(reason)
  })

  test('a card not the K0 test card, refused: no demo line (control: the K0 card refused keeps it)', async () => {
    expect(view(refused('revoked')).demoNote).toBe('StateCard.DemoNote')
    expect(view(refused('revoked'), { ...card, guardianSaid: 'Eother' }).demoNote).toBeUndefined()
  })

  test('the check is keyed by the card and the switch it reads, so a change is checked again', async () => {
    const on = checkKeyOf(card)
    expect(checkKeyOf(card)).toBe(on)
    expect(checkKeyOf({ ...card, guardianSaid: 'Eother' })).not.toBe(on)
    setStateVerifiedApproversEnabled(false)
    expect(checkKeyOf(card)).not.toBe(on)
  })

  test('the key moves when the root list gains or loses a root (here: K0 trusted, then none)', async () => {
    const withK0 = checkKeyOf(card)
    ;(global as { __DEV__?: boolean }).__DEV__ = false
    setTrustTestStateEnabled(false)
    expect(checkKeyOf(card)).not.toBe(withK0)
    setTrustTestStateEnabled(true)
    expect(checkKeyOf(card)).toBe(withK0)
  })

  test('the key moves when a root on the list is renamed, keeping its AID, so the card never keeps an old name', async () => {
    const before = checkKeyOf(card)
    const name = K0_TEST_ROOT.name
    try {
      ;(K0_TEST_ROOT as { name: string }).name = 'Renamed state'
      expect(checkKeyOf(card)).not.toBe(before)
      expect(view(await checked()).title).toBe('Renamed state')
    } finally {
      ;(K0_TEST_ROOT as { name: string }).name = name
    }
    expect(checkKeyOf(card)).toBe(before)
  })
})

describe('the state card: checking, and checked live', () => {
  /** The K0 root's KEL as its demo host serves it (the fixture #1038's rows read). */
  const servedKel = () =>
    new Uint8Array(
      readFileSync(
        join(
          __dirname,
          '..',
          '..',
          '__tests__',
          'fixtures',
          'webs-k0-root',
          'example.org',
          'keyring-demo-state',
          K0_TEST_ROOT.aid,
          'keri.cesr'
        )
      )
    )
  /** The KEL the demo host serves for an AID of the K0 chain (the root, the org unit or the issuing agent). */
  const chainKel = (aid: string) =>
    new Uint8Array(
      readFileSync(
        join(
          __dirname,
          '..',
          '..',
          '__tests__',
          'fixtures',
          'webs-k0-root',
          'example.org',
          'keyring-demo-state',
          aid,
          'keri.cesr'
        )
      )
    )
  const live = (answer: (did: string) => Promise<RootKel>) => {
    // Takes the did:webs it is asked for, as a RootKelResolver does, so a row can read what was fetched. Only the
    // ROOT's fetch is the row's to answer (and counted); a demo root's chain issuers, which the check also fetches
    // (sedi/webs README), are answered with the KEL the host publishes for them. Test isolation only.
    const resolveRootKel = jest.fn((did: string) => answer(did))
    const dispatch = (did: string) => {
      const aid = did.slice(did.lastIndexOf(':') + 1)
      return aid === K0_TEST_ROOT.aid
        ? resolveRootKel(did)
        : Promise.resolve({ ok: true as const, aid, kel: chainKel(aid) })
    }
    const check = (evidence: GuardianEvidence = card) =>
      checkHeldCard(evidence, NOW, () => undefined, { resolveRootKel: dispatch })
    return { resolveRootKel, check }
  }

  test('while checking: says so with a cream "Checking" pill, never "Checks out", no state name, no source', () => {
    const v = view({ checked: 'pending' })
    expect([v.tone, v.status, v.pill, v.title]).toEqual([
      'checking',
      'StateCard.Checking',
      'StateCard.PillChecking',
      'StateCard.UnknownState',
    ])
    expect(v.status).not.toMatch(CHECKS_OUT)
    expect([v.technical.root, v.source, v.technical.result]).toEqual([undefined, undefined, 'checking'])
  })

  test('with a demo state host: fetched live, "as of the state\'s published record", and says from where', async () => {
    setDemoStateHost('example.org')
    const { resolveRootKel, check } = live(async () => ({ ok: true, aid: K0_TEST_ROOT.aid, kel: servedKel() }))
    const v = view(await check())
    expect(resolveRootKel).toHaveBeenCalledTimes(1)
    expect(resolveRootKel.mock.calls[0][0]).toContain('did:webs:example.org:')
    expect(v.status).toBe(`StateCard.ChecksOut{"asOf":"${STATE_CARD_AS_OF_LIVE}"}`)
    expect(v.asOf).toBe(STATE_CARD_AS_OF_LIVE)
    expect(v.source).toBe('Approver.GuardianFetchedLive{"host":"example.org"}')
    expect(v.pill).toBe('StateCard.Demo')
  })

  test('with no demo state host: the copy here, never fetched, and says so (control above: with a host, fetched)', async () => {
    const { resolveRootKel, check } = live(async () => ({ ok: true, aid: K0_TEST_ROOT.aid, kel: servedKel() }))
    const v = view(await check())
    expect(resolveRootKel).not.toHaveBeenCalled()
    expect(v.status).toBe(`StateCard.ChecksOut{"asOf":"${STATE_CARD_AS_OF}"}`)
    expect(v.source).toBe('Approver.GuardianDemoCopy')
  })

  test('a state that can\'t be reached: its own words and red pill, never "Checks out", never the copy instead', async () => {
    setDemoStateHost('example.org')
    const { check } = live(async () => ({ ok: false, reason: 'unreachable', detail: 'offline' }))
    const v = view(await check())
    expect([v.tone, v.status, v.pill, v.technical.result]).toEqual([
      'problem',
      'StateCard.NotReached',
      'StateCard.PillNotReached',
      'stateNotResolved',
    ])
    expect(v.status).not.toMatch(CHECKS_OUT)
    expect([v.source, v.technical.root]).toEqual([undefined, undefined])
  })

  test("the key moves when a demo state host is set or cleared, so a copy's verdict never reads as live, or back", () => {
    const copy = checkKeyOf(card)
    setDemoStateHost('example.org')
    expect(checkKeyOf(card)).not.toBe(copy)
    setDemoStateHost(null)
    expect(checkKeyOf(card)).toBe(copy)
  })

  const fetched = (extra: object): HeldCheck => ({
    checked: true,
    verdict: {
      ok: true,
      root: K0_TEST_ROOT.aid,
      state: K0_TEST_ROOT.name,
      demo: true,
      checkedAt: NOW.toISOString(),
      fetchedFrom: 'example.org',
      ...extra,
    },
  })
  const clock = (iso: string) => `clock(${iso})`
  const AT = '2026-11-12T11:58:00Z'
  test.each([
    ['root and issuers fetched, fresh', { fetchedIssuers: true }, 'Approver.GuardianFetchedLive{"host":"example.org"}'],
    [
      'root and issuers fetched, reused',
      { fetchedIssuers: true, fetchedAt: AT, reused: true },
      `Approver.GuardianFetchedLiveAt{"host":"example.org","time":"clock(${AT})"}`,
    ],
    ['only the root fetched, fresh', {}, 'Approver.GuardianFetchedRootLive{"host":"example.org"}'],
    [
      'only the root fetched, reused',
      { fetchedAt: AT, reused: true },
      `Approver.GuardianFetchedRootLiveAt{"host":"example.org","time":"clock(${AT})"}`,
    ],
  ])("%s: the line Who approves shows (guardianSourceKey), and the status is the full check's", (_, extra, line) => {
    const v = stateCardView(card, fetched(extra), t, day, clock)
    expect(v.source).toBe(line)
    expect(v.status).toBe(`StateCard.ChecksOut{"asOf":"${STATE_CARD_AS_OF_LIVE}"}`)
  })

  test('the root answers but an issuer in its chain can\'t be reached: "Couldn\'t reach", never "Checks out"', async () => {
    setDemoStateHost('example.org')
    const resolveRootKel = jest.fn(async (did: string) => {
      const aid = did.slice(did.lastIndexOf(':') + 1)
      return aid === K0_TEST_ROOT.aid
        ? { ok: true as const, aid, kel: chainKel(aid) }
        : { ok: false as const, reason: 'unreachable', detail: 'offline' }
    })
    const v = view(await checkHeldCard(card, NOW, () => undefined, { resolveRootKel }))
    expect(resolveRootKel.mock.calls.length).toBeGreaterThan(1)
    expect([v.tone, v.status, v.pill]).toEqual(['problem', 'StateCard.NotReached', 'StateCard.PillNotReached'])
    expect(v.status).not.toMatch(CHECKS_OUT)
  })

  test('the real card that CARRIES its revocation (#1044): "The card shows it was revoked", from its own copy', async () => {
    const v = view(await checked(K0_REVOKED_TEST_GUARDIAN_CARD as GuardianEvidence))
    expect([v.tone, v.status, v.pill, v.technical.result]).toEqual([
      'problem',
      'StateCard.Revoked',
      'StateCard.PillRevoked',
      'revoked',
    ])
    expect(v.status).not.toMatch(CHECKS_OUT)
  })

  test("the real card that leaves out its revocation: the issuer's published record shows it (control: from its own copy, it checks out)", async () => {
    const omitted = K0_REVOKED_OMITTED_CARD as GuardianEvidence
    const all = jest.fn(async (did: string) => {
      const aid = did.slice(did.lastIndexOf(':') + 1)
      return { ok: true as const, aid, kel: chainKel(aid) }
    })
    // Control: no host, so the card's own copy, which leaves the revocation out, is all there is to read.
    expect(view(await checkHeldCard(omitted, NOW, () => undefined, { resolveRootKel: all })).status).toMatch(CHECKS_OUT)
    setDemoStateHost('example.org')
    const v = view(await checkHeldCard(omitted, NOW, () => undefined, { resolveRootKel: all }))
    expect([v.tone, v.status, v.pill, v.technical.result]).toEqual([
      'problem',
      'StateCard.RevokedIssuer',
      'StateCard.PillRevoked',
      'revokedInIssuerRecord',
    ])
  })
})

describe('the state card: the same revocation words as Who approves, in every language', () => {
  test.each(['en', 'fr', 'pt-br'])(
    '%s: StateCard.Revoked / RevokedIssuer / RevokedState equal Approver.GuardianRevoked / RevokedIssuer / RevokedState',
    (lang) => {
      const words = JSON.parse(
        readFileSync(join(__dirname, '..', '..', '..', '..', 'localization', lang, `${lang}.json`), 'utf8')
      ) as Record<string, Record<string, string>>
      expect([words.StateCard.Revoked, words.StateCard.RevokedIssuer, words.StateCard.RevokedState]).toEqual([
        words.Approver.GuardianRevoked,
        words.Approver.GuardianRevokedIssuer,
        words.Approver.GuardianRevokedState,
      ])
      expect(words.StateCard.RevokedIssuer).toBeTruthy()
    }
  )
})
