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
 * The offer is the 0.2/0.3 reader's `JoinAsks` (module/joinManifest.ts); the
 * types here mirror it until that module is on main, then they are imported.
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
  /** Whether Keyring can read this way as published. False: it cannot be used at all. */
  usable: boolean
  /** Why it cannot be read (`admissionUnknown`, `digestMismatch`, …); never "the phone lacks something". */
  unusableBecause?: string
  /** For Details only. */
  unusableDetail?: string
  /**
   * Whether this phone meets it with what it holds: `no` when something in
   * `requires` is lacking; `unknown` when it asks for credentials, which the
   * reader does not evaluate.
   */
  meets: 'yes' | 'no' | 'unknown'
  /** The criterion's `requirementsDigest`: any change to the criterion changes it. Absent on a malformed criterion. */
  digest?: string
}

/** What this phone holds towards a community, as far as the screen knows. */
export interface JoinHolds {
  invitation?: boolean
  statements?: number
}

export interface JoinOffer {
  /** The manifest version the community answered with. */
  wire: '0.3' | '0.2'
  accepting: boolean
  /** In the community's decision order. */
  ways: JoinWay[]
  /** The first usable way this phone meets with what it holds; absent when it meets none (always, at 0.2). */
  suggested?: JoinWay
  /** What meeting the suggested way leads to; absent with it. */
  outcomeIfMet?: 'joined' | 'reviewed' | 'unstated'
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
  /** Keyring cannot read this way as published: said so, never offered. */
  cannotUse: boolean
}

/**
 * The main button: `join` (an automatic way this phone meets now), `ask` (a
 * way it meets that an administrator reviews), `start` (vetting is what is
 * left to do), `invited` (an invitation is what is missing: go to "I was
 * invited"), `none` (nothing this phone can do yet).
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

export function joinCard(offer: JoinOffer, holds: JoinHolds = {}): JoinCard {
  // 0.2: no criterion states its admission. Said as today, whatever it lists.
  if (offer.wire === '0.2') return { mode: 'legacy' }
  // No criteria, or it says so: the community accepts no applications.
  if (!offer.accepting || offer.ways.length === 0) return { mode: 'notAccepting' }

  const rows: JoinWayRow[] = offer.ways.map((way) => ({
    id: way.id,
    needs: needsOf(way),
    ...(way.admission === 'unstated' ? {} : { follows: way.admission }),
    suggested: way.usable && sameWay(offer.suggested, way),
    usable: way.usable,
    cannotUse: !way.usable,
  }))

  const suggested = offer.suggested
  // Ways Keyring can read that this phone does not meet yet.
  const open = suggested ? [] : offer.ways.filter((way) => way.usable && way.meets !== 'yes')
  const lacksInvitation = (way: JoinWay) => way.requires.invitation && !holds.invitation
  const missing: Array<'invitation' | 'credential'> = []
  if (open.some(lacksInvitation)) missing.push('invitation')
  // Credentials are not evaluated: named as what a way needs, never as something the phone lacks.
  if (open.some((way) => way.requires.credentials)) missing.push('credential')
  // Vetting the person can go and do now: nothing else of that way is lacking.
  const vettingToDo = open.some((way) => way.requires.vetting && !way.requires.credentials && !lacksInvitation(way))

  const button: JoinButton = suggested
    ? // Never "join" on the model's word alone: the way itself must be automatic.
      suggested.admission === 'automatic' && offer.outcomeIfMet === 'joined'
      ? 'join'
      : 'ask'
    : vettingToDo
      ? 'start'
      : missing.includes('invitation')
        ? 'invited'
        : 'none'

  return { mode: 'ways', rows, several: rows.length > 1, button, missing: vettingToDo ? [] : missing }
}
