/**
 * `hcpWhatItSawView` over answers read through the real `readHcpAudit` and `readHcpSummary` from a fake VTA: the row
 * per event type, the grant filter, newest first, the summary line, empty, the 500 cut, unreachable and refusal kept
 * apart, and an unknown purpose never showing its IRI.
 */
import type { HcpCallOutcome } from '../../vtaPort'
import { HcpOffError } from '../../vtaPort'
import { HCP_AUDIT_READ, readHcpAudit, type HcpAuditRead } from '../audit'
import { readHcpSummary, type HcpClientSummary } from '../summary'
import { hcpWhatItSawText, hcpWhatItSawView, type HcpWhatItSawView } from '../view'
import {
  auditEvent,
  CLIENT,
  fakeVta,
  GRANT,
  OTHER_GRANT,
  readEvent,
  refusal,
  summaryAnswer,
  TASK_EXECUTION,
} from './fixtures/fakeVta'
import { expectValid, whatItSawSchemas } from './fixtures/whatItSawSchemas'

const S = whatItSawSchemas()[HCP_AUDIT_READ]
const NOW = new Date('2026-11-27T10:25:00.000Z')
const AGENT = { name: 'My notes agent', grantIds: [GRANT] }

async function auditOf(events: unknown[], extra: Record<string, unknown> = {}): Promise<HcpAuditRead> {
  const answer = { events, ...extra }
  expectValid(S.response, answer)
  return readHcpAudit(fakeVta(() => answer).port, { client: CLIENT })
}

async function summaryOf(change: Record<string, unknown> = {}): Promise<HcpCallOutcome<HcpClientSummary | undefined>> {
  return readHcpSummary(fakeVta(() => summaryAnswer(change)).port, CLIENT)
}

const asView = (result: ReturnType<typeof hcpWhatItSawView>): HcpWhatItSawView => {
  if ('off' in result) throw new Error('off')
  return result
}

const FAILS = {
  refused: () => Promise.reject(refusal()),
  unreachable: () => Promise.reject(new Error('timeout')),
  off: () => Promise.reject(new HcpOffError()),
}
const failingAudit = (how: keyof typeof FAILS) => readHcpAudit(fakeVta(FAILS[how]).port, { client: CLIENT })
const failingSummary = (how: keyof typeof FAILS) => readHcpSummary(fakeVta(FAILS[how]).port, CLIENT)

describe('hcpWhatItSawView', () => {
  it('maps each event type to its row, newest first, and leaves other event types out', async () => {
    const audit = await auditOf([
      auditEvent('grant.issued', '2026-11-27T10:00:00.000Z'),
      readEvent('2026-11-27T10:05:00.000Z', ['general_preferences', 'work_context']),
      auditEvent('rule.set', '2026-11-27T10:06:00.000Z'),
      readEvent('2026-11-27T10:10:00.000Z', ['health_context'], TASK_EXECUTION),
      auditEvent('grant.revoked', '2026-11-27T10:20:00.000Z'),
      auditEvent('revocation.notified', '2026-11-27T10:21:00.000Z'),
    ])
    const view = asView(hcpWhatItSawView(AGENT, audit, await summaryOf(), NOW))
    expect(view.title).toEqual({ key: 'WhatItSawTitle', params: { name: 'My notes agent' } })
    expect(view.rows).toEqual([
      { key: 'WhatItSawTold', params: { time: '2026-11-27T10:21:00.000Z' } },
      { key: 'WhatItSawRevoked', params: { time: '2026-11-27T10:20:00.000Z' } },
      {
        key: 'WhatItSawRead',
        params: { category: 'health_context', purpose: 'taskExecution', time: '2026-11-27T10:10:00.000Z' },
      },
      {
        key: 'WhatItSawRead',
        params: { category: 'general_preferences', purpose: 'personalisation', time: '2026-11-27T10:05:00.000Z' },
      },
      {
        key: 'WhatItSawRead',
        params: { category: 'work_context', purpose: 'personalisation', time: '2026-11-27T10:05:00.000Z' },
      },
      { key: 'WhatItSawConnected', params: { time: '2026-11-27T10:00:00.000Z' } },
    ])
    expect(view.empty).toBeUndefined()
    expect(view.error).toBeUndefined()
    expect(view.more).toBeUndefined()
  })

  it('sorts by time, not by the order the log gave', async () => {
    const audit = await auditOf([
      readEvent('2026-11-27T10:10:00.000Z', ['work_context']),
      readEvent('2026-11-27T10:00:00.000Z', ['values_and_ethics']),
      readEvent('2026-11-27T10:20:00.000Z', ['location_context']),
    ])
    const view = asView(hcpWhatItSawView(AGENT, audit, await summaryOf(), NOW))
    expect(view.rows.map((r) => r.params.time)).toEqual([
      '2026-11-27T10:20:00.000Z',
      '2026-11-27T10:10:00.000Z',
      '2026-11-27T10:00:00.000Z',
    ])
  })

  it('shows only this agent’s grants: an event of another grant, or of none, is left out', async () => {
    const audit = await auditOf([
      readEvent('2026-11-27T10:05:00.000Z', ['work_context']),
      { ...readEvent('2026-11-27T10:06:00.000Z', ['health_context']), grantId: OTHER_GRANT },
      { ...auditEvent('grant.issued', '2026-11-27T10:07:00.000Z'), grantId: null },
    ])
    const view = asView(hcpWhatItSawView(AGENT, audit, await summaryOf(), NOW))
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0].params).toMatchObject({ category: 'work_context' })
  })

  it('control: the other grant’s event appears when it is one of the agent’s grants', async () => {
    const audit = await auditOf([
      { ...readEvent('2026-11-27T10:06:00.000Z', ['health_context']), grantId: OTHER_GRANT },
    ])
    const filtered = asView(hcpWhatItSawView(AGENT, audit, await summaryOf(), NOW))
    const both = asView(hcpWhatItSawView({ ...AGENT, grantIds: [GRANT, OTHER_GRANT] }, audit, await summaryOf(), NOW))
    expect(filtered.rows).toHaveLength(0)
    expect(both.rows).toHaveLength(1)
  })

  it('reads an unknown category as other, and a read with none as one other row', async () => {
    const audit = await auditOf([
      readEvent('2026-11-27T10:05:00.000Z', ['hobbies']),
      readEvent('2026-11-27T10:06:00.000Z', []),
    ])
    const view = asView(hcpWhatItSawView(AGENT, audit, await summaryOf(), NOW))
    expect(view.rows.map((r) => r.params)).toEqual([
      expect.objectContaining({ category: 'other' }),
      expect.objectContaining({ category: 'other' }),
    ])
  })

  it('an unknown purpose, or none, reads "for another purpose" and never shows its IRI', async () => {
    const iri = 'https://hcp.example/purposes/personalization'
    const audit = await auditOf([
      readEvent('2026-11-27T10:05:00.000Z', ['work_context'], iri),
      readEvent('2026-11-27T10:06:00.000Z', ['work_context'], null),
    ])
    const view = asView(hcpWhatItSawView(AGENT, audit, await summaryOf(), NOW))
    expect(view.rows.map((r) => r.key)).toEqual(['WhatItSawReadOther', 'WhatItSawReadOther'])
    for (const lang of ['en', 'fr', 'ptBr'] as const)
      for (const row of view.rows) {
        const text = hcpWhatItSawText(row, lang)
        expect(text).not.toContain('http')
        expect(text).not.toContain('{{')
      }
    expect(hcpWhatItSawText(view.rows[1], 'en')).toBe('Read your work for another purpose, 2026-11-27T10:05:00.000Z')
  })

  it('renders a read row in the plan §6 placement, in each language', async () => {
    const audit = await auditOf([readEvent('2026-11-27T10:05:00.000Z', ['general_preferences'])])
    const row = asView(hcpWhatItSawView(AGENT, audit, await summaryOf(), NOW)).rows[0]
    expect(hcpWhatItSawText(row, 'en')).toBe(
      'Read your general preferences to personalize its answers for you, 2026-11-27T10:05:00.000Z'
    )
    expect(hcpWhatItSawText(row, 'fr')).toBe(
      'A lu « préférences générales » pour personnaliser ses réponses pour vous, 2026-11-27T10:05:00.000Z'
    )
    expect(hcpWhatItSawText(row, 'ptBr')).toBe(
      'Leu "preferências gerais" para personalizar as respostas para você, 2026-11-27T10:05:00.000Z'
    )
  })

  describe('the summary line', () => {
    it('counts the reads, lists the categories’ labels and says until when', async () => {
      const view = asView(hcpWhatItSawView(AGENT, await auditOf([]), await summaryOf(), NOW))
      expect(view.summaryLine).toEqual({
        key: 'WhatItSawSummary',
        params: {
          n: 3,
          categories: ['general_preferences', 'work_context'],
          last: '2026-11-27T10:20:00.000Z',
          until: '2026-11-27T10:30:00.000Z',
        },
      })
      expect(hcpWhatItSawText(view.summaryLine!, 'en')).toBe(
        '3 reads of general preferences and work, last at 2026-11-27T10:20:00.000Z. It can use what it read until 2026-11-27T10:30:00.000Z.'
      )
    })

    it('is singular for one read, and drops "until" when it is null or already past', async () => {
      const one = asView(hcpWhatItSawView(AGENT, await auditOf([]), await summaryOf({ retrievals: 1 }), NOW))
      expect(one.summaryLine?.key).toBe('WhatItSawSummaryOne')
      const none = asView(hcpWhatItSawView(AGENT, await auditOf([]), await summaryOf({ usableUntil: null }), NOW))
      expect(none.summaryLine?.key).toBe('WhatItSawSummaryNoUntil')
      const later = new Date('2026-11-27T10:30:00.000Z')
      const past = asView(hcpWhatItSawView(AGENT, await auditOf([]), await summaryOf({ retrievals: 1 }), later))
      expect(past.summaryLine?.key).toBe('WhatItSawSummaryOneNoUntil')
    })

    it('merges categories that share a label', async () => {
      const summary = await summaryOf({ categories: ['hobbies', 'https://example.org/c/x', 'work_context'] })
      const view = asView(hcpWhatItSawView(AGENT, await auditOf([]), summary, NOW))
      expect(view.summaryLine?.params.categories).toEqual(['other', 'work_context'])
    })

    it('is absent with no summary entry, or with no retrievals', async () => {
      const zero = asView(hcpWhatItSawView(AGENT, await auditOf([]), await summaryOf({ retrievals: 0 }), NOW))
      expect(zero.summaryLine).toBeUndefined()
      const none = asView(hcpWhatItSawView(AGENT, await auditOf([]), { ok: true, value: undefined }, NOW))
      expect(none.summaryLine).toBeUndefined()
    })
  })

  it('is empty when the audit read answered and holds no read, even with grant events', async () => {
    const audit = await auditOf([auditEvent('grant.issued', '2026-11-27T10:00:00.000Z')])
    const view = asView(hcpWhatItSawView(AGENT, audit, await summaryOf({ retrievals: 0 }), NOW))
    expect(view.empty).toEqual({ key: 'WhatItSawEmpty' })
    expect(view.rows).toHaveLength(1)
  })

  it('says the list is cut at 500', async () => {
    const audit: HcpAuditRead = { events: [], cut: true }
    expect(asView(hcpWhatItSawView(AGENT, audit, await summaryOf(), NOW)).more).toEqual({ key: 'WhatItSawMore' })
  })

  it('on an unreachable read says so, keeps what the other read returned, and is not empty', async () => {
    const view = asView(hcpWhatItSawView(AGENT, await failingAudit('unreachable'), await summaryOf(), NOW))
    expect(view.error).toEqual({ key: 'WhatItSawUnreachable' })
    expect(view.summaryLine?.key).toBe('WhatItSawSummary')
    expect(view.empty).toBeUndefined()
    const audit = await auditOf([readEvent('2026-11-27T10:05:00.000Z', ['work_context'])])
    const other = asView(hcpWhatItSawView(AGENT, audit, await failingSummary('unreachable'), NOW))
    expect(other.error).toEqual({ key: 'WhatItSawUnreachable' })
    expect(other.rows).toHaveLength(1)
    expect(other.summaryLine).toBeUndefined()
  })

  it('a refusal has its own key, distinct from unreachable, and wins over it', async () => {
    const refused = asView(hcpWhatItSawView(AGENT, await failingAudit('refused'), await summaryOf(), NOW))
    expect(refused.error).toEqual({ key: 'WhatItSawRefused' })
    const both = asView(
      hcpWhatItSawView(AGENT, await failingAudit('unreachable'), await failingSummary('refused'), NOW)
    )
    expect(both.error).toEqual({ key: 'WhatItSawRefused' })
  })

  it('with the flags off gives off, and no copy', async () => {
    expect(hcpWhatItSawView(AGENT, await failingAudit('off'), await summaryOf(), NOW)).toEqual({ off: true })
    expect(hcpWhatItSawView(AGENT, await auditOf([]), await failingSummary('off'), NOW)).toEqual({ off: true })
  })
})
