# QR codes and links that trigger an exchange: claiming an agent and signing in

**Status:** DRAFT, dated 2026-10-08, author bm. Not adopted by any party; nothing here is implemented on the Farm or portal side and Keyring's parsers do not read these formats. Sections 1 to 9 are normative and name no Keyring internals. Everything else (a second container, Farm design, camera and domain notes, Keyring implementation notes) is in the non-normative [annex](./keyring-qr-and-links.annex.md).
**Keywords:** MUST, MUST NOT, SHOULD and MAY are used as in BCP 14 (RFC 2119 and RFC 8174): they carry that force only in capitals. **Vectors:** [`keyring-qr-and-links.vectors.json`](./keyring-qr-and-links.vectors.json) (section 9).
**Upstream pieces that are only drafts:** the Trust Tasks framework (Working Draft 0.7.0, `dtgwg-trust-tasks-tf` `origin/main` `7b6bb488`), its `didcomm/0.2` binding (`status: draft`) and `trust-task-discovery` (`status: draft`, versions 0.1 to 0.3). "Trigger" is an unconfirmed working name: upstream defines no such term in a task document (the push binding's Trigger role and "A hint is a trigger to re-read" in `vtc/admin/events/event/0.1` are the only uses).
**Open (none decided):** the claim-authorisation option (T2), link domains (T3), a URL contact (T4), the first request with no hint (T5), limits (T6). The container is a working position in the plan (container Y, WP3); T7 was withdrawn with the `tp` hint. The plan records working positions; this document stays neutral.

## 1. Model

An **inviter** (the Farm, a VTC portal) shows a short text as a QR code or link; a **consumer** (Keyring) reads it; a person carries it between them. **The text is a one-way trigger, not a task.** It names who to contact, a handle for the pending exchange, optionally when it stops being good, and optionally which flow it opens. It carries no task body, endpoint, key, challenge or authorising secret. 
The consumer treats every field as an **untrusted hint**, as the push binding does for a wake-up payload ("a consumer MUST treat every field of the push payload as an untrusted hint ... and MUST NOT take any framework action on the strength of a push alone", `bindings/push/0.1`). 
It reads and validates the text (section 3), resolves the inviter's DID and takes the endpoint from that document (section 6), and sends a wallet-signed first request over a real binding; replies travel over that binding and the text is not consulted again. 
The legacy Farm QR is version 0 of the same model (section 8).

## 2. The trigger

| Field | Req. | Rule |
|---|---|---|
| contact `_from` | yes | `did:webvh:<scid>:<host>`: `<scid>` is 1 to 64 of `A-Za-z0-9` (not verified at this stage; DID resolution verifies the log); `<host>` is a lowercase DNS name by the host rules of section 6 rule 6, with no port, path segment, fragment or query; at most 256 characters |
| handle `_id` | yes | 22 to 128 of `A-Za-z0-9-_`. Opaque. Names the pending exchange and **grants nothing** |
| expiry `_exp` | by flow | decimal integer UTC epoch seconds: `0` or no leading zero, at most 2^53-1 (I-JSON, RFC 7493 section 2.2); `1791461100.0` and `1.79e9` are `bad-exp`. Required by a flow that says so |
| flow hint `_type` | no | an absolute `https` Type URI ending in `/<MAJOR>.<MINOR>` (no leading zeros) with no query or fragment (section 4) |

The contact and the handle never carry a secret; a handle is a lookup key (section 7). **Security-relevant fields added in future MUST be tied to a flow version that a reader without them rejects**: a reader ignores unknown parameters, so an unsigned link can be stripped of any optional one.

## 3. Container and reading order

**One container (container Y): an `https` link with a small fixed query.** `https://<host>/<path>?_from=<DID>&_id=<handle>[&_exp=<n>][&_type=<URI>]`. `keyring://<host>/<path>?…` is an alias for Keyring's own scanner with the same host, path and query, never the form a camera is expected to open. The names begin with `_` so that they cannot collide with a site's own.

**Parsing is standard.**

- The query is the text between the first `?` and the first `#` (RFC 3986 section 3.4: so `…/c#x?_from=…` has no query).
- It is parsed by `application/x-www-form-urlencoded` parsing (WHATWG URL Standard, 5.1): split on `&`, skip empty sequences, split each at the first `=`, replace `+` with U+0020, percent-decode **once**, decode as UTF-8 without BOM. A malformed percent sequence stays as written. Names are compared case-sensitively after decoding.
- A decoded value that does not match its field's grammar is rejected by that field's rule, and no field grammar admits U+0020 or `%`: so `+`, `%20` and a doubly-encoded value (`%253A`) are `bad-*`.
- A conforming emitter (`URLSearchParams`, Python `urlencode`) writes `did%3Awebvh%3A…`; raw colons and slashes read the same.

**Unknown parameters are ignored, so a tracker cannot break a link.**

- Only `_from`, `_id`, `_exp` and `_type` are read.
- A name that begins with `_` and is not one of them is ignored and reported as `query.<name>`; any other name (`utm_source`, `fbclid`, a bare `gclid`, a repeat of any of them) is ignored and not reported, whatever its value. `ignored` lists reports in document order.
- A **reserved name that repeats** is rejected (`repeated-param`), after decoding, so `%5Ffrom` counts as `_from`.

**Reading order.** Stop at the first failure. Reason codes are for tests; section 7 rule 6 governs what a person sees.

1. Trim ASCII whitespace (TAB, LF, FF, CR, SPACE); over 1,536 characters: `too-long`.
2. Starts with `{` or `[`: the legacy format, section 8.
3. No `scheme://`, a scheme other than `https`, `keyring`, `http` (scheme is case-insensitive), or no reserved name in the query: `not-ours`. `http` with a reserved name: `insecure-scheme`.
4. Whitespace or a control character anywhere: `bad-grammar`. A `#` anywhere: `fragment`.
5. Authority has userinfo or a port, or its host (after WHATWG host parsing) does not meet the host rules of section 6 rule 6: `bad-authority`.
6. A reserved name repeats: `repeated-param`.
7. `_from` absent: `missing-from`; present and not matching section 2: `bad-from`. `_id` absent or not matching: `bad-id`. `_exp` present and not matching: `bad-exp`.
8. `_type` present: not matching section 2: `bad-type`. Not a flow the consumer implements (section 4): `unknown-flow`. A MAJOR it does not implement, or at MAJOR 0 a MINOR it does not implement: `unsupported-version`.
9. The flow requires an allow-listed contact and `<host>` is not on the consumer's list (equal, or a subdomain): `from-not-allowed`. The flow requires `_exp` and it is absent: `missing-exp`.
10. `exp + skew <= now`: `expired`. The consumer's clock is allowed `skew` seconds (300 in the vectors) so that a phone whose clock runs minutes fast does not refuse every 120-second login code; the inviter enforces the real expiry.
11. Accept: `from`, `id`, `exp` (or null), `flow` (or null) and `task` (or null), `ignored`. An unhinted trigger is accepted; what follows is section 6 rule 8.

A reader MAY check in another order only if it reports the same result.

**UI outcomes** (the only messages; a reader MUST NOT say which field failed or whether a host was on a list): `update` (`unknown-flow`, `unsupported-version`): "This code needs a newer version of the app."; `expired` (`expired`): "This code has expired. Get a new one."; `scan-only` (`wrong-channel`): "Scan the code on the website's screen."; `unreachable` (`no-common-transport`): "This service can't be reached from your wallet."; `pass-on` (`not-ours`): no message, the text goes to the consumer's other handlers; `invalid` (every other reason): "This code can't be used."

## 4. Flow identifiers and versions

A flow is named once, by its **Type URI**, compared by its **whole string** (framework 0.7.0, Type URI: "A Type URI identifies a specification by its whole string, never by its slug alone"). A consumer implements a list of Type URIs minus their version; the same slug under another authority is `unknown-flow`, and so is a registry URI no one has registered. 

MINOR is additive and MAJOR breaking (framework, Compatibility Rules): a consumer at `M.N` SHOULD accept `M.K` for `K > N` where it can ignore members it does not know, and MUST reject a MAJOR it does not implement ("A `MAJOR` mismatch is never forward-compatible"; the framework's error code is `unsupportedVersion`, this document's test reason is `unsupported-version`). 
At MAJOR 0 a task is draft and a MINOR may break, so a consumer accepts only the MINORs it implements. Both tasks below are drafts at MAJOR 0, so **inviters keep the previous version working until the named wallets have shipped the new one** (framework, Migrating Between Versions: "Update receivers first"). 
After `unknown-flow` or `unsupported-version` a consumer MUST NOT try another flow, MAJOR or parser.

## 5. Registry (provisional)

| Flow | Type URI, version 0.1 | Contact | Expiry | Contact on the `from` list |
|---|---|---|---|---|
| claim a parked VTA | `https://wallet.asml.berkmancenter.org/trust-tasks/spec/vta-claim/0.1` | the Farm's claim-service DID | required | required |
| sign in to a community portal | `https://wallet.asml.berkmancenter.org/trust-tasks/spec/auth/oob/describe/0.1` | the community's DID | required, at most 300 seconds (120 recommended) | no (the wallet must already know the community; wallet policy) |

**These are private identifiers, provisional.** Framework 0.7.0, Private and Unpublished Trust Task Specifications: a private specification's Type URI "MUST NOT be served from, or claim to identify a resource at, the `https://trusttasks.org/` domain", so neither flow claims it; a re-host under the registry is a different identifier "unless and until the registry policy explicitly aliases them". `vta-claim` has no upstream task; the `auth/oob/*` family is a third-party proposal's, not a published specification, and the hint names its first task as the wallet sends it (`describe`); it shares only the word "oob" with DIDComm's out-of-band messages and has nothing to do with them (annex E, 8.4). The authority host is a proposal and is not served yet; the plan holds the transition note.

## 6. After the trigger

1. **Confirm before any network activity.** Before any network activity (including DID resolution) the consumer shows only what the trigger itself contains, the inviter identifier or its domain, labelled **unverified**, and requires a tap.
2. **Approve after verification.** After the DID document is resolved and verified (`did:webvh`: the log verifies; otherwise `did-document-unverified` and nothing is sent) the consumer shows verified details and sends nothing until the person approves.
3. **Unauthenticated text is never shown as fact.** The `_type` hint and every other trigger field except the identifier in rule 1 MUST NOT be displayed as a statement of what the exchange is.
4. **Fresh pairwise key.** The first request is signed with a key minted for this exchange and not used elsewhere (for a `vta-claim`, the new `did:key`), never a persistent identifier.
5. **Transport comes from the document, never the text.** Candidates are the services of the verified DID document whose `type` maps to a binding the consumer implements (`DIDCommMessaging` to `didcomm`, `TrustTaskHTTPS` to `https`, matched on `type`, never on `id`: `bindings/https/0.3`, section 6.2). 
   The consumer's own preference order ranks the bindings; the order of services of different types and DIDComm's `accept` (media types) do not; among candidates of one type the first in document order wins. No candidate: `no-common-transport`, nothing is sent, and the consumer does not fall back to another binding or to an endpoint from the text. The first request and its reply use the selected binding. **A document is resolved afresh for each exchange.** Any member of the text that looks like an endpoint is ignored.
6. **Host rules** (the link host, the DID host and every endpoint). A host is a DNS name of at least two non-empty labels (each at most 63 characters, whole host at most 253), lowercase after WHATWG host parsing, with no trailing dot; **not** an IP address in any form (IPv6, dotted IPv4, and the hexadecimal, octal or single-number IPv4 forms that WHATWG parsing turns into an address); not `localhost`, `*.localhost`, `*.local` (RFC 6761, RFC 6762) or `*.home.arpa` (RFC 8375); the last label is not all digits. An endpoint is an `https:` URL with no userinfo. A consumer SHOULD also refuse an endpoint whose resolved address is loopback, link-local or private: no vector can test it. A lab stack on `localhost:<port>` is therefore outside this profile.
7. **The first request** is a Trust Task document with `issuer` the wallet's DID for this exchange (rule 4), `recipient` the inviter's DID (framework, Audience Binding: a document with a `proof` MUST carry `recipient` unless its specification is bearer; a request to the inviter is not bearer), a unique `id`, and **the handle as `parentThreadId`**, the framework's own member (4.9.2, "the `threadId` of the exchange that contains this one"), which `bindings/didcomm/0.2` section 3.1 maps to DIDComm `pthid`, the field DIDComm already uses for an out-of-band invitation's `id`. Reading the invitation as the enclosing exchange is this profile's interpretation: **confirm with the Trust Tasks group**. `parentThreadId` "carries no normative validation semantics", so the inviter looks the handle up and decides by its own policy; receiving a signed request authorises nothing by itself.
8. **No flow hint.** The consumer MAY ask the inviter which task types it supports with `trust-task-discovery` (draft; 0.3 is the newest and says "a discoverer SHOULD ask in 0.3"; a response whose origin is authenticated neither in-band nor by the transport MUST NOT be acted on). Discovery lists supported types; it does not say which one a handle opens, so T5 remains open, and a consumer MAY refuse an unhinted trigger it cannot place (`invalid`).

## 7. Security and producer requirements

1. **A trigger confers no authority.** Acting on it is the consumer's decision; granting anything is the inviter's, on the signed request (framework, Consumer Requirements: "Not treat identity or document-proof validation as authorization").
2. **No secret, no endpoint, no task body in the text.** A handle alone is a bearer wherever the inviter treats possession as authority; proof of possession by the claimant's own key does not change that in a pool claim, since the claimant picks its key. How a claim is authorised is open (T2, annex D).
3. **Nothing is spent on a GET.** A link preview, mail scanner or browser fetch of the link MUST NOT consume the handle; it is spent only on the signed request. A trigger causes no fetch by reference.
4. **A consumer MUST NOT log, show in an error, toast or analytics, or send anywhere but to the inviter (in the first request) the text, the handle or the contact.** It logs at most the class of a link (scheme, flow, "trigger") and redacts before any logger runs.
5. **Producers (the inviter):** (a) the handle MUST be at least 128 bits from a CSPRNG, written as unpadded base64url (22 characters); (b) `_exp` MUST be no later than the inviter's own lifetime for the handle; (c) any page that carries or displays the link MUST be served with `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, MUST NOT load third-party scripts, and the inviter SHOULD NOT log the query; (d) the link carries exactly the four reserved names, each at most once; a standard form encoder is fine and consumers decode it; (e) a page that offers a `keyring://` button MUST NOT do so for a handle that can be spent (RFC 8252 section 8.1: another app may register the scheme); (f) the contact's DID document MUST publish the service the consumer selects.
6. **Failures are generic** (section 3 UI outcomes).
7. **Texts outside this document** are `not-ours` and unchanged: `keyring://vta/enrol`, links to approvals, community and invitation links, ticket links, bare DIDs, OpenID4VCI offers, DIDComm v1 invitations.

## 8. The legacy format (version 0)

The Farm's existing code is a JSON object `{"vta_did":"did:webvh:…","callback_url":"https://…"}`: the contact is `vta_did`; the endpoint and the secret are `callback_url`. The text MUST be an I-JSON object (RFC 7493: no duplicate member names, compared after escape processing). A reader requires the two keys and **ignores any other, reporting `legacy.<key>` in document order**. (Keyring today rejects an extra key; the Farm keeps the QR frozen until a Keyring release ignores unknown keys, so the vectors encode that release.) `callback_url` is `https` on a host that meets section 6 rule 6 and is on the consumer's list (`ic3.dev`, `firstperson.dev`), has no userinfo, port, fragment or control character, at most 512 characters; `vta_did` is a `did:webvh` DID of at most 256 characters.

Reading order: not a JSON object or no `callback_url` key: `not-ours`; channel not `scan`: `wrong-channel` (QR only); a duplicate member name: `bad-value`; `vta_did` or `callback_url` absent: `missing-param`; wrong type or form: `bad-value`; host or length failing: `callback-not-allowed`.

The callback is bearer and is never logged. **Sunset:** accepted until the first Keyring release that ignores unknown keys has been available for a period set by the Farm and Keyring owners, after which the Farm stops emitting it.

**No other legacy form.** The VTC portal emits the container link (section 3) from the start, and Keyring reads no `keyring://oob` form (annex E, 8.4).

## 9. Conformance

Two classes. A **reader** conforms if it returns the expected result for every trigger vector under the file's `config`, and for every `selectionVectors` case when it implements section 6 rule 5. A **producer** conforms if every trigger it emits is accepted by a conforming reader under a configuration that lists its flow, and it meets section 7 rule 5. The vectors cover container Y only; a reader that implements it implements "the container" of this document. Each vector has `input`, `channel` (`scan`, `deeplink`, `paste`) and `expect` (`outcome`, then `reason` and `ui`, or `via`, `from`, `id`, `exp`, `flow`, `task`, `ignored`, and `callbackUrl` for legacy). Flows match by whole Type URI. `config.skew` is the clock allowance.

**What no vector can test:** section 6 rules 1 to 4 (confirmation, approval, what is displayed, the key), rule 5's fresh resolution and same-binding reply, rule 6's resolved-address check, rule 7 (the first request), rule 8, section 7 rules 2 to 5 and 7, DID verification itself, and what any phone does with a link. **They test a reader's parsing only, not Keyring's parsers.**

## 10. Change process and references

A new flow is a written proposal (Type URI, inviter, expiry, `from` list, vectors) with one named owner each for the Farm, the VTC portals and Keyring. A published Type URI is never edited. Owners and the home of this document are to be named (annex G, Q10; proposed home: a Trust Tasks task-force document, not agreed).
References: BCP 14 (RFC 2119, RFC 8174); RFC 3986; RFC 7493 (I-JSON); RFC 6761, 6762, 8375; RFC 8252 sections 7.1, 7.2, 8.1; WHATWG URL Standard (5.1); DIDComm v2.1 (Out Of Band Messages); Trust Tasks framework 0.7.0 draft (Type URI, Private and Unpublished Trust Task Specifications, Audience Binding, Compatibility Rules, Migrating Between Versions, Consumer Requirements, `threadId` and `parentThreadId`), `bindings/didcomm/0.2`, `bindings/https/0.3`, `bindings/push/0.1`, `trust-task-discovery/0.1` to `0.3` (all draft).
