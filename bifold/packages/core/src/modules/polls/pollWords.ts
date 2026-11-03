/**
 * What a poll's row and screens say, from the poll and this phone's record of it. Never what the member chose:
 * the phone doesn't keep it.
 *
 * @module polls/pollWords
 */
import type { TFunction } from 'i18next'

import { localDate, localDateTime } from '../trust-tasks/screens/localTime'

import type { PollRecord, PollRefusal } from './pollService'
import type { PollListItem, PollShown } from './pollTasks'
import { refusalName } from './pollTasks'

export type PollPhase = 'sending' | 'voted' | 'notOpenYet' | 'open' | 'closed' | 'cancelled'

/** Where a poll stands for this member. */
export function pollPhase(
  poll: Pick<PollListItem, 'state' | 'votingOpensAt' | 'votingClosesAt'>,
  record: PollRecord | undefined,
  now: number
): PollPhase {
  if (poll.state === 'cancelled') return 'cancelled'
  if (record?.pending) return 'sending'
  if (record?.votedAt !== undefined) return 'voted'
  if (poll.state === 'closed' || poll.state === 'tallied' || now >= Date.parse(poll.votingClosesAt)) return 'closed'
  if (now < Date.parse(poll.votingOpensAt)) return 'notOpenYet'
  return 'open'
}

/** How far before its set close a closed poll must be read to count as closed early: a slow phone clock isn't it. */
export const EARLY_CLOSE_MARGIN_MS = 60_000

/**
 * Whether a closed poll was already closed at `at`, more than a minute before its set time. `at` is when the phone
 * read it closed, or when its results were certified. The community says when it closed a poll only on the board,
 * which a member can't always read, so this is inferred, and approximate by the phone's clock.
 */
export const closedEarly = (poll: Pick<PollListItem, 'votingClosesAt'>, at: number): boolean =>
  at < Date.parse(poll.votingClosesAt) - EARLY_CLOSE_MARGIN_MS

/**
 * What to say of a closed poll's close. An early close can be shown (read closed, or certified, before the set time);
 * an on-time one never can, since a poll closed early reads the same once its set time has passed. So it's "Closed
 * early" when shown, else just "Closed": never the set date, which an early close makes untrue.
 */
export function closeLine(
  t: TFunction,
  poll: Pick<PollListItem, 'votingClosesAt'>,
  now: number,
  certifiedAt?: string
): string {
  const early = closedEarly(poll, now) || (certifiedAt !== undefined && closedEarly(poll, Date.parse(certifiedAt)))
  return early ? t('Polls.ClosedEarly') : t('Polls.ClosedNoDate')
}

export const pollTitle = (t: TFunction, title: string | undefined): string =>
  title?.trim() || (t('Polls.Untitled') as string)

/** A row's second line. */
export function pollRowStatus(t: TFunction, poll: PollListItem, record: PollRecord | undefined, now: number): string {
  const phase = pollPhase(poll, record, now)
  const date = (iso: string) => ({ date: localDate(iso), interpolation: { escapeValue: false } })
  switch (phase) {
    case 'sending':
      return t('Polls.Sending')
    case 'voted':
      return t('Polls.YouVoted')
    case 'notOpenYet':
      return t('Polls.OpensOn', date(poll.votingOpensAt))
    case 'open':
      return t('Polls.OpenUntil', date(poll.votingClosesAt))
    case 'closed':
      return closeLine(t, poll, now)
    case 'cancelled':
      return t('Polls.Cancelled')
  }
}

/** When voting after the ticket is less easily paired with it: an hour after the ticket. */
export const PAIRING_WINDOW_MS = 60 * 60 * 1000

/** Minutes since the ticket while that's within the first hour, else undefined. */
export function minutesSinceTicket(record: PollRecord | undefined, now: number): number | undefined {
  if (record?.ticketAt === undefined) return undefined
  const since = now - record.ticketAt
  return since >= 0 && since < PAIRING_WINDOW_MS ? Math.max(1, Math.round(since / 60_000)) : undefined
}

/** The local time from which a vote is less easily paired with the ticket. */
export const lessLikelyFrom = (record: PollRecord): string =>
  localDateTime(new Date((record.ticketAt ?? 0) + PAIRING_WINDOW_MS).toISOString())

/** What a refusal before or during the ticket says. */
export function refusalText(t: TFunction, refusal: PollRefusal): string {
  switch (refusal.reason) {
    case 'noAgent':
      return t('Polls.NoAgent')
    case 'agentTooOld':
      return t('Polls.NeedsUpdate')
    case 'limited':
      return t('Polls.Limited')
    case 'voted':
      return t('Polls.AlreadyVoted')
    case 'heldByAnotherAgent':
      return t('Polls.HeldElsewhere')
    case 'pollChanged':
      return t('Polls.PollChanged')
    case 'notOpen':
      return t('Polls.NotOpen')
    case 'unsupportedSecrecy':
      return t('Polls.Unsupported')
    case 'noTicket':
      return t('Polls.NoTicket')
    default:
      return t(refusalName(refusal.code) === 'notEligible' ? 'Polls.NotEligible' : 'Polls.Refused')
  }
}

/** What a cast that stopped says: a refusal by its code, else that the same vote goes again. */
export function castFailureText(t: TFunction, failure: { kind: string; code?: string }): string {
  if (failure.kind !== 'refused') return t('Polls.SendingStopped')
  switch (refusalName(failure.code)) {
    case 'notOpen':
      return t('Polls.NotOpen')
    case 'alreadyVoted':
      return t('Polls.CastAlreadyVoted')
    default:
      return t('Polls.CastRefused')
  }
}

/** The ballot's first line, from who can read the board. */
export const boardLine = (t: TFunction, shown: PollShown): string =>
  t(shown.disclosure.boardVisibility === 'public' ? 'Polls.BoardPublic' : 'Polls.BoardPrivate')
