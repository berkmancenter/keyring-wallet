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
 * The offer is the 0.2/0.3 reader's `JoinAsks` (module/joinManifest.ts).
 *
 * @module trust-tasks/screens/joinWays
 */

import {
  HIDDEN_VETTING_SUITE,
  joinAsks,
  type JoinAsks,
  type JoinCredentialIssuers,
  type JoinHolds,
  type JoinWay,
  type JoinWayFault,
  type VtiManifest,
} from '../module/joinManifest'

/**
 * Why a way cannot be used, as the person is told it. Every fault is the
 * community's description, never the person: `incomplete` (a member the
 * format requires is missing), `unreadable` (a value this app does not know
 * yet), `changed` (the way does not match the fingerprint published for it).
 * `privateVetting` and `unsupportedVetting` are this app's limit instead: the
 * way runs vetting this version cannot do (IN-264).
 */
export type JoinCannotUse = 'incomplete' | 'unreadable' | 'changed' | 'privateVetting' | 'unsupportedVetting'

const CANNOT_USE: Record<JoinWayFault, JoinCannotUse> = {
  idMissing: 'incomplete',
  admissionMissing: 'incomplete',
  digestMissing: 'incomplete',
  issuersMissing: 'incomplete',
  admissionUnknown: 'unreadable',
  issuersUnknown: 'unreadable',
  vettingUnreadable: 'unreadable',
  digestMismatch: 'changed',
  vettingPrivate: 'privateVetting',
  vettingExtUnsupported: 'unsupportedVetting',
}

/** One thing a way asks for. */
export type JoinNeed =
  | { kind: 'invitation' }
  | { kind: 'credential'; issuers?: JoinCredentialIssuers; types: string[] }
  | { kind: 'vetting'; statements: number; claims: string[] }
  | { kind: 'nothing' }

export interface JoinWayRow {
  id: string
  needs: JoinNeed[]
  /** What follows meeting it; absent when the community does not say. */
  follows?: 'automatic' | 'review'
  /** The way this phone can use now. */
  suggested: boolean
  /**
   * Vetting is all this way still lacks, and the person can go and do it now.
   * Said on the row, so a way the phone already meets beside it (a review way
   * asks nothing, so every phone meets it) never reads as the only one.
   */
  canStartVetting: boolean
  usable: boolean
  /** Keyring cannot read this way as published: said so, never offered. */
  cannotUse: boolean
  /** With `cannotUse`: why, in the person's terms. Absent if the reader gave no reason. */
  cannotUseBecause?: JoinCannotUse
  /** With `cannotUse`: the reader's own fault and detail, for Details only. */
  cannotUseDetail?: string
  /**
   * The way asks for a credential, and Keyring cannot present one to join yet
   * (nothing picks a held credential to answer a criterion's query): said so
   * on the row. A property of the app today, not of the criterion.
   */
  credentialNotYet: boolean
  /**
   * The way runs private (hidden) vetting in the suite a person's agent can
   * run: offered, with its own button. Whether this person's agent can do it
   * is asked only on that tap (it may push a consent request to an
   * approver), never here.
   */
  privateVetting?: boolean
}

/**
 * The main button: `join` (an automatic way this phone meets now), `start`
 * (a vetting way is open to the person: go and do it), `ask` (a way it meets
 * that an administrator reviews, and no vetting to start), `invited` (an
 * invitation is what is missing: go to "I was invited"), `none` (nothing this
 * phone can do yet).
 *
 * Vetting is offered whatever else the phone meets, short of an automatic way
 * that admits it now: a community with a vetting way and a review way is the
 * ordinary vetting community, and every phone meets its review way.
 */
export type JoinButton = 'join' | 'ask' | 'start' | 'invited' | 'none'

/**
 * Vetting a way asks for that this version cannot do: `private` (hidden
 * vetting, which refuses the named statements Keyring gathers) or `other` (a
 * critical extension it does not implement). Said plainly, and no such way is
 * offered (IN-264).
 */
export type JoinVettingNotSupported = 'private' | 'other'

/** What the person is told for each: the community named (IN-264). */
export const VETTING_NOT_SUPPORTED_KEY: Record<JoinVettingNotSupported, string> = {
  private: 'Join.Ways.PrivateVetting',
  other: 'Join.Ways.UnsupportedVetting',
}

export type JoinCard =
  | { mode: 'legacy' }
  | { mode: 'notAccepting' }
  /** A 0.2 manifest whose criteria run vetting this version cannot do: nothing to offer. */
  | { mode: 'vettingNotSupported'; vetting: JoinVettingNotSupported }
  | {
      mode: 'ways'
      rows: JoinWayRow[]
      several: boolean
      button: JoinButton
      /** Beside `start`: the phone also meets a reviewed way, so it may ask instead. */
      alsoAsk: boolean
      /** With no way this phone meets: what the person can go and get. */
      missing: Array<'invitation'>
      /** Not one way can be used as published: the person is told nothing is wrong on their side. */
      noneUsable: boolean
      /** A way runs vetting this version cannot do: said for the whole card. */
      vettingNotSupported?: JoinVettingNotSupported
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

/**
 * A private way this app can offer: hidden vetting in the suite agents run,
 * and this build able to carry it (`privateVettingAvailable`).
 */
const offersPrivately = (way: JoinWay, available: boolean) =>
  available && way.unusableBecause === 'vettingPrivate' && way.hiddenVetting?.suite === HIDDEN_VETTING_SUITE

export function joinCard(
  offer: JoinAsks,
  holds: JoinHolds = {},
  options: {
    /** This build carries hidden vetting through the person's agent. Off: every private way fails closed (#405). */
    privateVettingAvailable?: boolean
  } = {}
): JoinCard {
  const available = Boolean(options.privateVettingAvailable) && offer.wire === '0.3'
  const notSupported: JoinVettingNotSupported | undefined = offer.ways.some(
    (way) => way.unusableBecause === 'vettingPrivate' && !offersPrivately(way, available)
  )
    ? 'private'
    : offer.ways.some((way) => way.unusableBecause === 'vettingExtUnsupported')
      ? 'other'
      : undefined
  // 0.2: no criterion states its admission. Said as today, whatever it lists —
  // unless it runs vetting this version cannot do: then nothing is offered,
  // since the legacy view would start named vetting (IN-264).
  if (offer.wire === '0.2')
    return notSupported ? { mode: 'vettingNotSupported', vetting: notSupported } : { mode: 'legacy' }
  // No criteria, or it says so: the community accepts no applications.
  if (!offer.accepting || offer.ways.length === 0) return { mode: 'notAccepting' }

  const suggested = offer.suggested
  const lacksInvitation = (way: JoinWay) => way.requires.invitation && !holds.invitation
  // Ways Keyring can read that this phone does not meet yet.
  // A credential way is left out: Keyring cannot present one, so no step of the person's opens it.
  const open = offer.ways.filter((way) => way.usable && way.meets !== 'yes' && !way.requires.credentials)
  // Vetting the person can go and do now: nothing else of that way is lacking.
  const startable = (way: JoinWay) => open.includes(way) && Boolean(way.requires.vetting) && !lacksInvitation(way)
  const vettingToDo = offer.ways.some(startable)
  // Never "join" on the model's word alone: the way itself must be automatic.
  const joinsNow = Boolean(suggested) && suggested!.admission === 'automatic' && offer.outcomeIfMet === 'joined'
  // With no way this phone meets, an invitation is what the person can go and get.
  const missing: Array<'invitation'> = !suggested && !vettingToDo && open.some(lacksInvitation) ? ['invitation'] : []

  const rows: JoinWayRow[] = offer.ways.map((way) => ({
    id: way.id,
    needs: needsOf(way),
    ...(way.admission === 'unstated' ? {} : { follows: way.admission }),
    suggested: way.usable && sameWay(suggested, way),
    // A phone that is admitted now has no vetting to be sent to.
    canStartVetting: !joinsNow && startable(way),
    usable: way.usable,
    cannotUse: !way.usable && !offersPrivately(way, available),
    ...(offersPrivately(way, available) ? { privateVetting: true } : {}),
    ...(!way.usable && !offersPrivately(way, available) && way.unusableBecause
      ? {
          cannotUseBecause: CANNOT_USE[way.unusableBecause],
          cannotUseDetail: way.unusableDetail ? `${way.unusableBecause}: ${way.unusableDetail}` : way.unusableBecause,
        }
      : {}),
    credentialNotYet: way.usable && Boolean(way.requires.credentials),
  }))

  const button: JoinButton = joinsNow
    ? 'join'
    : vettingToDo
      ? 'start'
      : suggested
        ? 'ask'
        : missing.includes('invitation')
          ? 'invited'
          : 'none'

  return {
    mode: 'ways',
    rows,
    several: rows.length > 1,
    button,
    alsoAsk: button === 'start' && Boolean(suggested),
    missing,
    noneUsable: rows.every((row) => row.cannotUse),
    ...(notSupported ? { vettingNotSupported: notSupported } : {}),
  }
}

/**
 * Whether the vetting an application gathers for is vetting this version
 * cannot do (IN-264), for the vetting screen, which must neither start it, ask
 * a vetter for it, nor send it. The criterion the application named
 * (`digest`) when it named one; otherwise every way in that asks for vetting,
 * since any of them may be the one it is decided by. Undefined when named
 * vetting is what is asked, or the community asks for no vetting at all.
 */
export function vettingNotSupportedFor(manifest: VtiManifest, digest?: string): JoinVettingNotSupported | undefined {
  const vettingWays = joinAsks(manifest).ways.filter((way) => way.requires.vetting)
  const named = digest ? vettingWays.filter((way) => way.digest === digest) : []
  const ways = named.length ? named : vettingWays
  if (!ways.length) return undefined
  const notSupported = (way: JoinWay) =>
    way.unusableBecause === 'vettingPrivate' || way.unusableBecause === 'vettingExtUnsupported'
  if (!ways.every(notSupported)) return undefined
  return ways.some((way) => way.unusableBecause === 'vettingPrivate') ? 'private' : 'other'
}
