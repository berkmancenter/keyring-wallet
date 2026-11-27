/**
 * The vendored `hcp/*` schemas (suite 4e2dd42fa) resolve, and every payload part 3 builds validates against them:
 * `entries/create` (the brief's exact object), `grants/revoke` `{ grantId }` and `disclosures/summary`
 * `{ client }`, with the answers a fake VTA gives. Each has a control in which one required member is removed.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { HCP_DISCLOSURES_SUMMARY, HCP_ENTRIES_CREATE, HCP_GRANTS_REVOKE } from '../types'
import { expectValid, hcpSchemas, HCP_PAYLOAD_FILES, HCP_SUITE_DIR, readHcpSchema } from './fixtures/hcpSchemas'

const S = hcpSchemas()
const MANAGER = 'did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp'
const CLIENT = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const GRANT = 'urn:uuid:3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b'

/** The payload part 3's `hcpCreatePayload` returns (brief, "A new memory (C3)"). */
const createPayload = () => ({
  schema: 'https://hcp.example/spec/entry/2.0',
  subject: { id: MANAGER },
  content: {
    profile: 'https://hcp.example/spec/profiles/general-context/2.0',
    value: 'I prefer replies in short sentences.',
    language: 'en',
  },
  classification: { categories: ['general_preferences'] },
  assertion: { declarationType: 'person-declared' },
  record: {
    provenance: { source: 'person-input', assertedBy: { id: MANAGER }, assertedAt: '2026-11-27T10:00:00.000Z' },
  },
})

const summaryResponse = (notification: 'delivered' | 'abandoned' | 'none', usableUntil: string | null) => ({
  clients: [
    {
      client: { id: CLIENT, name: 'hcp-demo', operator: { id: 'did:web:example.org', name: 'Example' } },
      grants: [{ grantId: GRANT, status: 'revoked' }],
      categories: ['general_preferences'],
      purposes: ['https://hcp.example/purposes/personalization'],
      entries: 1,
      retrievals: 2,
      firstAt: '2026-11-27T10:05:00.000Z',
      lastAt: '2026-11-27T10:06:00.000Z',
      usableUntil,
      notification,
    },
  ],
})

const without = (value: Record<string, unknown>, member: string) => {
  const copy = { ...value }
  delete copy[member]
  return copy
}

describe('the vendored hcp suite', () => {
  it('holds the three payload schemas at the type URIs Keyring sends', () => {
    for (const [type, file] of Object.entries(HCP_PAYLOAD_FILES)) expect(readHcpSchema(file).$id).toBe(type)
  })

  it('has its pin recorded', () => {
    expect(readFileSync(join(HCP_SUITE_DIR, 'SUITE_COMMIT.sha'), 'utf8')).toBe(
      '4e2dd42fae13452fe30f0e077f359110bb2ad414\n'
    )
  })
})

describe('hcp/entries/create/0.1', () => {
  it('takes the person-declared memory part 3 builds, without accessToken', () => {
    expectValid(S[HCP_ENTRIES_CREATE].request, createPayload())
  })

  it('control: refuses it with one required member removed', () => {
    for (const member of ['schema', 'subject', 'content', 'classification', 'assertion', 'record'])
      expect(S[HCP_ENTRIES_CREATE].request(without(createPayload(), member))).toBe(false)
  })
})

describe('hcp/grants/revoke/0.1', () => {
  it('takes { grantId }, and answers with the empty object', () => {
    expectValid(S[HCP_GRANTS_REVOKE].request, { grantId: GRANT })
    expectValid(S[HCP_GRANTS_REVOKE].response, {})
  })

  it('control: refuses it with grantId removed, or not a urn:uuid', () => {
    expect(S[HCP_GRANTS_REVOKE].request(without({ grantId: GRANT }, 'grantId'))).toBe(false)
    expect(S[HCP_GRANTS_REVOKE].request({ grantId: '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b' })).toBe(false)
  })
})

describe('hcp/disclosures/summary/0.1', () => {
  it('takes { client }, and each notification the poll reads', () => {
    expectValid(S[HCP_DISCLOSURES_SUMMARY].request, { client: CLIENT })
    expectValid(S[HCP_DISCLOSURES_SUMMARY].response, summaryResponse('delivered', '2026-11-27T10:07:00.000Z'))
    expectValid(S[HCP_DISCLOSURES_SUMMARY].response, summaryResponse('abandoned', '2026-11-27T10:21:00.000Z'))
    expectValid(S[HCP_DISCLOSURES_SUMMARY].response, summaryResponse('none', null))
    expectValid(S[HCP_DISCLOSURES_SUMMARY].response, { clients: [] })
  })

  // The request has no required member (every filter is optional), so its control is the response's: `clients`
  // removed, and a client summary with `notification` removed. An empty `client` is refused too.
  it('control: refuses the answer with a required member removed, and an empty client', () => {
    const response = summaryResponse('delivered', '2026-11-27T10:07:00.000Z')
    expect(S[HCP_DISCLOSURES_SUMMARY].response(without(response, 'clients'))).toBe(false)
    expect(S[HCP_DISCLOSURES_SUMMARY].response({ clients: [without(response.clients[0], 'notification')] })).toBe(false)
    expect(S[HCP_DISCLOSURES_SUMMARY].request({ client: '' })).toBe(false)
  })
})
