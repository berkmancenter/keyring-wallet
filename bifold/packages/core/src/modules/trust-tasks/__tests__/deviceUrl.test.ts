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
  readTrigger,
  SHARED_CONNECT_FLOW,
  SIGN_IN_FLOW,
  uriHostAndPath,
  VTA_CLAIM_FLOW,
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

/**
 * A second fault on the phone, in the link's own authority, not in `_type`: React Native's `hostname` is not
 * lower-cased, so `parseAuthority` refuses `LINK.TRUSTOVERIP.ORG` (the host rules take lower-case labels) where Node's
 * URL lower-cases it and the vector accepts. Its own fix and control follow this change; until then these rows pin
 * what the phone reads, so that fix has to flip them.
 */
const DEVICE_AUTHORITY_CASE = ['valid-uppercase-scheme-and-host', 'valid-sign-in-alias-uppercase-host']

describe('reading a trigger link on a phone: every conformance vector', () => {
  const config = file.config as unknown as TriggerConfig
  it.each(file.vectors.map((v) => [v.id, v] as const))('%s', (id, vector) => {
    onDevice()
    const read = readTrigger(vector.input, { channel: vector.channel as TriggerChannel, config })
    if (DEVICE_AUTHORITY_CASE.includes(id)) {
      expect(vector.expect).toMatchObject({ outcome: 'accept' })
      expect(read).toEqual({ outcome: 'reject', reason: 'bad-authority', ui: 'invalid' })
    } else {
      expect(read).toEqual(vector.expect)
    }
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
