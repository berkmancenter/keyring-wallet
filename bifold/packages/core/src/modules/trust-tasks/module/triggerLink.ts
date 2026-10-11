/**
 * triggerLink — reading a one-scan trigger link (a community sign-in, an
 * agent claim) offline, and choosing how to reach its sender from the
 * sender's verified DID document.
 *
 * Written to the reading order of the VTI trigger-link chapter
 * (dtgwg-vti-spec PR #58, `spec/07a-links.md`) and Keyring's own
 * `docs/specs/keyring-qr-and-links.md` (keyring-wallet #354), and ported from
 * the reference reader that passes every one of that spec's vectors
 * (keyring-wallet `tsp-reference/ref-21-trigger-link-reader`).
 *
 * Pure: no network, no storage, and the text is never logged or echoed — a
 * rejection carries only an outcome, a reason and the class of words to show.
 * Nothing in the link is trusted for where to send anything: endpoints come
 * from the sender's DID document (`selectService`, `serviceEndpointOfType`).
 *
 * @module trust-tasks/module/triggerLink
 */

/**
 * Trigger-link sign-in is not switched on. Off, the scanner answers every
 * trigger link with "This code needs a newer version of the app." exactly as
 * before (vtiLinks), and nothing reaches the claim step. A constant, as
 * `USE_CREDO_OPENID_REFRESH_FLOW` is: there is no screen behind it yet, so a
 * developer setting would only offer a dead end.
 */
export const TRIGGER_LINK_SIGN_IN = false

/** Whether trigger-link sign-in is on. A function, so a test can turn it on. */
export const triggerLinkSignInEnabled = (): boolean => TRIGGER_LINK_SIGN_IN

/** The names a trigger link reserves in its fragment. */
const RESERVED = ['_from', '_id', '_exp', '_type']

/** Where the text came from. It never changes the result; it is kept for the caller's record. */
export type TriggerChannel = 'scan' | 'deeplink' | 'paste'

/**
 * The five things a person can be told about a trigger link they cannot use
 * (or, for `pass-on`, that it is not one of these at all and goes to the
 * scanner's other handlers unchanged).
 */
export type TriggerUi = 'update' | 'expired' | 'unreachable' | 'invalid' | 'pass-on'

/** The words for each, as the spec gives them. `pass-on` has none: nothing is said. */
export const TRIGGER_UI_MESSAGES: Record<Exclude<TriggerUi, 'pass-on'>, string> = {
  update: 'This code needs a newer version of the app.',
  expired: 'This code has expired. Get a new one.',
  unreachable: "This service can't be reached from your wallet.",
  invalid: "This code can't be used.",
}

/** The same words as localization keys, for a screen that can translate. */
export const TRIGGER_UI_MESSAGE_KEYS: Record<Exclude<TriggerUi, 'pass-on'>, string> = {
  update: 'Scan.TriggerLinkUpdate',
  expired: 'Scan.TriggerLinkExpired',
  unreachable: 'Scan.TriggerLinkUnreachable',
  invalid: 'Scan.TriggerLinkInvalid',
}

/** A flow this reader knows by its type URI (without the version segment). */
export type TriggerFlow = {
  /** A plain label, returned on accept. */
  flow: string
  typeBase: string
  /** A draft flow accepts only the listed MINORs; a stable one any MINOR of a listed MAJOR. */
  status: 'draft' | 'stable'
  expRequired: boolean
  /** The DID methods (`did:webvh`, …) the flow accepts as its contact, or any. */
  allowedVidTypes: string[] | 'any'
  supported: Record<string, number[] | 'any'>
  /** Whether Keyring carries the flow through. A known flow it does not is answered `update`. */
  implemented?: boolean
  testOnly?: boolean
}

export type TriggerConfig = {
  /** Now, in seconds since the epoch. */
  now?: number
  /** Allowance for the phone's clock, in seconds. */
  skew?: number
  maxLinkLength?: number
  /** Schemes besides https that are this wallet's own (`keyring`). */
  aliasSchemes?: string[]
  flows?: TriggerFlow[]
}

/** The flow types the spec names, resolved against the host it proposes for path-form types. */
export const TRIGGER_LINK_HOST = 'link.trustoverip.org'
export const SIGN_IN_FLOW = `https://${TRIGGER_LINK_HOST}/vti/flow/sign-in`
export const VTA_CLAIM_FLOW = `https://${TRIGGER_LINK_HOST}/vti/flow/vta-claim`

/**
 * What Keyring reads. Sign-in is the one flow it carries through; an agent
 * claim is known, so it is read and then answered `update` rather than
 * "can't be used". `keyring:` is the app's own scheme, which `isTriggerLink`
 * already claims.
 */
export const KEYRING_TRIGGER_CONFIG: TriggerConfig = {
  skew: 60,
  maxLinkLength: 1536,
  aliasSchemes: ['keyring'],
  flows: [
    {
      flow: 'sign-in',
      typeBase: SIGN_IN_FLOW,
      status: 'draft',
      expRequired: true,
      allowedVidTypes: ['did:webvh', 'did:web'],
      supported: { '0': [1] },
      implemented: true,
    },
    {
      flow: 'vta-claim',
      typeBase: VTA_CLAIM_FLOW,
      status: 'draft',
      expRequired: true,
      allowedVidTypes: ['did:webvh', 'did:web'],
      supported: { '0': [1] },
      implemented: false,
    },
  ],
}

export type TriggerAccept = {
  outcome: 'accept'
  via: 'url'
  from: string
  id: string
  exp: number | null
  flow: string | null
  task: { uri: string; major: number; minor: number } | null
  /** `fragment.<name>` for each unknown name that begins with `_`, in document order. */
  ignored: string[]
}

export type TriggerReject = { outcome: 'reject'; reason: string; ui: TriggerUi }

export type TriggerResult = TriggerAccept | TriggerReject

/** The class of words for each reason a link is refused. Anything not listed is `invalid`. */
const UI_FOR_REASON: Record<string, TriggerUi> = {
  'unsupported-vid': 'update',
  'unknown-flow': 'update',
  'unsupported-version': 'update',
  expired: 'expired',
  'no-common-transport': 'unreachable',
  'not-ours': 'pass-on',
}

const reject = (reason: string): TriggerReject => ({
  outcome: 'reject',
  reason,
  ui: UI_FOR_REASON[reason] ?? 'invalid',
})

/**
 * WHATWG form parsing. URLSearchParams is exactly that parser: it splits on
 * `&`, skips empty sequences, splits at the first `=`, turns `+` into a space
 * and percent-decodes once, leaving a malformed `%` as written.
 */
const parseForm = (text: string): [string, string][] => [...new URLSearchParams(text).entries()]

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * The host rules, for a host already through WHATWG host parsing (so
 * lowercased, and any IPv4 spelling turned into dotted decimal): a public DNS
 * name of two or more labels, never an IP address or a local name.
 */
export function hostMeetsRules(host: string): boolean {
  if (!host || host.length > 253 || host.endsWith('.')) return false
  if (host.startsWith('[')) return false
  const labels = host.split('.')
  if (labels.length < 2) return false
  if (!labels.every((label) => LABEL.test(label))) return false
  // A last label of digits only also refuses every IPv4 address.
  if (/^[0-9]+$/.test(labels[labels.length - 1])) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host.endsWith('.local') || host.endsWith('.home.arpa')) return false
  return true
}

/** The parsed host of a raw authority, or undefined when it has userinfo, a port, or fails the host rules. */
function parseAuthority(authority: string): string | undefined {
  if (authority.includes('@') || authority.startsWith('[') || authority.includes(':')) return undefined
  let host: string
  try {
    host = new URL(`https://${authority}/`).hostname
  } catch {
    return undefined
  }
  return hostMeetsRules(host) ? host : undefined
}

const IDCHAR = '(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})'
const DID_CORE = new RegExp(`^did:([a-z0-9]+):((?:${IDCHAR}*:)*${IDCHAR}+)$`)
const SEGMENT = new RegExp(`^${IDCHAR}+$`)

/** DID Core syntax (W3C DID 1.0 §3.1). */
export const isDid = (value: string): boolean => DID_CORE.test(value)

/** Method-specific syntax for the methods this reader reads. */
const METHOD_SYNTAX: Record<string, (msid: string) => boolean> = {
  webvh: (msid) => {
    const segments = msid.split(':')
    return (
      segments.length >= 2 && /^[A-Za-z0-9]{1,64}$/.test(segments[0]) && segments.slice(1).every((s) => SEGMENT.test(s))
    )
  },
  web: (msid) => msid.split(':').every((s) => SEGMENT.test(s)),
  key: (msid) => /^z[1-9A-HJ-NP-Za-km-z]+$/.test(msid),
}

/** Why the contact cannot be read, or undefined when it reads. */
function fromProblem(value: string): string | undefined {
  // Agent names are reserved, and refused before any syntax check.
  if (value.includes('/@')) return 'unsupported-vid'
  if (value === '') return 'bad-from'
  if (!value.startsWith('did:')) {
    // Some other kind of identifier: one this version cannot read, so `update`.
    return 'unsupported-vid'
  }
  const m = DID_CORE.exec(value)
  if (!m) return 'bad-from'
  const syntax = METHOD_SYNTAX[m[1]]
  if (!syntax) return 'unsupported-vid'
  return syntax(m[2]) ? undefined : 'bad-from'
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** A handle is 16 to 32 bytes as canonical unpadded base64url: one spelling per handle. */
function idIsValid(id: string): boolean {
  if (!/^[A-Za-z0-9_-]{22,43}$/.test(id)) return false
  const rem = id.length % 4
  if (rem === 1) return false
  const last = B64URL.indexOf(id[id.length - 1])
  if (rem === 2) return (last & 0b1111) === 0
  if (rem === 3) return (last & 0b11) === 0
  return true
}

/** `_exp`: 0, or a decimal integer with no leading zero, at most 2^53-1. */
function parseExp(text: string): number | undefined {
  if (!/^(?:0|[1-9][0-9]*)$/.test(text)) return undefined
  // Any integer above 2^53-1 parses to at least 2^53, so the comparison holds.
  const value = Number(text)
  return value > Number.MAX_SAFE_INTEGER ? undefined : value
}

const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

type ParsedType = { uri: string; base: string; path: string; host: string; major: number; minor: number }

/** `_type`: an absolute https URI, or a path resolved against the link's host. The last segment is MAJOR.MINOR. */
function parseType(value: string, linkHost: string): ParsedType | undefined {
  let uri: string
  if (value.startsWith('/')) {
    // Exactly one leading `/`, a restricted alphabet (no `%`, `?` or `#`), no
    // dot segments. Never normalised into shape.
    if (value.startsWith('//')) return undefined
    if (!/^[A-Za-z0-9\-._~/]+$/.test(value)) return undefined
    if (
      value
        .slice(1)
        .split('/')
        .some((s) => s === '.' || s === '..')
    )
      return undefined
    // Against https and the link's own host, whatever the link's scheme.
    uri = `https://${linkHost}${value}`
  } else {
    if (!/^https:\/\/[^/?#]+\/[^?#]*$/i.test(value)) return undefined
    if (!/^[A-Za-z0-9\-._~:/@!$&'()*+,;=%]+$/.test(value)) return undefined
    if (/%(?![0-9A-Fa-f]{2})/.test(value)) return undefined
    uri = value
  }
  const m = /^([A-Za-z]+:\/\/)([^/]+)(\/.*)$/.exec(uri)
  if (!m) return undefined
  const [, , host, fullPath] = m
  const cut = fullPath.lastIndexOf('/')
  const version = VERSION.exec(fullPath.slice(cut + 1))
  if (!version) return undefined
  return {
    uri,
    base: uri.slice(0, uri.length - (fullPath.length - cut)),
    path: fullPath.slice(0, cut),
    host,
    major: Number(version[1]),
    minor: Number(version[2]),
  }
}

function versionAccepted(flow: TriggerFlow, major: number, minor: number): boolean {
  const minors = flow.supported[String(major)]
  if (minors === undefined) return false
  if (minors === 'any') return flow.status !== 'draft'
  return minors.includes(minor)
}

/**
 * Read a trigger link, stopping at the first thing wrong with it. Nothing is
 * sent and nothing is logged; an accept says who sent it, its handle, its
 * expiry and its flow, and a reject says only why and which words to show.
 */
export function readTrigger(
  rawText: string,
  options: { channel?: TriggerChannel; now?: number; config?: TriggerConfig } = {}
): TriggerResult {
  const config = options.config ?? KEYRING_TRIGGER_CONFIG
  const now = options.now ?? config.now ?? Math.floor(Date.now() / 1000)
  const aliasSchemes = (config.aliasSchemes ?? []).map((s) => s.toLowerCase())
  const skew = config.skew ?? 60
  const flows = config.flows ?? []

  // 1. Trim ASCII whitespace; the length counts code points.
  const text = String(rawText).replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '')
  if ([...text].length > (config.maxLinkLength ?? 1536)) return reject('too-long')

  // 2. The scheme, then whether the text carries a trigger at all.
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(text)
  const scheme = schemeMatch?.[1].toLowerCase()
  if (!schemeMatch || !scheme || !(scheme === 'https' || scheme === 'http' || aliasSchemes.includes(scheme))) {
    return reject('not-ours')
  }
  const hashAt = text.indexOf('#')
  const fragment = hashAt === -1 ? '' : text.slice(hashAt + 1)
  const beforeHash = hashAt === -1 ? text : text.slice(0, hashAt)
  const queryAt = beforeHash.indexOf('?')
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1)
  const pairs = parseForm(fragment)
  const hasReserved = (ps: [string, string][]) => ps.some(([name]) => RESERVED.includes(name))
  if (!hasReserved(pairs)) {
    // The query is read only to say "a trigger in the wrong place"; nothing in it is used.
    return reject(hasReserved(parseForm(query)) ? 'query-form' : 'not-ours')
  }
  if (scheme === 'http') return reject('insecure-scheme')

  // 3. No control character, space or DEL anywhere, and only one `#`.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f]/.test(text) || fragment.includes('#')) return reject('bad-grammar')

  // 4. No userinfo, no port, and a host that meets the host rules.
  const afterScheme = text.slice(schemeMatch[0].length)
  const authorityEnd = afterScheme.search(/[/?#]/)
  const linkHost = parseAuthority(authorityEnd === -1 ? afterScheme : afterScheme.slice(0, authorityEnd))
  if (!linkHost) return reject('bad-authority')

  // 5. Each reserved name at most once, compared after decoding.
  const fields: Record<string, string> = {}
  const ignored: string[] = []
  for (const [name, value] of pairs) {
    if (RESERVED.includes(name)) {
      if (name in fields) return reject('repeated-param')
      fields[name] = value
    } else if (name.startsWith('_')) {
      ignored.push(`fragment.${name}`)
    }
  }

  // 6. The contact.
  if (!('_from' in fields)) return reject('missing-from')
  const problem = fromProblem(fields._from)
  if (problem) return reject(problem)

  // 7. The handle and the expiry.
  if (!('_id' in fields) || !idIsValid(fields._id)) return reject('bad-id')
  let exp: number | null = null
  if ('_exp' in fields) {
    const parsed = parseExp(fields._exp)
    if (parsed === undefined) return reject('bad-exp')
    exp = parsed
  }

  // 8. The flow: its grammar, its host, whether it is known, its version.
  let flow: TriggerFlow | undefined
  let task: TriggerAccept['task'] = null
  if ('_type' in fields) {
    const type = parseType(fields._type, linkHost)
    if (!type) return reject('bad-type')
    flow = flows.find((f) => f.typeBase === type.base)
    if (!flow) {
      // A flow Keyring knows, served from another host: "update the app" would
      // be wrong, as no version of it reads that.
      const samePath = flows.some((f) => {
        const base = new URL(f.typeBase)
        return base.pathname === type.path && base.host !== type.host
      })
      return reject(samePath ? 'wrong-host' : 'unknown-flow')
    }
    if (!versionAccepted(flow, type.major, type.minor)) return reject('unsupported-version')
    task = { uri: type.uri, major: type.major, minor: type.minor }
  }

  // 9. The flow's own rules for the contact and the expiry.
  if (flow) {
    const allowed = flow.allowedVidTypes
    if (allowed !== 'any' && !allowed.includes(`did:${fields._from.split(':')[1]}`)) return reject('from-not-allowed')
    if (flow.expRequired && exp === null) return reject('missing-exp')
  }

  // 10. The expiry, allowing for the phone's clock.
  if (exp !== null && exp + skew <= now) return reject('expired')

  return {
    outcome: 'accept',
    via: 'url',
    from: fields._from,
    id: fields._id,
    exp,
    flow: flow ? flow.flow : null,
    task,
    ignored,
  }
}

/**
 * What Keyring does with a read link: carry a flow it implements through, or
 * say one of the five things. A link with no flow named, or a known flow
 * Keyring does not carry through yet (an agent claim), is `update`.
 */
export function triggerAction(
  result: TriggerResult,
  config: TriggerConfig = KEYRING_TRIGGER_CONFIG
): { kind: 'proceed'; flow: string; trigger: TriggerAccept } | { kind: 'say'; ui: TriggerUi } {
  if (result.outcome === 'reject') return { kind: 'say', ui: result.ui }
  const flow = (config.flows ?? []).find((f) => f.flow === result.flow)
  if (!flow?.implemented) return { kind: 'say', ui: 'update' }
  return { kind: 'proceed', flow: flow.flow, trigger: result }
}

/** A DID document as transport selection reads it: verified or not, and its services. */
export type SelectionDocument = {
  verified: boolean
  services?: { id?: string; type: string; endpoint?: unknown; serviceEndpoint?: unknown }[]
}

export type SelectionConfig = {
  serviceTypeToBinding?: Record<string, string>
  consumer?: { supported?: string[]; preference?: string[] }
}

/** Keyring reaches a sign-in's community over the Trust Task HTTPS binding only, for now. */
export const KEYRING_SELECTION: SelectionConfig = {
  serviceTypeToBinding: { TrustTaskHTTPS: 'https' },
  consumer: { supported: ['https'], preference: ['https'] },
}

export type SelectionResult =
  | { outcome: 'select'; binding: string; endpoint: string; source: 'did-document'; sent: false }
  | { outcome: 'no-common-transport'; sent: false; ui: 'unreachable' }
  | { outcome: 'reject'; reason: 'did-document-unverified'; sent: false; ui: 'invalid' }

/**
 * Whether a service endpoint may be used: an https URL with no userinfo, no
 * port, and a host that meets the host rules, or a DID. Stricter than #58,
 * which does not mention userinfo; Keyring's spec refuses it, as the link's
 * own authority already does.
 */
export function isCandidateEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string') return false
  if (endpoint.startsWith('did:')) return isDid(endpoint)
  if (!/^https:\/\//i.test(endpoint)) return false
  // Read from the raw text: WHATWG drops a default `:443`, and the rules forbid any port.
  const authority = endpoint.slice('https://'.length).split(/[/?#]/)[0]
  if (authority.includes('@') || authority.includes(':') || authority.startsWith('[')) return false
  try {
    return hostMeetsRules(new URL(endpoint).hostname)
  } catch {
    return false
  }
}

/** A service's endpoint as a string: a plain string, or the `uri` of an object endpoint. */
function endpointText(service: { endpoint?: unknown; serviceEndpoint?: unknown }): unknown {
  const endpoint = service.endpoint ?? service.serviceEndpoint
  if (endpoint && typeof endpoint === 'object' && !Array.isArray(endpoint)) return (endpoint as { uri?: unknown }).uri
  return endpoint
}

/**
 * How to reach a trigger's sender, from its VERIFIED DID document: services
 * are matched on type, never on id; the first usable one of a type wins; the
 * consumer's preference chooses among bindings. Nothing from the link is read.
 */
export function selectService(
  document: SelectionDocument,
  selection: SelectionConfig = KEYRING_SELECTION
): SelectionResult {
  if (!document || document.verified !== true) {
    return { outcome: 'reject', reason: 'did-document-unverified', sent: false, ui: 'invalid' }
  }
  const typeToBinding = selection.serviceTypeToBinding ?? {}
  const supported = selection.consumer?.supported ?? []
  const preference = selection.consumer?.preference ?? supported
  const firstByBinding: Record<string, string> = {}
  for (const service of document.services ?? []) {
    const binding = typeToBinding[service.type]
    if (!binding || !supported.includes(binding)) continue
    const endpoint = endpointText(service)
    if (!isCandidateEndpoint(endpoint)) continue
    if (!(binding in firstByBinding)) firstByBinding[binding] = endpoint
  }
  for (const binding of preference) {
    if (binding in firstByBinding) {
      return {
        outcome: 'select',
        binding,
        endpoint: firstByBinding[binding],
        source: 'did-document',
        sent: false,
      }
    }
  }
  return { outcome: 'no-common-transport', sent: false, ui: 'unreachable' }
}

/**
 * The first usable https endpoint of a service `type` in a DID document, in
 * document order: how sign-in finds `TrustTaskHTTPS` and `SignInPortal`.
 */
export function serviceEndpointOfType(
  didDocument: { service?: { type?: unknown; serviceEndpoint?: unknown }[] },
  type: string
): string | undefined {
  for (const service of didDocument.service ?? []) {
    if (service.type !== type) continue
    const endpoint = endpointText(service)
    if (isCandidateEndpoint(endpoint) && !endpoint.startsWith('did:')) return endpoint
  }
  return undefined
}
