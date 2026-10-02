/**
 * joinWays — what the Join screen says about a community's ways in.
 *
 * From join manifest 0.3 a community's criteria state their own admission
 * (VTI docs/03-vtc/join-criteria.md): each criterion is one way in, `automatic`
 * (a submission that meets it is admitted) or `review` (an administrator
 * decides), and lists what it requires — an invitation, credentials, peer
 * vetting, any of them or nothing. The community lists them in the order it
 * decides by.
 *
 * The rule the screen keeps: meeting a way is said to admit only when its
 * admission is automatic. A 0.2 manifest states no admission (`unstated`); the
 * screen then says exactly what it says today (`mode: 'legacy'`), guessing
 * nothing new.
 *
 * Pure: this decides what the card shows; `JoinWaysCard` words it.
 *
 * The offer's shape is the one agreed with the model's author for the 0.2/0.3
 * reader; the types here stand in until that module exports its own.
 *
 * @module trust-tasks/screens/joinWays
 */

export type JoinAdmission = 'automatic' | 'review' | 'unstated'

/** Whose credentials count for a way: this community's, one it recognises, or any issuer's. */
export type JoinCredentialIssuers = 'community' | 'recognised' | 'any'

export interface JoinWay {
  id: string
  description?: string
  admission: JoinAdmission
  requires: {
    invitation: boolean
    credentials?: { issuers: JoinCredentialIssuers; types: string[] }
    vetting?: { statements: number; claims: string[]; methods: string[] }
  }
  requiresNothing: boolean
  /** Whether this phone can apply under this way with what it holds now. */
  usable: boolean
  unusableBecause?: string
  /** The criterion's `requirementsDigest`: any change to the criterion changes it. */
  digest: string
}

export interface JoinOffer {
  accepting: boolean
  /** In the community's decision order. */
  ways: JoinWay[]
  /** The first usable way this phone can meet with what it holds. */
  suggested?: JoinWay
  outcomeIfMet: 'joined' | 'reviewed' | 'unstated'
}

/** One thing a way asks for. */
export type JoinNeed =
  | { kind: 'invitation' }
  | { kind: 'credential'; issuers: JoinCredentialIssuers; types: string[] }
  | { kind: 'vetting'; statements: number; claims: string[] }
  | { kind: 'nothing' }

export interface JoinWayRow {
  id: string
  needs: JoinNeed[]
  /** What follows meeting it; absent when the community does not say. */
  follows?: 'automatic' | 'review'
  /** The way this phone can use now. */
  suggested: boolean
  usable: boolean
  /** Unusable for a reason the person cannot fix by fetching something: this app cannot use it. */
  cannotUse: boolean
}

/**
 * The main button: `join` (an automatic way this phone meets now), `ask` (a
 * request an administrator reviews), `start` (vetting comes first, or the
 * community does not state its admission), `invited` (an invitation is what
 * is missing: go to "I was invited"), `none` (nothing this phone can do yet).
 */
export type JoinButton = 'join' | 'ask' | 'start' | 'invited' | 'none'

export type JoinCard =
  | { mode: 'legacy' }
  | { mode: 'notAccepting' }
  | {
      mode: 'ways'
      rows: JoinWayRow[]
      several: boolean
      button: JoinButton
      /** With no way this phone can use: what it lacks, an invitation first. */
      missing: Array<'invitation' | 'credential'>
    }

/** Reasons a way is unusable that mean "the phone lacks something", not "this app cannot do it". */
const LACKS = new Set(['noInvitation', 'noCredential'])

const needsOf = (way: JoinWay): JoinNeed[] => {
  const needs: JoinNeed[] = []
  if (way.requires.invitation) needs.push({ kind: 'invitation' })
  if (way.requires.credentials) {
    needs.push({ kind: 'credential', issuers: way.requires.credentials.issuers, types: way.requires.credentials.types })
  }
  if (way.requires.vetting) {
    needs.push({ kind: 'vetting', statements: way.requires.vetting.statements, claims: way.requires.vetting.claims })
  }
  return needs.length ? needs : [{ kind: 'nothing' }]
}

const sameWay = (a: JoinWay | undefined, b: JoinWay) => Boolean(a) && a!.id === b.id && a!.digest === b.digest

export function joinCard(offer: JoinOffer): JoinCard {
  if (!offer.accepting) return { mode: 'notAccepting' }
  // 0.2: no criterion states its admission. Said as today, whatever the count.
  if (offer.outcomeIfMet === 'unstated' && offer.ways.every((way) => way.admission === 'unstated')) {
    return { mode: 'legacy' }
  }
  // 0.3 with no criteria: the community accepts no applications.
  if (offer.ways.length === 0) return { mode: 'notAccepting' }

  const rows: JoinWayRow[] = offer.ways.map((way) => ({
    id: way.id,
    needs: needsOf(way),
    ...(way.admission === 'unstated' ? {} : { follows: way.admission }),
    suggested: sameWay(offer.suggested, way),
    usable: way.usable,
    cannotUse: !way.usable && way.unusableBecause !== undefined && !LACKS.has(way.unusableBecause),
  }))

  const suggested = offer.suggested
  const missing: Array<'invitation' | 'credential'> = []
  if (!suggested) {
    const lacking = offer.ways.filter((way, i) => !way.usable && !rows[i].cannotUse)
    if (lacking.some((way) => way.requires.invitation)) missing.push('invitation')
    if (lacking.some((way) => way.requires.credentials)) missing.push('credential')
  }

  const button: JoinButton = suggested
    ? suggested.requires.vetting || suggested.admission === 'unstated'
      ? 'start'
      : // Never "join" on the model's word alone: the way itself must be automatic.
        suggested.admission === 'automatic' && offer.outcomeIfMet === 'joined'
        ? 'join'
        : 'ask'
    : missing.includes('invitation')
      ? 'invited'
      : 'none'

  return { mode: 'ways', rows, several: rows.length > 1, button, missing }
}
