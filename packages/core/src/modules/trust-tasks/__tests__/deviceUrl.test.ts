/**
 * Trigger links under the phone's URL, not jest's.
 *
 * jest runs on Node, whose `URL` is WHATWG. The app runs React Native's own `URL` class (0.81,
 * Libraries/Blob/URL.js), which appends `/` to a URL with no `?` or `#`, so the `pathname` of
 * `https://link.trustoverip.org/vti/flow/shared-connect` is `/vti/flow/shared-connect/` on a phone. The WP9 live run
 * (2026-11-07, Android emulator) read a code Keyring showed: its link carried `_type=/vti/flow/shared-connect//0.1`,
 * which Keyring's own reader then takes as an unknown flow ("update the app"). Every test here passed under Node's URL
 * before the fix; these run the same code with React Native's class installed as the global, as the app has it.
 */
import file from './fixtures/trigger-link-vectors.json'
import { buildSharedConnectLink } from '../module/sharedConnectInvite'
import { setSharedConnectEnabled } from '../module/sharedConnectFlag'
import {
  isCandidateEndpoint,
  readTrigger,
  selectService,
  SHARED_CONNECT_FLOW,
  SIGN_IN_FLOW,
  uriHostAndPath,
  VTA_CLAIM_FLOW,
  type SelectionConfig,
  type SelectionDocument,
  type TriggerChannel,
  type TriggerConfig,
} from '../module/triggerLink'

// The class the app gets as `URL` on a phone.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { URL: DeviceURL } = jest.requireActual('react-native/Libraries/Blob/URL')

// core's tsconfig has no DOM lib, so `URL` is not typed as a property of globalThis.
const scope = globalThis as unknown as { URL: typeof URL }
const NodeURL = scope.URL
const onDevice = () => {
  scope.URL = DeviceURL as typeof URL
}
afterEach(() => {
  scope.URL = NodeURL
  setSharedConnectEnabled(false)
})

const ME =
  'did:peer:2.Ez6LSqnPsQ1h1ZeJL4T5UojRfbiUMVTqnJ8M3yY9HHriE5tDx.Vz6MknXiLdXEHE9n8JM8x1dmkqucrVVZrYFFZFEoFa1He4FEs'
const ENACTMENT = 'OQyt0-RiESmbfGEqFQ0bpw'
const EXP = 1794053710

describe("the phone's URL (the control: without it nothing here could fail)", () => {
  test('React Native gives a path a trailing slash that Node does not', () => {
    const flow = 'https://link.trustoverip.org/vti/flow/shared-connect'
    expect(new NodeURL(flow).pathname).toBe('/vti/flow/shared-connect')
    expect(new DeviceURL(flow).pathname).toBe('/vti/flow/shared-connect/')
  })
})

describe('the code Keyring shows, built on a phone', () => {
  test.each([
    ['Node', () => undefined],
    ['React Native', onDevice],
  ])('under %s, `_type` is exactly /vti/flow/shared-connect/0.1', (_, install) => {
    install()
    expect(buildSharedConnectLink({ from: ME, id: ENACTMENT, exp: EXP })).toBe(
      `https://link.trustoverip.org/t#_from=${ME}&_id=${ENACTMENT}&_exp=${EXP}&_type=/vti/flow/shared-connect/0.1`
    )
  })

  test("and Keyring's own reader, also on the phone, takes it as shared-connect", () => {
    onDevice()
    setSharedConnectEnabled(true)
    const read = readTrigger(buildSharedConnectLink({ from: ME, id: ENACTMENT, exp: EXP }), {
      channel: 'scan',
      now: EXP - 300,
    })
    expect(read).toMatchObject({ outcome: 'accept', flow: 'shared-connect', from: ME, id: ENACTMENT, exp: EXP })
  })
})

describe('reading a trigger link on a phone: every conformance vector', () => {
  const config = file.config as unknown as TriggerConfig
  it.each(file.vectors.map((v) => [v.id, v] as const))('%s', (_, vector) => {
    onDevice()
    expect(readTrigger(vector.input, { channel: vector.channel as TriggerChannel, config })).toEqual(vector.expect)
  })
})

describe('choosing how to reach the sender on a phone: every selection vector', () => {
  const selection = file.config.selection as SelectionConfig
  it.each(file.selectionVectors.map((v) => [v.id, v] as const))('%s', (_, vector) => {
    onDevice()
    expect(selectService(vector.input as SelectionDocument, selection)).toEqual(vector.expect)
  })
})

/**
 * The link's own host, and a service endpoint's, read the same under both URLs. React Native's `hostname` (0.81,
 * Libraries/Blob/URL.js:134-136) is a bare capture of the text: not lower-cased, not percent-decoded, `\` left in, a
 * numeric last label not read as an address, and nothing at all for an upper-case `HTTPS://`. Node's is WHATWG's,
 * which lower-cases, decodes `%`, maps Unicode to punycode, reads `\` as `/` and a numeric last label (digits or `0x`
 * hex) as IPv4. So on a phone an upper-case host was refused and `1.2.3.0x4` passed as a name; under jest the reverse
 * held for `%`, `\` and Unicode, which the phone refuses and jest let through. Exact reasons under both.
 */
describe("a link's own host, the same under both URLs", () => {
  const base = file.vectors.find((v) => v.id === 'valid-uppercase-scheme-and-host') as (typeof file.vectors)[number]
  const config = file.config as unknown as TriggerConfig
  const withHost = (host: string) => base.input.replace('LINK.TRUSTOVERIP.ORG', host)
  const accepted = ['LINK.TRUSTOVERIP.ORG', 'Link.TrustOverIP.org', 'link.trustoverip.org']
  const refused: [string, string][] = [
    ['a hex last label (WHATWG reads it as IPv4)', '1.2.3.0x4'],
    ['a bare 0x last label', 'link.0x'],
    ['an upper-case hex last label', 'link.0X1F'],
    ['a percent-encoded dot', 'link.trustoverip%2Eorg'],
    ['a backslash (WHATWG reads it as /, leaving our host before it)', 'link.trustoverip.org\\evil.example'],
    ['a non-ASCII host', 'bücher.example'],
    ['a Kelvin sign that WHATWG maps to k', 'linK.trustoverip.org'],
  ]
  const runtimes: [string, () => void][] = [
    ['Node', () => undefined],
    ['React Native', onDevice],
  ]

  describe.each(runtimes)('under %s', (_, install) => {
    test.each(accepted)('%s is read as link.trustoverip.org', (host) => {
      install()
      expect(readTrigger(withHost(host), { channel: base.channel as TriggerChannel, config })).toEqual(base.expect)
    })

    test.each(refused)('%s: %s is bad-authority', (_label, host) => {
      install()
      expect(readTrigger(withHost(host), { channel: base.channel as TriggerChannel, config })).toEqual({
        outcome: 'reject',
        reason: 'bad-authority',
        ui: 'invalid',
      })
    })
  })

  const endpoints: [string, boolean][] = [
    ['https://MEDIATOR.example.com/didcomm', true],
    ['HTTPS://mediator.example.com/didcomm', true],
    ['https://mediator.example.com/didcomm', true],
    ['https://1.2.3.0x4/tt', false],
    ['https://api.example%2Ecom/tt', false],
    ['https://api.example.com\\evil.example/tt', false],
    ['https://bücher.example/tt', false],
  ]
  describe.each(runtimes)('a service endpoint under %s', (_, install) => {
    test.each(endpoints)('%s is a candidate: %s', (endpoint, candidate) => {
      install()
      expect(isCandidateEndpoint(endpoint)).toBe(candidate)
    })
  })
})

/**
 * A crafted `_type` against the wrong-host check. The `_type` a link carries is split by `parseType`, as on main; the
 * fix changes only how Keyring's own flow URI (`typeBase`) is read, so each of these must come out as it did on main
 * under Node's URL, and the same under the phone's. Exact reasons, so a decoy that read as ours would show here as an
 * accept, and a wrong-host that read as unknown-flow (or the reverse) as the other reason.
 */
describe('a crafted `_type` is refused, the same under both URLs', () => {
  const link = (type: string) =>
    `https://link.trustoverip.org/t#_from=${ME}&_id=${ENACTMENT}&_exp=${EXP}&_type=${encodeURIComponent(type)}`
  const HOST = 'link.trustoverip.org'
  const PATH = '/vti/flow/shared-connect'
  const cases: [string, string, string][] = [
    // userinfo: the real host on either side of an `@` is still not the flow's host
    ['userinfo before the real host', `https://evil.example@${HOST}${PATH}/0.1`, 'wrong-host'],
    ['the real host as userinfo', `https://${HOST}@evil.example${PATH}/0.1`, 'wrong-host'],
    // backslash: WHATWG reads `\` as `/`; `_type`'s alphabet has no `\` at all
    ['a backslash before an @', `https://${HOST}\\@evil.example${PATH}/0.1`, 'bad-type'],
    ['a backslash in the host', `https://evil.example\\${HOST}${PATH}/0.1`, 'bad-type'],
    // port: never the flow's host, the default port included (main compared the string as sent)
    ['a port', `https://${HOST}:8443${PATH}/0.1`, 'wrong-host'],
    ['the default port', `https://${HOST}:443${PATH}/0.1`, 'wrong-host'],
    // case and a trailing dot: not normalised (as on main; whether they should be is a spec question)
    ['an upper-case host', `https://${HOST.toUpperCase()}${PATH}/0.1`, 'wrong-host'],
    ['a trailing dot on the host', `https://${HOST}.${PATH}/0.1`, 'wrong-host'],
    // percent-encoded separators: never decoded into a separator
    ['an encoded / and @ in the authority', `https://${HOST}%2F@evil.example${PATH}/0.1`, 'wrong-host'],
    ['an encoded / before the version', `https://${HOST}${PATH}%2F0.1`, 'bad-type'],
    ['an encoded / in a path', '/vti/flow%2Fshared-connect/0.1', 'bad-type'],
    // scheme-relative and schemeless
    ['scheme-relative', `//${HOST}${PATH}/0.1`, 'bad-type'],
    ['schemeless', `${HOST}${PATH}/0.1`, 'bad-type'],
    // dot segments
    ['a dot segment in a path', '/vti/flow/../flow/shared-connect/0.1', 'bad-type'],
    ['a dot segment in an absolute URI', `https://${HOST}/vti/flow/../flow/shared-connect/0.1`, 'unknown-flow'],
    // an empty segment the sender sent, at the end (what the bug produced) and in the middle
    ['a trailing slash the sender sent', `${PATH}//0.1`, 'unknown-flow'],
    ['an empty segment in the middle', '/vti//flow/shared-connect/0.1', 'unknown-flow'],
  ]
  const runtimes: [string, () => void][] = [
    ['Node', () => undefined],
    ['React Native', onDevice],
  ]

  describe.each(runtimes)('under %s', (_, install) => {
    test.each(cases)('%s: %s is %s', (_label, type, reason) => {
      install()
      setSharedConnectEnabled(true)
      expect(readTrigger(link(type), { channel: 'scan', now: EXP - 300 })).toMatchObject({ outcome: 'reject', reason })
    })

    test('and the link as Keyring builds it, relative or absolute, is accepted (the control for the rows above)', () => {
      install()
      setSharedConnectEnabled(true)
      for (const type of [`${PATH}/0.1`, `https://${HOST}${PATH}/0.1`]) {
        expect(readTrigger(link(type), { channel: 'scan', now: EXP - 300 })).toMatchObject({
          outcome: 'accept',
          flow: 'shared-connect',
        })
      }
    })
  })
})

describe("Keyring's own flow URIs read as Node's URL reads them (what main compared against)", () => {
  const bases = [
    SIGN_IN_FLOW,
    VTA_CLAIM_FLOW,
    SHARED_CONNECT_FLOW,
    ...((file.config as unknown as TriggerConfig).flows ?? []).map((f) => f.typeBase),
  ]
  test.each(bases)('%s', (base) => {
    const node = new NodeURL(base)
    expect(uriHostAndPath(base)).toEqual({ host: node.host, path: node.pathname })
  })
})

describe('uriHostAndPath', () => {
  test.each([
    ['https://link.trustoverip.org/vti/flow/sign-in', { host: 'link.trustoverip.org', path: '/vti/flow/sign-in' }],
    ['https://link.trustoverip.org/vti/flow/sign-in/', { host: 'link.trustoverip.org', path: '/vti/flow/sign-in/' }],
    ['https://invite.example.org', { host: 'invite.example.org', path: '' }],
  ])('%s', (uri, expected) => {
    expect(uriHostAndPath(uri)).toEqual(expected)
  })

  test('is undefined for something that is not an absolute URI', () => {
    expect(uriHostAndPath('/vti/flow/sign-in')).toBeUndefined()
  })
})
