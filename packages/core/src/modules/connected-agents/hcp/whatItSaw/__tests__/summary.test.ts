/**
 * `readHcpSummary` against a fake VTA port: it sends `hcp/disclosures/summary/0.1` `{ client }` and takes the
 * `clients[]` entry whose `client.id` is the client's VID, or none. The request and every answer validate against
 * the vendored schema.
 */
import { HCP_DISCLOSURES_SUMMARY } from '../../types'
import { HcpOffError } from '../../vtaPort'
import { readHcpSummary } from '../summary'
import { CLIENT, fakeVta, OTHER_CLIENT, refusal, summaryAnswer } from './fixtures/fakeVta'
import { expectValid, whatItSawSchemas } from './fixtures/whatItSawSchemas'

const S = whatItSawSchemas()[HCP_DISCLOSURES_SUMMARY]

const answering = (answer: unknown) => {
  expectValid(S.response, answer)
  return fakeVta(() => answer)
}

describe('readHcpSummary', () => {
  it('sends exactly { client }, valid against the schema, and returns the client’s entry', async () => {
    const vta = answering(summaryAnswer())
    const outcome = await readHcpSummary(vta.port, CLIENT)
    expect(vta.calls).toEqual([{ type: HCP_DISCLOSURES_SUMMARY, payload: { client: CLIENT } }])
    expectValid(S.request, vta.calls[0].payload)
    expect(outcome).toEqual({
      ok: true,
      value: {
        retrievals: 3,
        categories: ['general_preferences', 'work_context'],
        lastAt: '2026-11-27T10:20:00.000Z',
        usableUntil: '2026-11-27T10:30:00.000Z',
      },
    })
  })

  it('returns no entry when the answer holds only another client’s', async () => {
    const outcome = await readHcpSummary(answering(summaryAnswer({}, OTHER_CLIENT)).port, CLIENT)
    expect(outcome).toEqual({ ok: true, value: undefined })
  })

  it('control: picks the client’s entry out of several', async () => {
    const answer = {
      clients: [...summaryAnswer({}, OTHER_CLIENT).clients, ...summaryAnswer({ retrievals: 9 }).clients],
    }
    const outcome = await readHcpSummary(answering(answer).port, CLIENT)
    expect(outcome.ok && outcome.value?.retrievals).toBe(9)
  })

  it('reads a null usableUntil as null, and an entry of the wrong shape as none', async () => {
    const nullUntil = await readHcpSummary(answering(summaryAnswer({ usableUntil: null })).port, CLIENT)
    expect(nullUntil.ok && nullUntil.value?.usableUntil).toBeNull()
    const broken = await readHcpSummary(fakeVta(() => summaryAnswer({ retrievals: 'three' })).port, CLIENT)
    expect(broken).toEqual({ ok: true, value: undefined })
    const noList = await readHcpSummary(fakeVta(() => ({})).port, CLIENT)
    expect(noList).toEqual({ ok: true, value: undefined })
  })

  it('keeps a refusal, an unreachable VTA and the flags off apart', async () => {
    const throwing = (error: Error) =>
      fakeVta(() => {
        throw error
      }).port
    expect(await readHcpSummary(throwing(refusal('notFound')), CLIENT)).toEqual({ ok: false, refused: 'notFound' })
    expect(await readHcpSummary(throwing(new Error('timeout')), CLIENT)).toEqual({ ok: false, unreachable: true })
    expect(await readHcpSummary(throwing(new HcpOffError()), CLIENT)).toEqual({ ok: false, off: true })
  })
})
