/**
 * The trigger-link reader and service selection for the shared-connect flow
 * (relationship over TSP, plan WP1 and WP2): a `did:peer` contact behind a
 * developer flag, and the TSP / DIDComm service spellings.
 */
import { setSharedConnectEnabled, setSharedConnectLabelEnabled } from '../module/sharedConnectFlag'
import {
  endpointHost,
  KEYRING_TRIGGER_CONFIG,
  readTrigger,
  sanitizeLabel,
  SHARED_CONNECT_LABEL_MAX,
  SHARED_CONNECT_MAX_LIFETIME_SECONDS,
  SHARED_CONNECT_SELECTION,
  selectService,
  triggerAction,
} from '../module/triggerLink'

import {
  ENCOUNTER_ID,
  KEYRING_STYLE_DID,
  MEDIATOR_DID,
  NOW,
  peer2,
  REFERENCE_STYLE_DID,
  sharedConnectLink,
} from './fixtures/sharedConnectFixtures'

const read = (link: string) => readTrigger(link, { channel: 'scan', now: NOW })

afterEach(() => {
  setSharedConnectEnabled(false)
  setSharedConnectLabelEnabled(false)
})

describe('with the developer flag off', () => {
  it('cannot read a did:peer contact: the link is answered "update", as any unknown flow', () => {
    expect(read(sharedConnectLink())).toEqual({ outcome: 'reject', reason: 'unsupported-vid', ui: 'update' })
  })

  it('leaves the shipped config untouched', () => {
    expect(KEYRING_TRIGGER_CONFIG.flows?.map((f) => f.flow)).toEqual(['sign-in', 'vta-claim'])
  })

  it('still refuses a did:peer contact for the flows it already knew, with the same words as before', () => {
    const link = `https://link.trustoverip.org/t#_from=${KEYRING_STYLE_DID}&_id=${ENCOUNTER_ID}&_exp=${NOW + 60}&_type=/vti/flow/sign-in/0.1`
    expect(read(link)).toEqual({ outcome: 'reject', reason: 'unsupported-vid', ui: 'update' })
  })
})

describe('with the developer flag on', () => {
  beforeEach(() => setSharedConnectEnabled(true))

  it('accepts a numalgo-2 contact and returns the flow, the inviter and the challenge', () => {
    const result = read(sharedConnectLink())
    expect(result).toMatchObject({
      outcome: 'accept',
      from: KEYRING_STYLE_DID,
      id: ENCOUNTER_ID,
      exp: NOW + 600,
      flow: 'shared-connect',
      task: { major: 0, minor: 1 },
    })
    expect(triggerAction(result)).toMatchObject({ kind: 'proceed', flow: 'shared-connect' })
  })

  it('accepts a long-form numalgo-4 contact', () => {
    const long4 = `did:peer:4zQmWvJ8x3Pq1gYk2bN5aHcLrT9uZs6dEoXfV7mC4iKjA1:z${'2'.repeat(60)}`
    expect(read(sharedConnectLink({ from: long4 }))).toMatchObject({ outcome: 'accept', from: long4 })
  })

  it.each([
    ['numalgo 0', 'did:peer:0z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK', 'unsupported-vid', 'update'],
    ['numalgo 1', 'did:peer:1zQmZMygzYqNwU6Uhmewx5Xepf2VLp5S4HLSwwgf2aiKZuwa', 'unsupported-vid', 'update'],
    ['short-form numalgo 4', 'did:peer:4zQmWvJ8x3Pq1gYk2bN5aHcLrT9uZs6dEoXfV7mC4iKjA1', 'unsupported-vid', 'update'],
    ['a numalgo that does not exist', 'did:peer:7.Vz6Mkabc', 'bad-from', 'invalid'],
    ['numalgo 2 with no elements', 'did:peer:2', 'bad-from', 'invalid'],
    ['numalgo 2 with an unknown purpose letter', 'did:peer:2.Qz6Mkabc', 'bad-from', 'invalid'],
  ])('refuses %s', (_, from, reason, ui) => {
    expect(read(sharedConnectLink({ from }))).toEqual({ outcome: 'reject', reason, ui })
  })

  it('refuses a did:web contact for this flow', () => {
    expect(read(sharedConnectLink({ from: 'did:web:example.org' }))).toMatchObject({
      outcome: 'reject',
      reason: 'from-not-allowed',
    })
  })

  it('requires an expiry', () => {
    expect(read(sharedConnectLink({ exp: null }))).toMatchObject({ outcome: 'reject', reason: 'missing-exp' })
  })

  it('refuses an expired code, allowing the phone clock its skew', () => {
    expect(read(sharedConnectLink({ exp: NOW - 61 }))).toMatchObject({
      outcome: 'reject',
      reason: 'expired',
      ui: 'expired',
    })
    expect(read(sharedConnectLink({ exp: NOW - 30 }))).toMatchObject({ outcome: 'accept' })
  })

  it('refuses an expiry further out than seven days', () => {
    expect(read(sharedConnectLink({ exp: NOW + SHARED_CONNECT_MAX_LIFETIME_SECONDS + 120 }))).toEqual({
      outcome: 'reject',
      reason: 'exp-too-far',
      ui: 'invalid',
    })
    expect(read(sharedConnectLink({ exp: NOW + SHARED_CONNECT_MAX_LIFETIME_SECONDS }))).toMatchObject({
      outcome: 'accept',
    })
  })

  it('refuses a link over the flow budget of 1,000 characters, though the reader would take 1,536', () => {
    const big = peer2([{ t: 'dm', s: 'x'.repeat(900) }])
    const link = sharedConnectLink({ from: big })
    expect([...link].length).toBeGreaterThan(1000)
    expect([...link].length).toBeLessThan(1536)
    expect(read(link)).toEqual({ outcome: 'reject', reason: 'too-long', ui: 'invalid' })
  })

  it('refuses a challenge that is not a 16-byte handle', () => {
    expect(read(sharedConnectLink({ id: 'short' }))).toMatchObject({ outcome: 'reject', reason: 'bad-id' })
  })

  it('refuses an unknown version of the flow', () => {
    expect(read(sharedConnectLink({ type: '/vti/flow/shared-connect/1.0' }))).toMatchObject({
      outcome: 'reject',
      reason: 'unsupported-version',
    })
  })

  it('does not change what the other flows accept: a did:peer sign-in is refused for its method', () => {
    const link = `https://link.trustoverip.org/t#_from=${KEYRING_STYLE_DID}&_id=${ENCOUNTER_ID}&_exp=${NOW + 60}&_type=/vti/flow/sign-in/0.1`
    expect(read(link)).toMatchObject({ outcome: 'reject', reason: 'from-not-allowed' })
  })
})

describe('_label', () => {
  beforeEach(() => setSharedConnectEnabled(true))

  it('is not read while the label flag is off: it is an ignored name and no label is returned', () => {
    const result = read(sharedConnectLink({ label: 'Ada' }))
    expect(result).toMatchObject({ outcome: 'accept' })
    expect(result).not.toHaveProperty('label')
    expect((result as { ignored: string[] }).ignored).toEqual(['fragment._label'])
  })

  it('is returned sanitised while the label flag is on', () => {
    setSharedConnectLabelEnabled(true)
    expect(read(sharedConnectLink({ label: 'Ada  Lovelace' }))).toMatchObject({ label: 'Ada Lovelace' })
  })

  it('is refused when repeated', () => {
    setSharedConnectLabelEnabled(true)
    const link = `${sharedConnectLink({ label: 'a' })}&_label=b`
    expect(read(link)).toMatchObject({ outcome: 'reject', reason: 'repeated-param' })
  })

  it('is left out when nothing printable remains', () => {
    setSharedConnectLabelEnabled(true)
    expect(read(sharedConnectLink({ label: '‮​' }))).not.toHaveProperty('label')
  })

  // Labels written to deceive, percent-encoded in the link as a sender would: what reaches
  // the screen is one plain line, with nothing that reorders or hides characters.
  it.each([
    ['a right-to-left override that would show "Ana bank" reversed', 'Ana \u202Eknab', 'Ana knab'],
    ['a newline faking a second line', 'Ana\nYour bank (verified)', 'Ana Your bank (verified)'],
    ['a line separator, dropped', 'Ana\u2028Support team', 'AnaSupport team'],
    ['an isolate hiding a reordered run', 'Ana \u2067Bank\u2069', 'Ana Bank'],
    ['zero-width characters splitting a word', 'B\u200Ba\u200Bnk', 'Bank'],
  ])('shows %s as one plain line', (_, raw, shown) => {
    setSharedConnectLabelEnabled(true)
    const result = read(sharedConnectLink({ label: raw })) as { label?: string }
    expect(result.label).toBe(shown)
    // eslint-disable-next-line no-control-regex
    expect(result.label).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069]/)
  })

  it('cuts a label longer than 64 characters rather than show it whole', () => {
    setSharedConnectLabelEnabled(true)
    const result = read(sharedConnectLink({ label: `Ana${' '.repeat(3)}${'x'.repeat(80)}` })) as { label?: string }
    expect([...(result.label as string)]).toHaveLength(SHARED_CONNECT_LABEL_MAX)
  })

  it('stays off when the flow itself is off, whatever the label flag says', () => {
    setSharedConnectEnabled(false)
    setSharedConnectLabelEnabled(true)
    expect(read(sharedConnectLink({ label: 'Ada' }))).toMatchObject({ reason: 'unsupported-vid', ui: 'update' })
  })
})

describe('sanitizeLabel', () => {
  it.each([
    ['plain text', 'Ada Lovelace', 'Ada Lovelace'],
    ['control characters', 'A\u0000d\u0007a\u007f', 'Ada'],
    ['bidirectional overrides', 'abc‮def⁦', 'abcdef'],
    ['zero-width characters', 'A​d‍a﻿', 'Ada'],
    ['tabs and newlines become spaces', 'Ada\tLove\nlace', 'Ada Love lace'],
    ['no-break and ideographic spaces', 'Ada 　Lovelace', 'Ada Lovelace'],
    ['edge whitespace', '   Ada   ', 'Ada'],
    ['private use and tag characters', 'Ada\u{e0041}', 'Ada'],
    ['combining forms (normalised)', 'Adéla', 'Adéla'],
    ['an emoji', 'Ada 🙂', 'Ada 🙂'],
  ])('%s', (_, input, expected) => {
    expect(sanitizeLabel(input)).toBe(expected)
  })

  it('returns undefined when nothing is left', () => {
    expect(sanitizeLabel('')).toBeUndefined()
    expect(sanitizeLabel('​ ‮')).toBeUndefined()
  })

  it('cuts to the limit in whole code points', () => {
    const cut = sanitizeLabel('🙂'.repeat(200)) as string
    expect([...cut]).toHaveLength(SHARED_CONNECT_LABEL_MAX)
  })
})

describe('choosing the carriage from the inviter document', () => {
  const doc = (services: Record<string, unknown>[]) => ({ verified: true, services: services as never })

  it("reads Keyring's spelling, TSPTransport with a mediator DID, and prefers it to DIDComm", () => {
    const result = selectService(
      doc([
        { id: '#didcomm', type: 'DIDCommMessaging', serviceEndpoint: { uri: MEDIATOR_DID, accept: ['didcomm/v2'] } },
        { id: '#tsp', type: 'TSPTransport', serviceEndpoint: MEDIATOR_DID },
      ]),
      SHARED_CONNECT_SELECTION
    )
    expect(result).toEqual({
      outcome: 'select',
      binding: 'tsp',
      endpoint: MEDIATOR_DID,
      source: 'did-document',
      sent: false,
    })
  })

  it('reads the TSP reference spelling, tsp with a {uri} object, ', () => {
    expect(
      selectService(
        doc([{ type: 'tsp', serviceEndpoint: { uri: 'https://relay.example.org/tsp' } }]),
        SHARED_CONNECT_SELECTION
      )
    ).toEqual({
      outcome: 'select',
      binding: 'tsp',
      endpoint: 'https://relay.example.org/tsp',
      source: 'did-document',
      sent: false,
    })
  })

  it('reads an array of {uri} endpoints, the usual did:peer:2 form, taking the first usable one', () => {
    const result = selectService(
      doc([
        {
          type: 'tsp',
          serviceEndpoint: [{ uri: 'http://insecure.example.org' }, { uri: 'https://relay.example.org' }],
        },
      ]),
      SHARED_CONNECT_SELECTION
    )
    expect(result).toMatchObject({ outcome: 'select', binding: 'tsp', endpoint: 'https://relay.example.org' })
  })

  it('falls back to DIDComm when there is no TSP service, including numalgo 2\'s "dm" abbreviation', () => {
    expect(
      selectService(doc([{ type: 'dm', serviceEndpoint: { uri: MEDIATOR_DID } }]), SHARED_CONNECT_SELECTION)
    ).toMatchObject({ outcome: 'select', binding: 'didcomm', endpoint: MEDIATOR_DID })
  })

  it('matches a service whose type is an array', () => {
    expect(
      selectService(doc([{ type: ['TSPTransport'], serviceEndpoint: MEDIATOR_DID }]), SHARED_CONNECT_SELECTION)
    ).toMatchObject({ binding: 'tsp' })
  })

  it('flipping the preference flips the choice', () => {
    const both = doc([
      { type: 'DIDCommMessaging', serviceEndpoint: MEDIATOR_DID },
      { type: 'TSPTransport', serviceEndpoint: MEDIATOR_DID },
    ])
    const flipped = {
      ...SHARED_CONNECT_SELECTION,
      consumer: { supported: ['tsp', 'didcomm'], preference: ['didcomm', 'tsp'] },
    }
    expect(selectService(both, flipped)).toMatchObject({ binding: 'didcomm' })
  })

  it('is no-common-transport when no service is usable', () => {
    expect(
      selectService(
        doc([
          { type: 'TSPTransport', serviceEndpoint: 'ftp://nope' },
          { type: 'Other', serviceEndpoint: MEDIATOR_DID },
        ]),
        SHARED_CONNECT_SELECTION
      )
    ).toEqual({ outcome: 'no-common-transport', sent: false, ui: 'unreachable' })
  })

  it('refuses an unverified document', () => {
    expect(selectService({ verified: false, services: [] }, SHARED_CONNECT_SELECTION)).toMatchObject({
      outcome: 'reject',
    })
  })

  it('keeps the sign-in behaviour: the existing selection still reads TrustTaskHTTPS only', () => {
    expect(
      selectService({
        verified: true,
        services: [{ type: 'TrustTaskHTTPS', serviceEndpoint: 'https://vtc.example.org/tt' } as never],
      })
    ).toMatchObject({ binding: 'https', endpoint: 'https://vtc.example.org/tt' })
  })
})

describe('endpointHost', () => {
  it('is the host of an https URL and nothing for a mediator DID', () => {
    expect(endpointHost('https://Relay.Example.org/path')).toBe('relay.example.org')
    expect(endpointHost(MEDIATOR_DID)).toBeUndefined()
    expect(REFERENCE_STYLE_DID).toContain('did:peer:2')
  })
})
