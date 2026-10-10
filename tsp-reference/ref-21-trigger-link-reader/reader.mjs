// Trigger-link reader, written from the reading order of the VTI trigger-link
// chapter (dtgwg-vti-spec PR #58, spec/07a-links.md) and Keyring's
// docs/specs/keyring-qr-and-links.md section 3.
//
// Node built-ins only. No network. Never logs or echoes the input text: a
// rejection carries only an outcome, a reason and a UI class.

const RESERVED = ['_from', '_id', '_exp', '_type'];

// Outcome class for each rejection reason. Anything not listed is `invalid`.
const UI_FOR_REASON = {
  'unsupported-vid': 'update',
  'unknown-flow': 'update',
  'unsupported-version': 'update',
  expired: 'expired',
  'no-common-transport': 'unreachable',
  'not-ours': 'pass-on',
};

const reject = (reason) => ({ outcome: 'reject', reason, ui: UI_FOR_REASON[reason] ?? 'invalid' });

// ---------------------------------------------------------------------------
// Form parsing: WHATWG application/x-www-form-urlencoded (URL Standard 5.1).
// URLSearchParams is that exact parser: splits on &, skips empty sequences,
// splits at the first =, turns + into a space, percent-decodes once (leaving a
// malformed % as written) and decodes UTF-8. It keeps document order.
function parseForm(text) {
  return [...new URLSearchParams(text)];
}

// ---------------------------------------------------------------------------
// Host rules (section 5 rule 6 / the host-rules requirement). `host` is the
// result of WHATWG host parsing, so it is already lowercased and any IPv4
// spelling (hex, octal, short forms) has become dotted decimal.
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function hostMeetsRules(host) {
  if (!host || host.length > 253 || host.endsWith('.')) return false;
  if (host.startsWith('[')) return false; // IPv6 literal
  const labels = host.split('.');
  if (labels.length < 2) return false;
  if (!labels.every((l) => LABEL.test(l))) return false;
  // The last label is not all digits; this also refuses every IPv4 address.
  if (/^[0-9]+$/.test(labels[labels.length - 1])) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.endsWith('.local')) return false;
  if (host.endsWith('.home.arpa')) return false;
  return true;
}

// Checks a raw authority (the text between :// and the first / ? or #).
// Returns the WHATWG-parsed host, or null if the authority fails.
function parseAuthority(authority) {
  if (authority.includes('@')) return null; // userinfo
  if (authority.startsWith('[')) return null; // IP literal, never a DNS name
  if (authority.includes(':')) return null; // a port, even an empty or default one
  let host;
  try {
    // WHATWG host parsing "as for an https URL". Throws on hosts it refuses,
    // e.g. a dotted name whose last label is numeric but not a valid IPv4.
    host = new URL(`https://${authority}/`).hostname;
  } catch {
    return null;
  }
  return hostMeetsRules(host) ? host : null;
}

// ---------------------------------------------------------------------------
// _from: VID syntax (W3C DID 1.0 section 3.1 plus the supported methods).
const IDCHAR = "(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})";
const DID_CORE = new RegExp(`^did:([a-z0-9]+):((?:${IDCHAR}*:)*${IDCHAR}+)$`);
const SEGMENT = new RegExp(`^${IDCHAR}+$`);

export function isDid(value) {
  return DID_CORE.test(value);
}

// Method-specific syntax for the methods this reader supports. Each returns
// true when the method-specific id is well formed.
const METHOD_SYNTAX = {
  webvh: (msid) => {
    const segs = msid.split(':');
    return segs.length >= 2 && /^[A-Za-z0-9]{1,64}$/.test(segs[0]) && segs.slice(1).every((s) => SEGMENT.test(s));
  },
  web: (msid) => msid.split(':').every((s) => SEGMENT.test(s)),
  key: (msid) => /^z[1-9A-HJ-NP-Za-km-z]+$/.test(msid),
};

// Returns null if the contact reads, or a rejection reason.
function checkFrom(value) {
  // Agent names are reserved, and refused before any syntax check.
  if (value.includes('/@')) return 'unsupported-vid';
  if (value === '') return 'bad-from';
  if (value.startsWith('did:')) {
    const m = DID_CORE.exec(value);
    if (!m) return 'bad-from';
    const syntax = METHOD_SYNTAX[m[1]];
    if (!syntax) return 'unsupported-vid';
    return syntax(m[2]) ? null : 'bad-from';
  }
  // Any other non-empty value: an identifier type this reader cannot read.
  // It cannot tell an unknown type from a nonexistent one, so `update`.
  return 'unsupported-vid';
}

const didMethod = (did) => did.split(':')[1];

// ---------------------------------------------------------------------------
// _id: 16 to 32 bytes as canonical unpadded base64url.
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function idIsValid(id) {
  if (!/^[A-Za-z0-9_-]{22,43}$/.test(id)) return false;
  const rem = id.length % 4;
  if (rem === 1) return false; // no whole number of bytes gives this length
  // Unused low bits of the last character must be zero, so a handle has one
  // spelling: 4 unused bits when 2 characters trail, 2 when 3 trail.
  const last = B64URL.indexOf(id[id.length - 1]);
  if (rem === 2) return (last & 0b1111) === 0;
  if (rem === 3) return (last & 0b11) === 0;
  return true;
}

// _exp: 0, or a decimal integer with no leading zero, at most 2^53-1.
function parseExp(s) {
  if (!/^(?:0|[1-9][0-9]*)$/.test(s)) return null;
  if (BigInt(s) > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(s);
}

// ---------------------------------------------------------------------------
// _type: absolute https URI or path form; the last segment is MAJOR.MINOR.
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

// Returns { uri, base, path, host, major, minor } or null for bad-type.
function parseType(value, linkHost) {
  let uri;
  if (value.startsWith('/')) {
    // Path form: exactly one leading /, a restricted alphabet (so no %, ? or
    // #), and no dot segments. Never normalised into shape.
    if (value.startsWith('//')) return null;
    if (!/^[A-Za-z0-9\-._~/]+$/.test(value)) return null;
    const segs = value.slice(1).split('/');
    if (segs.some((s) => s === '.' || s === '..')) return null;
    // Resolved against https:// and the link's lowercased host, whatever the
    // link's scheme was.
    uri = `https://${linkHost}${value}`;
  } else {
    // Absolute form: the https scheme, an authority, a path, and no query or
    // fragment. RFC 3986 characters only.
    if (!/^https:\/\/[^/?#]+\/[^?#]*$/i.test(value)) return null;
    if (!/^[A-Za-z0-9\-._~:/@!$&'()*+,;=%]+$/.test(value)) return null;
    if (/%(?![0-9A-Fa-f]{2})/.test(value)) return null;
    uri = value;
  }
  const m = /^([A-Za-z]+:\/\/)([^/]+)(\/.*)$/.exec(uri);
  const [, , host, fullPath] = m;
  const cut = fullPath.lastIndexOf('/');
  const v = VERSION.exec(fullPath.slice(cut + 1));
  if (!v) return null;
  return {
    uri,
    base: uri.slice(0, uri.length - (fullPath.length - cut)),
    path: fullPath.slice(0, cut),
    host,
    major: Number(v[1]),
    minor: Number(v[2]),
  };
}

// The path of a configured flow's type base (its URI without the version).
const basePath = (typeBase) => new URL(typeBase).pathname;
const baseHost = (typeBase) => new URL(typeBase).host;

// Version acceptance: a draft flow accepts only listed MINORs; a stable flow
// accepts any MINOR of a listed MAJOR.
function versionAccepted(flow, major, minor) {
  const minors = flow.supported?.[String(major)];
  if (minors === undefined) return false;
  if (minors === 'any') return flow.status !== 'draft';
  return minors.includes(minor);
}

// ---------------------------------------------------------------------------
// The reading order. Stop at the first failure.
export function readTrigger(rawText, { channel, config } = {}) {
  void channel; // the channel never changes the result
  const aliasSchemes = (config.aliasSchemes ?? []).map((s) => s.toLowerCase());
  const maxLength = config.maxLinkLength ?? 1536;
  const skew = config.skew ?? 60;
  const flows = config.flows ?? [];

  // 1. Trim ASCII whitespace (TAB, LF, FF, CR, SPACE); count code points.
  const text = String(rawText).replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
  if ([...text].length > maxLength) return reject('too-long');

  // 2. Scheme, then whether the text carries a trigger at all.
  const sm = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(text);
  const scheme = sm?.[1].toLowerCase();
  if (!sm || !(scheme === 'https' || scheme === 'http' || aliasSchemes.includes(scheme))) {
    return reject('not-ours');
  }
  const hashAt = text.indexOf('#');
  const fragment = hashAt === -1 ? '' : text.slice(hashAt + 1);
  const beforeHash = hashAt === -1 ? text : text.slice(0, hashAt);
  const qAt = beforeHash.indexOf('?');
  const query = qAt === -1 ? '' : beforeHash.slice(qAt + 1);
  const pairs = parseForm(fragment);
  const hasReserved = (ps) => ps.some(([n]) => RESERVED.includes(n));
  if (!hasReserved(pairs)) {
    // The query is consulted only to say "this looks like a trigger in the
    // wrong place"; nothing in it is ever used.
    return reject(hasReserved(parseForm(query)) ? 'query-form' : 'not-ours');
  }
  if (scheme === 'http') return reject('insecure-scheme');

  // 3. Grammar: no C0 control, space or DEL anywhere, and only one #.
  if (/[\u0000- \u007f]/.test(text) || fragment.includes('#')) return reject('bad-grammar');

  // 4. Authority: no userinfo, no port, host meets the host rules.
  const afterScheme = text.slice(sm[0].length);
  const authority = afterScheme.slice(0, afterScheme.search(/[/?#]|$/));
  const linkHost = parseAuthority(authority);
  if (!linkHost) return reject('bad-authority');

  // 5. Each reserved name at most once (names compared after decoding).
  const fields = {};
  const ignored = [];
  for (const [name, value] of pairs) {
    if (RESERVED.includes(name)) {
      if (name in fields) return reject('repeated-param');
      fields[name] = value;
    } else if (name.startsWith('_')) {
      ignored.push(`fragment.${name}`);
    }
    // Any other name is ignored silently, whatever its value.
  }

  // 6. The contact.
  if (!('_from' in fields)) return reject('missing-from');
  const fromProblem = checkFrom(fields._from);
  if (fromProblem) return reject(fromProblem);

  // 7. Handle and expiry grammar.
  if (!('_id' in fields) || !idIsValid(fields._id)) return reject('bad-id');
  let exp = null;
  if ('_exp' in fields) {
    exp = parseExp(fields._exp);
    if (exp === null) return reject('bad-exp');
  }

  // 8. Flow: grammar, then host, then known flow, then version.
  let flow = null;
  let task = null;
  if ('_type' in fields) {
    const t = parseType(fields._type, linkHost);
    if (!t) return reject('bad-type');
    flow = flows.find((f) => f.typeBase === t.base);
    if (!flow) {
      // Same path as a flow we implement, but another host: telling the person
      // to update would be wrong, so this is not unknown-flow.
      const samePath = flows.find((f) => basePath(f.typeBase) === t.path && baseHost(f.typeBase) !== t.host);
      return reject(samePath ? 'wrong-host' : 'unknown-flow');
    }
    if (!versionAccepted(flow, t.major, t.minor)) return reject('unsupported-version');
    task = { uri: t.uri, major: t.major, minor: t.minor };
  }

  // 9. The flow's own rules about the contact and the expiry.
  if (flow) {
    const allowed = flow.allowedVidTypes;
    if (allowed !== 'any' && !allowed.includes(`did:${didMethod(fields._from)}`)) {
      return reject('from-not-allowed');
    }
    if (flow.expRequired && exp === null) return reject('missing-exp');
  }

  // 10. Expiry, with the skew allowance for phone clock error.
  if (exp !== null && exp + skew <= config.now) return reject('expired');

  // 11. Accept.
  return {
    outcome: 'accept',
    via: 'url',
    from: fields._from,
    id: fields._id,
    exp,
    flow: flow ? flow.flow : null,
    task,
    ignored,
  };
}

// ---------------------------------------------------------------------------
// Transport selection from a verified DID document (section 5 rule 5).
// `doc` is { verified, services: [{ id, type, endpoint | serviceEndpoint }] }.
// `selection` is the vectors' config.selection block: type-to-binding map and
// the consumer's supported bindings and preference order.
//
// Faithful to PR #58's candidate rule: an endpoint is "an https URL or a DID"
// whose host, where it has one, meets the host rules. #58 does not exclude an
// https URL with userinfo, so this function does not either (see README).
export function selectService(doc, selection) {
  if (!doc || doc.verified !== true) {
    return { outcome: 'reject', reason: 'did-document-unverified', sent: false, ui: 'invalid' };
  }
  const typeToBinding = selection.serviceTypeToBinding ?? {};
  const supported = selection.consumer?.supported ?? [];
  const preference = selection.consumer?.preference ?? supported;

  const isCandidateEndpoint = (ep) => {
    if (typeof ep !== 'string') return false;
    if (ep.startsWith('did:')) return isDid(ep);
    let u;
    try {
      u = new URL(ep);
    } catch {
      return false;
    }
    if (u.protocol !== 'https:') return false;
    // The host rules forbid a port; check the raw authority, since WHATWG
    // drops a default :443.
    const authority = ep.slice('https://'.length).split(/[/?#]/)[0];
    const hostPart = authority.slice(authority.lastIndexOf('@') + 1);
    if (hostPart.includes(':') || hostPart.startsWith('[')) return false;
    return hostMeetsRules(u.hostname);
  };

  // Matched on type, never on id. First in document order within a type.
  const firstByBinding = {};
  for (const svc of doc.services ?? []) {
    const binding = typeToBinding[svc.type];
    if (!binding || !supported.includes(binding)) continue;
    const ep = svc.endpoint ?? svc.serviceEndpoint;
    if (!isCandidateEndpoint(ep)) continue;
    if (!(binding in firstByBinding)) firstByBinding[binding] = ep;
  }
  // The consumer's preference chooses among bindings; document order of
  // different types does not. Nothing from the trigger text is consulted.
  for (const binding of preference) {
    if (binding in firstByBinding) {
      return { outcome: 'select', binding, endpoint: firstByBinding[binding], source: 'did-document', sent: false };
    }
  }
  return { outcome: 'no-common-transport', sent: false, ui: 'unreachable' };
}
