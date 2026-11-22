/**
 * The trigger-link reader against Keyring's conformance vectors.
 *
 * `fixtures/trigger-link-vectors.json` is keyring-wallet
 * `docs/specs/keyring-qr-and-links.vectors.json` at commit f49f6838
 * (f49f68383a3974aa1f5da00dc0259c44d4d179dd, branch
 * docs/vta-pool-claim-evaluation), the file the reference reader
 * (`tsp-reference/ref-21-trigger-link-reader`) runs. Copied with its content
 * unchanged; prettier re-indented it, which the PR formatter check requires.
 * Update it by copying a newer revision whole, never by editing a vector.
 */
import file from './fixtures/trigger-link-vectors.json'
import {
  KEYRING_TRIGGER_CONFIG,
  TRIGGER_LINK_SIGN_IN,
  TRIGGER_UI_MESSAGES,
  readTrigger,
  selectService,
  SHARED_CONNECT_SELECTION,
  serviceEndpointOfType,
  triggerAction,
  triggerLinkSignInEnabled,
  type SelectionConfig,
  type SelectionDocument,
  type TriggerChannel,
  type TriggerConfig,
} from '../module/triggerLink'

const config = file.config as unknown as TriggerConfig
const selection = file.config.selection as SelectionConfig

describe('reading a trigger link: every conformance vector', () => {
  it('has the vectors it runs', () => {
    expect(file.vectors).toHaveLength(161)
    expect(file.selectionVectors).toHaveLength(18)
  })

  it.each(file.vectors.map((v) => [v.id, v] as const))('%s', (_, vector) => {
    expect(readTrigger(vector.input, { channel: vector.channel as TriggerChannel, config })).toEqual(vector.expect)
  })
})

describe('choosing how to reach the sender: every selection vector', () => {
  // Including the endpoint with userinfo, which #58 would take and Keyring's
  // spec refuses, as the link's own authority already does.
  it.each(file.selectionVectors.map((v) => [v.id, v] as const))('%s', (_, vector) => {
    expect(selectService(vector.input as SelectionDocument, selection)).toEqual(vector.expect)
  })
})

describe("the words each outcome shows, from the vectors' own table", () => {
  it.each(['update', 'expired', 'unreachable', 'invalid'] as const)('%s', (ui) => {
    expect(TRIGGER_UI_MESSAGES[ui]).toBe(file.config.ui[ui])
  })
})

describe("Keyring's own reading", () => {
  const now = 1791460800
  const link = (type: string, exp = now + 120) =>
    `https://link.trustoverip.org/t#_from=did:webvh:QmCommScid:portal.community.example&_id=q3Vn7Zk2Xo9Rt1LwPb4HdA&_exp=${exp}&_type=${type}`

  it('carries a sign-in through', () => {
    const action = triggerAction(readTrigger(link('/vti/flow/sign-in/0.1'), { now }))
    expect(action).toMatchObject({ kind: 'proceed', flow: 'sign-in', trigger: { id: 'q3Vn7Zk2Xo9Rt1LwPb4HdA' } })
  })

  // An agent host's one-scan setup (vtaClaim.ts): carried through since 241.
  it('carries an agent claim through', () => {
    const result = readTrigger(link('/vti/flow/vta-claim/0.1'), { now })
    expect(result).toMatchObject({ outcome: 'accept', flow: 'vta-claim' })
    expect(triggerAction(result)).toMatchObject({ kind: 'proceed', flow: 'vta-claim', trigger: { flow: 'vta-claim' } })
  })

  it('says update for a link that names no flow', () => {
    const unhinted = link('').replace('&_type=', '')
    expect(triggerAction(readTrigger(unhinted, { now }))).toEqual({ kind: 'say', ui: 'update' })
  })

  it('reads its own keyring: scheme', () => {
    const own = link('/vti/flow/sign-in/0.1').replace('https://', 'keyring://')
    expect(triggerAction(readTrigger(own, { now }))).toMatchObject({ kind: 'proceed' })
  })

  it('says a sign-in past its expiry has expired', () => {
    expect(triggerAction(readTrigger(link('/vti/flow/sign-in/0.1', now - 61), { now }))).toEqual({
      kind: 'say',
      ui: 'expired',
    })
  })

  it('never puts the text it read into a rejection', () => {
    const secret = link('/vti/flow/sign-in/0.1').replace('_id=q3Vn7Zk2Xo9Rt1LwPb4HdA', '_id=short')
    const result = readTrigger(secret, { now })
    expect(result).toEqual({ outcome: 'reject', reason: 'bad-id', ui: 'invalid' })
    expect(JSON.stringify(result)).not.toContain('portal.community.example')
  })

  // The SEDI VTC's member sign-in code names the community by its did:webs (report 2FHS-ZNMY: it said "update").
  describe('a did:webs contact (the SEDI VTC)', () => {
    const webs = 'did:webs:webvh.storm.ws:sedi-vtc:EN7G2PZkzjb3TTWBrG3-oE5-A71XwLeX4et38jeh0C-a'
    const from = (contact: string, type: string) =>
      `https://link.trustoverip.org/t#_from=${encodeURIComponent(contact)}&_id=q3Vn7Zk2Xo9Rt1LwPb4HdA&_exp=${now + 120}&_type=${type}`

    it('carries a did:webs sign-in through, naming the community', () => {
      const result = readTrigger(from(webs, '/vti/flow/sign-in/0.1'), { now })
      expect(result).toMatchObject({ outcome: 'accept', flow: 'sign-in', from: webs })
      expect(triggerAction(result)).toMatchObject({ kind: 'proceed', flow: 'sign-in', trigger: { from: webs } })
    })

    it('takes did:webs for sign-in only: an agent claim from one is not allowed', () => {
      expect(readTrigger(from(webs, '/vti/flow/vta-claim/0.1'), { now })).toMatchObject({
        outcome: 'reject',
        reason: 'from-not-allowed',
      })
      const flows = Object.fromEntries((KEYRING_TRIGGER_CONFIG.flows ?? []).map((f) => [f.flow, f.allowedVidTypes]))
      expect(flows).toEqual({ 'sign-in': ['did:webvh', 'did:web', 'did:webs'], 'vta-claim': ['did:webvh', 'did:web'] })
    })

    it('a malformed did:webs (no AID, or a short one) is bad-from', () => {
      for (const bad of [
        'did:webs:webvh.storm.ws',
        'did:webs:webvh.storm.ws:sedi-vtc:EN7G2PZk',
        'did:webs:host:a!b:' + 'E'.repeat(44),
      ]) {
        expect(readTrigger(from(bad, '/vti/flow/sign-in/0.1'), { now })).toMatchObject({ outcome: 'reject' })
      }
      expect(readTrigger(from('did:webs:webvh.storm.ws', '/vti/flow/sign-in/0.1'), { now })).toMatchObject({
        reason: 'bad-from',
      })
    })

    it('control: did:webvh and did:web sign-ins and agent claims read exactly as before', () => {
      const webvh = 'did:webvh:QmCommScid:portal.community.example'
      for (const contact of [webvh, 'did:web:portal.community.example', 'did:web:localhost%3A3000:vtc:one']) {
        expect(readTrigger(from(contact, '/vti/flow/sign-in/0.1'), { now })).toMatchObject({
          outcome: 'accept',
          flow: 'sign-in',
          from: contact,
        })
        expect(readTrigger(from(contact, '/vti/flow/vta-claim/0.1'), { now })).toMatchObject({
          outcome: 'accept',
          flow: 'vta-claim',
        })
      }
      // Methods still not read: as before.
      for (const contact of ['did:keri:EN7G2PZkzjb3TTWBrG3-oE5-A71XwLeX4et38jeh0C-a', 'did:example:123']) {
        expect(readTrigger(from(contact, '/vti/flow/sign-in/0.1'), { now })).toMatchObject({
          outcome: 'reject',
          reason: 'unsupported-vid',
        })
      }
      expect(readTrigger(from('did:key:z6MkswwZ', '/vti/flow/sign-in/0.1'), { now })).toMatchObject({
        outcome: 'reject',
        reason: 'from-not-allowed',
      })
    })
  })

  it('implements sign-in and the agent claim', () => {
    expect(KEYRING_TRIGGER_CONFIG.flows?.filter((f) => f.implemented).map((f) => f.flow)).toEqual([
      'sign-in',
      'vta-claim',
    ])
  })

  it('is switched on', () => {
    expect(TRIGGER_LINK_SIGN_IN).toBe(true)
    expect(triggerLinkSignInEnabled()).toBe(true)
  })
})

describe('an endpoint by service type, as sign-in takes TrustTaskHTTPS and SignInPortal', () => {
  const doc = {
    service: [
      { id: '#a', type: 'TrustTaskHTTPS', serviceEndpoint: 'http://api.example.com/v1' },
      { id: '#b', type: 'TrustTaskHTTPS', serviceEndpoint: 'https://u@api.example.com/v1' },
      { id: '#c', type: 'TrustTaskHTTPS', serviceEndpoint: { uri: 'https://api.example.com/v1' } },
      { id: '#portal', type: 'SignInPortal', serviceEndpoint: 'https://portal.example.com/sign-in' },
    ],
  }

  it('takes the first usable one of the type, in document order', () => {
    expect(serviceEndpointOfType(doc, 'TrustTaskHTTPS')).toBe('https://api.example.com/v1')
    expect(serviceEndpointOfType(doc, 'SignInPortal')).toBe('https://portal.example.com/sign-in')
  })

  it('finds nothing for a type the document does not publish', () => {
    expect(serviceEndpointOfType(doc, 'DIDCommMessaging')).toBeUndefined()
  })
})

describe('an array endpoint, read only where shared-connect selects a transport', () => {
  const ARRAY_DOC = {
    service: [{ type: 'TrustTaskHTTPS', serviceEndpoint: ['https://community.example.org/tt'] }],
  }

  it('reads as no endpoint for serviceEndpointOfType: sign-in, the rooms door and the polls ballot box are unchanged', () => {
    expect(serviceEndpointOfType(ARRAY_DOC, 'TrustTaskHTTPS')).toBeUndefined()
    expect(
      serviceEndpointOfType(
        { service: [{ type: 'SignInPortal', serviceEndpoint: [{ uri: 'https://p.example.org' }] }] },
        'SignInPortal'
      )
    ).toBeUndefined()
    // A plain string and a {uri} endpoint still read as before.
    expect(
      serviceEndpointOfType(
        { service: [{ type: 'TrustTaskHTTPS', serviceEndpoint: 'https://community.example.org/tt' }] },
        'TrustTaskHTTPS'
      )
    ).toBe('https://community.example.org/tt')
    expect(
      serviceEndpointOfType(
        { service: [{ type: 'TrustTaskHTTPS', serviceEndpoint: { uri: 'https://c.example.org/tt' } }] },
        'TrustTaskHTTPS'
      )
    ).toBe('https://c.example.org/tt')
  })

  it("is read by selectService, entry by entry, skipping one that isn't usable", () => {
    const document: SelectionDocument = {
      verified: true,
      services: [
        { type: 'TSPTransport', serviceEndpoint: [{ uri: 'http://relay.example.org' }, 'did:web:relay.example.org'] },
      ],
    }
    expect(selectService(document, SHARED_CONNECT_SELECTION)).toMatchObject({
      outcome: 'select',
      binding: 'tsp',
      endpoint: 'did:web:relay.example.org',
    })
  })
})
