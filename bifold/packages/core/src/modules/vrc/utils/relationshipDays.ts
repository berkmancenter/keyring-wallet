/**
 * "How you know <name>", one entry per day (the Contact Details redesign, approved 2026-10-25). A merged contact or
 * a relationship signed again holds several sets of cards from one day, and the screen said each as its own line,
 * the same words and date two or three times, with the witness record in another block in another date format.
 *
 * A day gathers what the records on this phone show for it: how many times cards were exchanged, how many of
 * those carry hardware evidence that verified, the witnesses who saw it and whether one confirmed you were near.
 * Nothing is said that a record does not show, and secure hardware is said only once its evidence verified.
 *
 * @module vrc/utils/relationshipDays
 */
import { localDayKey } from '../../../utils/localDay'

import type { RelationshipLayer } from './relationshipLayers'

export interface RelationshipDay {
  /** The local calendar day ("2026-10-15"), or '' for records with no date, which form one day of their own. */
  day: string
  /** The newest timestamp of the day, for its label. */
  at?: string
  /** How many times cards were exchanged that day. */
  cards: number
  /** Of those, how many carry hardware evidence that verified on this phone. */
  hardwareVerified: number
  /** Of those, how many are still being checked: nothing is said about hardware until none is. */
  hardwareChecking: number
  /** The named witnesses of the day, each once, in the order their records came. */
  witnesses: string[]
  /** A witness record with no name. */
  unnamedWitness: boolean
  /** A witness confirmed you were near. */
  inPerson: boolean
  /** The day's records, for its detail. */
  layers: RelationshipLayer[]
}

/** A timestamp's local calendar day (utils/localDay's key), or '' when it has none or cannot be read. */
export function localDay(at?: string): string {
  if (!at) return ''
  const time = Date.parse(at)
  return Number.isFinite(time) ? localDayKey(new Date(time)) : ''
}

/**
 * The relationship's days, newest first, the undated last. `verified` says, per index into `layers`, whether that
 * set of cards' hardware evidence verified (true), did not (false), or is still being checked (absent); a card with
 * no hardware evidence needs no entry.
 */
export function relationshipDays(
  layers: readonly RelationshipLayer[],
  verified: Readonly<Record<number, boolean>>
): RelationshipDay[] {
  const days = new Map<string, RelationshipDay>()
  layers.forEach((layer, index) => {
    const key = localDay(layer.at)
    const day =
      days.get(key) ??
      ({
        day: key,
        cards: 0,
        hardwareVerified: 0,
        hardwareChecking: 0,
        witnesses: [],
        unnamedWitness: false,
        inPerson: false,
        layers: [],
      } as RelationshipDay)
    day.layers.push(layer)
    if (layer.at && (!day.at || layer.at > day.at)) day.at = layer.at
    if (layer.kind === 'card') {
      day.cards++
      if (layer.hardwareEvidence) {
        if (verified[index] === true) day.hardwareVerified++
        else if (verified[index] === undefined) day.hardwareChecking++
      }
    } else {
      if (layer.witnessName) {
        if (!day.witnesses.includes(layer.witnessName)) day.witnesses.push(layer.witnessName)
      } else {
        day.unnamedWitness = true
      }
      if (layer.inPerson) day.inPerson = true
    }
    days.set(key, day)
  })
  return [...days.values()].sort((a, b) => (a.day === b.day ? 0 : !a.day ? 1 : !b.day ? -1 : a.day < b.day ? 1 : -1))
}
