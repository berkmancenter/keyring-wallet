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

  it('knows an agent claim but does not carry it through yet: update', () => {
    const result = readTrigger(link('/vti/flow/vta-claim/0.1'), { now })
    expect(result).toMatchObject({ outcome: 'accept', flow: 'vta-claim' })
    expect(triggerAction(result)).toEqual({ kind: 'say', ui: 'update' })
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

  it('implements only sign-in', () => {
    expect(KEYRING_TRIGGER_CONFIG.flows?.filter((f) => f.implemented).map((f) => f.flow)).toEqual(['sign-in'])
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
