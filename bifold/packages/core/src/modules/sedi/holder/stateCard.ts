/**
 * What the state card in Credentials says (SEDI/KERI holder card): the Guardian card this phone holds, checked here.
 *
 * Checked as its holder: there is no ward and no own KERI identifier on this phone yet (stage 3), so the ward and the
 * holder the check expects are read from the card itself, and those two checks prove nothing here. What a "Checks out"
 * does prove, and all it may claim: the card's chain verifies to a State root on this phone's list, and the card is
 * neither revoked nor expired, as of what the check read: the state's published record when its root was fetched live
 * ({@link STATE_CARD_AS_OF_LIVE}), else the copy this phone holds ({@link STATE_CARD_AS_OF}).
 *
 * The check is checkGuardianEvidenceResolving: a root on this phone's list that publishes at a did:webs is fetched and
 * checked against what it publishes, and one that can't be reached refuses as `stateNotResolved` (never the card's own
 * copy instead). It is asynchronous, so until it answers the card says it is checking.
 *
 * Never "Checks out" unless that check returned `ok: true`: checking, switched off, no root trusted, and every
 * refusal each say what they are instead.
 *
 * Pure apart from the switches it reads at the call: the same card, switches, clock and answer give the same words.
 *
 * @module sedi/holder/stateCard
 */
import type { TFunction } from 'i18next'

import {
  checkGuardianEvidenceResolving,
  guardianSourceKey,
  type GuardianEvidence,
  type GuardianVerdict,
} from '../../trust-tasks/guardianEvidence'
import { isStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'
import { K0_TEST_GUARDIAN_CARD } from '../guardian/k0TestCard'
import { isDemoStateRoot, k1Root, trustedStateRoots } from '../guardian/stateRoots'
import { websDidToFetch } from '../webs/demoStateHost'

/** How far a "Checks out" reaches when the check read the copy this phone holds. */
export const STATE_CARD_AS_OF = 'StateCard.AsOfHeldCopy'
/** How far it reaches when the root was fetched live: the state's published record. */
export const STATE_CARD_AS_OF_LIVE = 'StateCard.AsOfPublished'
/** The as-of line when the record was fetched from the host the state office's QR named (K1 'fromCard'). */
export const STATE_CARD_AS_OF_QR_HOST = 'StateCard.AsOfQrHost'

/**
 * The outcome of checking the held card: not checked (and why), still checking (the live fetch has not answered), or
 * the check's verdict.
 */
export type HeldCheck =
  | { checked: false; why: 'switchedOff' | 'noRoots' }
  | { checked: 'pending' }
  | { checked: true; verdict: GuardianVerdict }

/** The check runs into this seam so a row can answer for the network (the check's own `deps`). */
export type HeldCheckDeps = Parameters<typeof checkGuardianEvidenceResolving>[4]

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
 * Why the held card can't be checked on this phone now, if it can't: state-verified approvers off, or no root trusted
 * (the verifier would only refuse, and the person is told what to turn on instead). Read at the call, synchronously.
 */
export function heldCardUncheckable(): HeldCheck | undefined {
  if (!isStateVerifiedApproversEnabled()) return { checked: false, why: 'switchedOff' }
  if (trustedStateRoots().length === 0) return { checked: false, why: 'noRoots' }
  return undefined
}

/**
 * Check the held card: not run at all when {@link heldCardUncheckable} says so; otherwise
 * checkGuardianEvidenceResolving, which never throws, against the ward and holder the card names (see the module's
 * note). Its root is fetched live when it publishes at a did:webs.
 */
export async function checkHeldCard(
  evidence: GuardianEvidence,
  now: Date,
  onThrow: (message: string) => void,
  deps?: HeldCheckDeps
): Promise<HeldCheck> {
  const uncheckable = heldCardUncheckable()
  if (uncheckable) return uncheckable
  const ward = attributesOf(evidence).ward
  const verdict = await checkGuardianEvidenceResolving(
    evidence,
    typeof ward === 'string' && ward ? ward : null,
    now,
    onThrow,
    deps
  )
  return { checked: true, verdict }
}

/**
 * What a check depends on besides the card: when this changes, the card is checked again. Each root by its AID, its
 * name, and the did:webs it would be fetched from now. The name, since the title the card shows is the name on the
 * kept verdict: a root renamed on this list (as K0 was, "Test state (K0)" to "State of Example", then to "State of Utah") must not leave the
 * old name on a card already checked. The did:webs, since it decides whether the check reads the state live or the
 * copy here: a Developer "Demo state host" set or cleared must not leave a copy's verdict saying it was fetched live,
 * or the reverse.
 */
export const checkKeyOf = (evidence: GuardianEvidence): string =>
  [
    evidence.guardianSaid,
    isStateVerifiedApproversEnabled() ? 'sv' : '-',
    trustedStateRoots()
      .map((root) => `${root.aid}=${root.name}=${websDidToFetch(root) ?? ''}`)
      .join(','),
  ].join('|')

export type StateCardTone = 'ok' | 'checking' | 'notChecked' | 'problem'

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
  /** How far a "Checks out" reaches, for the details' "what was checked" line: live, or the copy here. */
  asOf: string
  /**
   * Where a "Checks out" came from, in Who approves' own words: "Fetched live from <host>…", or for a demo root read
   * from the copy here, "Demo: checked against a copy on this phone." Only beside a "Checks out".
   */
  source?: string
  /** "Demo card, loaded on this phone; not issued by the State of Utah", for a demo card (the K0 kit's). */
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
    // A revocation says whose record shows it, in Who approves' own words (the StateCard keys mirror the Approver ones,
    // and a row holds them equal in every language): the card's own copy, an issuer's published history, or the
    // state root's own. Never the generic words: a revoked card is not a broken one.
    case 'revoked':
      return { status: words('StateCard.Revoked'), pill: words('StateCard.PillRevoked') }
    case 'revokedInIssuerRecord':
      return { status: words('StateCard.RevokedIssuer'), pill: words('StateCard.PillRevoked') }
    case 'revokedInStateRecord':
      return { status: words('StateCard.RevokedState'), pill: words('StateCard.PillRevoked') }
    case 'expired':
      return { status: words('StateCard.Expired'), pill: words('StateCard.PillExpired') }
    case 'untrustedRoot':
      return { status: words('StateCard.Untrusted'), pill: words('StateCard.PillNotTrusted') }
    // Its own words: the state's published record could not be read, and the copy here is never used instead.
    case 'stateNotResolved':
      return { status: words('StateCard.NotReached'), pill: words('StateCard.PillNotReached') }
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
  localDate: (iso: string) => string,
  localClock: (iso: string) => string = (iso) => iso
): StateCardView {
  const words: Words = (key, extra = {}) => t(key, { ...extra, interpolation: { escapeValue: false } }) as string
  const a = attributesOf(evidence)
  const verdict = check.checked === true ? check.verdict : undefined
  const ok = verdict?.ok === true ? verdict : undefined
  // One answer to "is this a demo root", the one Who approves and the card question use (stateRoots).
  const demo = ok ? isDemoStateRoot(ok.root) : false
  // The host the state office's QR named is said to be that, never "the state's published record" (K1 'fromCard').
  const asOf = words(
    ok?.fetchedFrom ? (ok.hostFromCard ? STATE_CARD_AS_OF_QR_HOST : STATE_CARD_AS_OF_LIVE) : STATE_CARD_AS_OF
  )
  // Which "fetched live" line, decided where Who approves decides it (guardianSourceKey): the full line only when the
  // root and every issuer in its chain were fetched live, else "the issuers' records came from the card"; each with
  // its "at <time>" variant for a fetch reused because the host just failed (the result is no fresher than that). The
  // status is still the full check's, run again on it.
  const sourceKey = ok
    ? guardianSourceKey({
        kind: 'verified',
        state: ok.state,
        ...(ok.fetchedFrom ? { fetchedFrom: ok.fetchedFrom } : {}),
        ...(ok.fetchedAt ? { fetchedAt: ok.fetchedAt } : {}),
        ...(ok.fetchedIssuers ? { fetchedIssuers: true as const } : {}),
      })
    : null
  // The holder's own words for the host the QR named (Who approves has the person's: "the host <name>'s card names").
  const qrKey =
    ok?.fetchedFrom && ok.hostFromCard
      ? ok.fetchedAt
        ? 'StateCard.FetchedFromQrHostAt'
        : 'StateCard.FetchedFromQrHost'
      : null
  // A host the card came with that the state does not name was not fetched: the copy was checked, and it says so.
  const withheld = verdict?.hostWithheld
  const source = withheld
    ? words(withheld.result === 'unreachable' ? 'StateCard.HostUnchecked' : 'StateCard.HostNotNamed', {
        host: withheld.host,
      })
    : qrKey
      ? words(qrKey, { host: ok?.fetchedFrom, ...(ok?.fetchedAt ? { time: localClock(ok.fetchedAt) } : {}) })
      : sourceKey
        ? words(sourceKey, { host: ok?.fetchedFrom, ...(ok?.fetchedAt ? { time: localClock(ok.fetchedAt) } : {}) })
        : demo
          ? words('Approver.GuardianDemoCopy')
          : undefined

  let tone: StateCardTone
  let status: string
  let pill: string | undefined
  if (check.checked === 'pending') {
    tone = 'checking'
    status = words('StateCard.Checking')
    pill = words('StateCard.PillChecking')
  } else if (check.checked === false) {
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
  // A demo card says so wherever it is shown: one from a demo root, and the K0 test card whatever its check said. A
  // card from K1, the local state office, says it came from that office, not loaded from the kit (and it, too, that
  // the State of Utah did not issue it), whatever its check said.
  const k1 = k1Root()
  const fromOffice = !!k1 && (ok?.root === k1.aid || evidence.creds.some((cred) => cred.includes(k1.aid)))
  const demoNote = fromOffice
    ? words('StateCard.DemoNoteOffice')
    : demo || evidence.guardianSaid === K0_TEST_GUARDIAN_CARD.guardianSaid
      ? words('StateCard.DemoNote')
      : undefined

  return {
    title,
    guardianOf,
    kind,
    tone,
    status,
    pill,
    asOf,
    source,
    demoNote,
    issued,
    validUntil,
    technical: {
      holder: evidence.holder,
      root: ok?.root,
      said: evidence.guardianSaid,
      expires: untilIso,
      result:
        check.checked === 'pending'
          ? 'checking'
          : check.checked === false
            ? check.why
            : ok
              ? 'valid'
              : verdict?.ok === false
                ? verdict.reason
                : 'checkFailed',
    },
    accessibilityLabel: [title, kind, guardianOf, pill, issued && `${issued.label} ${issued.value}`]
      .filter(Boolean)
      .join(', '),
  }
}
