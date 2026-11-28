/**
 * "What my agent saw" (C4; backlog brief, section B part 3, "The view"): what one agent read and what happened to
 * its grant, from the audit read and the summary read, as a view model. Copy keys and parameters only, with times as
 * ISO-8601 instants and labels as label keys: formatting a time and choosing the language are the screen's job
 * ({@link hcpWhatItSawText} is for tests and for whoever moves the copy into the localization files).
 *
 * @module connected-agents/hcp/whatItSaw/view
 */
import type { HcpCopyLanguage } from '../copy'
import { onHcpFailure, type HcpCallFailure, type HcpCallOutcome } from '../vtaPort'
import type { HcpAuditEvent, HcpAuditRead } from './audit'
import { whatItSawText, type WhatItSawCopyKey } from './copy'
import {
  HCP_CATEGORY_LABELS,
  HCP_PURPOSE_LABELS,
  hcpCategoryLabel,
  hcpListForm,
  hcpPurposeLabel,
  type HcpCategoryLabel,
  type HcpPurposeLabel,
} from './labels'
import type { HcpClientSummary } from './summary'

export type WhatItSawRow =
  | { key: 'WhatItSawRead'; params: { category: HcpCategoryLabel; purpose: HcpPurposeLabel; time: string } }
  | { key: 'WhatItSawReadOther'; params: { category: HcpCategoryLabel; time: string } }
  | { key: 'WhatItSawConnected' | 'WhatItSawRevoked' | 'WhatItSawTold'; params: { time: string } }

export type WhatItSawSummaryLine =
  | { key: 'WhatItSawSummary'; params: { n: number; categories: HcpCategoryLabel[]; last: string; until: string } }
  | { key: 'WhatItSawSummaryOne'; params: { categories: HcpCategoryLabel[]; last: string; until: string } }
  | { key: 'WhatItSawSummaryNoUntil'; params: { n: number; categories: HcpCategoryLabel[]; last: string } }
  | { key: 'WhatItSawSummaryOneNoUntil'; params: { categories: HcpCategoryLabel[]; last: string } }

export interface HcpWhatItSawView {
  /** "What "<name>" saw". */
  title: { key: 'WhatItSawTitle'; params: { name: string } }
  /** From the summary entry; absent when there is none, or it counts no retrievals. */
  summaryLine?: WhatItSawSummaryLine
  /** Newest first. */
  rows: WhatItSawRow[]
  /** "It hasn't read anything yet.": the audit read answered in full and holds no read. */
  empty?: { key: 'WhatItSawEmpty' }
  /** "Showing the earliest 500.": the audit read stopped at the maximum with more left. */
  more?: { key: 'WhatItSawMore' }
  /**
   * Either read failed. A refusal wins over an unreachable VTA, so the screen never offers a retry that would meet
   * the same refusal. The view still shows whatever was read.
   */
  error?: { key: 'WhatItSawUnreachable' } | { key: 'WhatItSawRefused' }
}

/**
 * The view, or `off` when either read found the HCP flags off. No copy for `off`, on purpose: with the flags off the
 * screen is not reachable, so a string here would only show when something is already wrong.
 */
export type HcpWhatItSawResult = HcpWhatItSawView | { off: true }

/** The agent the view is about: the name the person gave, and the grants that are this agent's. */
export interface HcpWhatItSawAgent {
  name: string
  grantIds: readonly string[]
}

type Failure = 'refused' | 'unreachable' | 'off'

const failureOf = (failure: HcpCallFailure): Failure =>
  onHcpFailure<Failure>(failure, { refused: () => 'refused', unreachable: () => 'unreachable', off: () => 'off' })

const EVENT_ROWS: Record<string, 'WhatItSawConnected' | 'WhatItSawRevoked' | 'WhatItSawTold'> = {
  'grant.issued': 'WhatItSawConnected',
  'grant.revoked': 'WhatItSawRevoked',
  'revocation.notified': 'WhatItSawTold',
}

/**
 * The rows of one event. `context.read` gives one row per category (one `other` row if it names none); the three
 * grant events one row each; every other event type none, as the brief decides: they belong to other features.
 */
function rowsOf(event: HcpAuditEvent): WhatItSawRow[] {
  const time = event.timestamp
  if (event.eventType === 'context.read') {
    const purpose = hcpPurposeLabel(event.purpose)
    const categories = event.categories.length > 0 ? event.categories : ['']
    return categories.map((c): WhatItSawRow => {
      const category = hcpCategoryLabel(c)
      return purpose
        ? { key: 'WhatItSawRead', params: { category, purpose, time } }
        : { key: 'WhatItSawReadOther', params: { category, time } }
    })
  }
  const key = Object.prototype.hasOwnProperty.call(EVENT_ROWS, event.eventType)
    ? EVENT_ROWS[event.eventType]
    : undefined
  return key ? [{ key, params: { time } }] : []
}

function summaryLineOf(entry: HcpClientSummary | undefined, now: Date): WhatItSawSummaryLine | undefined {
  if (!entry || entry.retrievals === 0) return undefined
  const categories = [...new Set(entry.categories.map(hcpCategoryLabel))]
  const last = entry.lastAt
  const n = entry.retrievals
  const until = entry.usableUntil
  if (until !== null && Date.parse(until) > now.getTime()) {
    return n === 1
      ? { key: 'WhatItSawSummaryOne', params: { categories, last, until } }
      : { key: 'WhatItSawSummary', params: { n, categories, last, until } }
  }
  return n === 1
    ? { key: 'WhatItSawSummaryOneNoUntil', params: { categories, last } }
    : { key: 'WhatItSawSummaryNoUntil', params: { n, categories, last } }
}

/**
 * The view of what one agent saw. Only events whose `grantId` is one of `agent.grantIds` give rows: the client's VID
 * filters the read, and the grant filters it again, so a second grant of the same client under another name is not
 * mixed in. `now` decides whether `usableUntil` has passed.
 */
export function hcpWhatItSawView(
  agent: HcpWhatItSawAgent,
  audit: HcpAuditRead,
  summary: HcpCallOutcome<HcpClientSummary | undefined>,
  now: Date
): HcpWhatItSawResult {
  const failures = [audit.failure, summary.ok ? undefined : summary]
    .filter((f): f is HcpCallFailure => f !== undefined)
    .map(failureOf)
  if (failures.includes('off')) return { off: true }

  const grants = new Set(agent.grantIds)
  const events = audit.events
    .filter((e) => e.grantId !== null && grants.has(e.grantId))
    .map((e, order) => ({ e, order, at: Date.parse(e.timestamp) }))
    // Newest first; events at the same instant keep the log's order reversed, as a newest-first list would.
    .sort((a, b) => b.at - a.at || b.order - a.order)
  const rows = events.flatMap(({ e }) => rowsOf(e))

  const view: HcpWhatItSawView = { title: { key: 'WhatItSawTitle', params: { name: agent.name } }, rows }
  const summaryLine = summaryLineOf(summary.ok ? summary.value : undefined, now)
  if (summaryLine) view.summaryLine = summaryLine
  const hasRead = rows.some((r) => r.key === 'WhatItSawRead' || r.key === 'WhatItSawReadOther')
  if (!hasRead && audit.failure === undefined) view.empty = { key: 'WhatItSawEmpty' }
  if (audit.cut) view.more = { key: 'WhatItSawMore' }
  if (failures.includes('refused')) view.error = { key: 'WhatItSawRefused' }
  else if (failures.includes('unreachable')) view.error = { key: 'WhatItSawUnreachable' }
  return view
}

type Line = { key: WhatItSawCopyKey; params?: Record<string, unknown> }

/**
 * One line of the view as text in `lang`: label keys become their labels (`categories` in the language's list
 * form), numbers become digits, and times stay ISO-8601 (the screen formats them).
 */
export function hcpWhatItSawText(line: Line, lang: HcpCopyLanguage): string {
  const params: Record<string, string> = {}
  for (const [name, value] of Object.entries(line.params ?? {})) {
    if (name === 'category') params[name] = HCP_CATEGORY_LABELS[value as HcpCategoryLabel][lang]
    else if (name === 'categories')
      params[name] = hcpListForm(
        (value as HcpCategoryLabel[]).map((c) => HCP_CATEGORY_LABELS[c][lang]),
        lang
      )
    else if (name === 'purpose') params[name] = HCP_PURPOSE_LABELS[value as HcpPurposeLabel][lang]
    else params[name] = String(value)
  }
  return whatItSawText(line.key, lang, params)
}
