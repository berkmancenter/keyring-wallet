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

import type { JoinAsks, JoinCredentialIssuers, JoinHolds, JoinWay } from '../module/joinManifest'

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
  usable: boolean
  /** Keyring cannot read this way as published: said so, never offered. */
  cannotUse: boolean
  /**
   * The way asks for a credential, and Keyring cannot present one to join yet
   * (nothing picks a held credential to answer a criterion's query): said so
   * on the row. A property of the app today, not of the criterion.
   */
  credentialNotYet: boolean
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
      /** With no way this phone meets: what the person can go and get. */
      missing: Array<'invitation'>
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

export function joinCard(offer: JoinAsks, holds: JoinHolds = {}): JoinCard {
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
    credentialNotYet: way.usable && Boolean(way.requires.credentials),
  }))

  const suggested = offer.suggested
  // Ways Keyring can read that this phone does not meet yet.
  // A credential way is left out: Keyring cannot present one, so no step of the person's opens it.
  const open = suggested
    ? []
    : offer.ways.filter((way) => way.usable && way.meets !== 'yes' && !way.requires.credentials)
  const lacksInvitation = (way: JoinWay) => way.requires.invitation && !holds.invitation
  const missing: Array<'invitation'> = open.some(lacksInvitation) ? ['invitation'] : []
  // Vetting the person can go and do now: nothing else of that way is lacking.
  const vettingToDo = open.some((way) => way.requires.vetting && !lacksInvitation(way))

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
