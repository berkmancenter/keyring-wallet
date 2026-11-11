/**
 * What the state card in Credentials says (SEDI/KERI holder card): the Guardian card this phone holds, checked here.
 *
 * Checked as its holder: there is no ward and no own KERI identifier on this phone yet (stage 3), so the ward and the
 * holder the check expects are read from the card itself, and those two checks prove nothing here. What a "Checks out"
 * does prove, and all it may claim: the card's chain verifies to a State root on this phone's list, and the card is
 * neither revoked nor expired, {@link STATE_CARD_AS_OF} (the copy this phone holds, not a live read of the state).
 *
 * Never "Checks out" unless checkGuardianEvidence returned `ok: true`: switched off, no root trusted, and every
 * refusal each say what stopped the check instead.
 *
 * Pure apart from the switches it reads at the call: the same card, switches and clock give the same words.
 *
 * @module sedi/holder/stateCard
 */
import type { TFunction } from 'i18next'

import { checkGuardianEvidence, type GuardianEvidence, type GuardianVerdict } from '../../trust-tasks/guardianEvidence'
import { isStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'
import { K0_TEST_GUARDIAN_CARD } from '../guardian/k0TestCard'
import { isDemoStateRoot, trustedStateRoots } from '../guardian/stateRoots'

/**
 * How far a "Checks out" reaches, in one place: the copy this phone holds. Once the root keys come from a live
 * did:webs resolve, this key's words become "as of the state's published record", a one-line change.
 */
export const STATE_CARD_AS_OF = 'StateCard.AsOfHeldCopy'

/** The outcome of checking the held card: not checked (and why), or checkGuardianEvidence's verdict. */
export type HeldCheck = { checked: false; why: 'switchedOff' | 'noRoots' } | { checked: true; verdict: GuardianVerdict }

/** The Guardian credential itself (its ACDC, without the attachment), found by its SAID; undefined if not readable. */
function guardianCredentialOf(evidence: GuardianEvidence): Record<string, unknown> | undefined {
  for (const text of evidence.creds ?? []) {
    try {
      const sad = JSON.parse(text.slice(0, text.lastIndexOf('}') + 1)) as Record<string, unknown>
      if (sad?.d === evidence.guardianSaid) return sad
    } catch {
      // Not readable as a credential: the check refuses it; here it simply names nothing.
    }
  }
  return undefined
}

const attributesOf = (evidence: GuardianEvidence) =>
  (guardianCredentialOf(evidence)?.a ?? {}) as {
    ward?: unknown
    issuedDate?: { value?: unknown }
    expirationDate?: { value?: unknown }
  }

/**
 * A date as the card states it, for display only: never parsed here (only readExpiry parses a date in sedi/,
 * expiryParseGuard.test.ts). The screen's localDate words it, and gives back text it cannot read as it is.
 */
const dateText = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

/**
 * Check the held card. Not run at all while state-verified approvers is off or no root is trusted (the verifier would
 * only refuse, and the person is told what to turn on instead). Otherwise checkGuardianEvidence, which never throws,
 * against the ward and holder the card names (see the module's note).
 */
export function checkHeldCard(evidence: GuardianEvidence, now: Date, onThrow: (message: string) => void): HeldCheck {
  if (!isStateVerifiedApproversEnabled()) return { checked: false, why: 'switchedOff' }
  if (trustedStateRoots().length === 0) return { checked: false, why: 'noRoots' }
  const ward = attributesOf(evidence).ward
  return {
    checked: true,
    verdict: checkGuardianEvidence(evidence, typeof ward === 'string' && ward ? ward : null, now, onThrow),
  }
}

/**
 * What a check depends on besides the card: when this changes, the card is checked again. Each root by its AID and
 * its name, since the title the card shows is the name on the kept verdict: a root renamed on this list (as K0 was,
 * "Test state (K0)" to "State of Example") must not leave the old name on a card already checked.
 */
export const checkKeyOf = (evidence: GuardianEvidence): string =>
  [
    evidence.guardianSaid,
    isStateVerifiedApproversEnabled() ? 'sv' : '-',
    trustedStateRoots()
      .map((root) => `${root.aid}=${root.name}`)
      .join(','),
  ].join('|')

export type StateCardTone = 'ok' | 'notChecked' | 'problem'

export interface StateCardView {
  /** The state's name on this phone's list, once the card checks out; else a plain "State card". */
  title: string
  /** "Guardian of your contact". */
  guardianOf: string
  kind: string
  tone: StateCardTone
  /** The status in a sentence, for the details. */
  status: string
  /** The pill on the pass: "Demo" (cream) when it checks out from a demo root, else the problem in a word or two. */
  pill?: string
  /** "Demo card, loaded on this phone; not issued by a real state", for a demo card. */
  demoNote?: string
  issued?: { label: string; value: string }
  validUntil?: { label: string; value: string }
  technical: { holder: string; root?: string; said: string; expires?: string; result: string }
  accessibilityLabel: string
}

type Words = (key: string, extra?: Record<string, unknown>) => string

/** A refusal in plain words, with the pill it puts on the pass. */
function refusalWords(reason: string, words: Words): { status: string; pill: string } {
  switch (reason) {
    case 'revoked':
      return { status: words('StateCard.Revoked'), pill: words('StateCard.PillRevoked') }
    case 'expired':
      return { status: words('StateCard.Expired'), pill: words('StateCard.PillExpired') }
    case 'untrustedRoot':
      return { status: words('StateCard.Untrusted'), pill: words('StateCard.PillNotTrusted') }
    case 'notIssued':
    case 'statusNotCurrent':
    case 'noStateDisclosure':
    case 'telBroken':
    case 'telUnanchored':
      return { status: words('StateCard.StatusUnknown'), pill: words('StateCard.PillCouldNotVerify') }
    default:
      return { status: words('StateCard.Broken'), pill: words('StateCard.PillCouldNotVerify') }
  }
}

/** What the card says, from the card this phone holds and its check. */
export function stateCardView(
  evidence: GuardianEvidence,
  check: HeldCheck,
  t: TFunction,
  localDate: (iso: string) => string
): StateCardView {
  const words: Words = (key, extra = {}) => t(key, { ...extra, interpolation: { escapeValue: false } }) as string
  const a = attributesOf(evidence)
  const verdict = check.checked ? check.verdict : undefined
  const ok = verdict?.ok === true ? verdict : undefined
  // One answer to "is this a demo root", the one Who approves and the card question use (stateRoots).
  const demo = ok ? isDemoStateRoot(ok.root) : false
  const asOf = words(STATE_CARD_AS_OF)

  let tone: StateCardTone
  let status: string
  let pill: string | undefined
  if (!check.checked) {
    tone = 'notChecked'
    status = words('StateCard.SetupNeeded')
    pill = words('StateCard.PillNotChecked')
  } else if (ok) {
    tone = 'ok'
    status = words('StateCard.ChecksOut', { asOf })
    pill = demo ? words('StateCard.Demo') : undefined
  } else {
    tone = 'problem'
    ;({ status, pill } = refusalWords(verdict?.ok === false ? verdict.reason : 'checkFailed', words))
  }

  const issuedIso = dateText(a.issuedDate?.value)
  const untilIso = dateText(ok?.expires ?? a.expirationDate?.value)
  const issued = issuedIso ? { label: words('StateCard.Issued'), value: localDate(issuedIso) } : undefined
  const validUntil = untilIso ? { label: words('StateCard.ValidUntil'), value: localDate(untilIso) } : undefined
  const title = ok?.state ?? words('StateCard.UnknownState')
  const guardianOf = words('StateCard.GuardianOf', { ward: words('StateCard.YourContact') })
  const kind = words('StateCard.Kind')
  // A demo card says so wherever it is shown: one from a demo root, and the K0 test card whatever its check said.
  const demoNote =
    demo || evidence.guardianSaid === K0_TEST_GUARDIAN_CARD.guardianSaid ? words('StateCard.DemoNote') : undefined

  return {
    title,
    guardianOf,
    kind,
    tone,
    status,
    pill,
    demoNote,
    issued,
    validUntil,
    technical: {
      holder: evidence.holder,
      root: ok?.root,
      said: evidence.guardianSaid,
      expires: untilIso,
      result: !check.checked ? check.why : ok ? 'valid' : verdict?.ok === false ? verdict.reason : 'checkFailed',
    },
    accessibilityLabel: [title, kind, guardianOf, pill, issued && `${issued.label} ${issued.value}`]
      .filter(Boolean)
      .join(', '),
  }
}
