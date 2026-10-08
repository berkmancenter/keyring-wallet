# One-scan trigger links: QR codes and links that start an exchange

**Status:** DRAFT proposal. Adopted by no one and implemented by no one. The link host `link.trustoverip.org` and the flow namespace of section 4 are proposals to Trust Over IP that have not been agreed. No phone has been tested with these links.
**Keywords:** MUST, MUST NOT, SHOULD and MAY are used as in BCP 14 (RFC 2119, RFC 8174), only when in capitals.
**Companions:** [conformance vectors](./keyring-qr-and-links.vectors.json) (section 7); [annex](./keyring-qr-and-links.annex.md) (non-normative: rationale, link hosting, device tests, alternatives, upstream fit, and one consumer's legacy format); [proposal to Trust Over IP](./keyring-qr-and-links.toip-proposal.md). "Trigger" is this document's own term; no upstream document defines it.

## 1. Model

An **inviter** shows a short text as a QR code or a link. A person carries it to a **consumer** (a wallet), by scanning it with a camera, opening it as a link or pasting it. The text is a **trigger**: it names whom to contact, a handle for the pending exchange, optionally when it stops being good, and optionally which flow it opens. It carries no task, endpoint, key, challenge or authorising secret.

The consumer treats every field as an untrusted hint, as the Trust Tasks push binding treats a wake-up payload (`bindings/push/0.1`: "A consumer MUST treat every field of the push payload as an untrusted hint"). It reads the text (section 3), asks the person, resolves the inviter's DID, picks a transport from the DID document and sends a signed first request over that transport (section 5). The rest of the exchange uses that transport; the text is not consulted again.

## 2. The trigger

| Field | Name | Required | Value |
|---|---|---|---|
| contact | `_from` | yes | `did:webvh:<scid>:<host>`, at most 256 characters. `<scid>` is 1 to 64 of `A-Za-z0-9` (DID resolution verifies it, not the reader). `<host>` meets the host rules (section 5 rule 6) as written, with no port, path or other segment. |
| handle | `_id` | yes | 22 to 128 of `A-Za-z0-9-_`. Opaque. It names the pending exchange and grants nothing. |
| expiry | `_exp` | if the flow requires it | UTC epoch seconds as a decimal integer: `0` or no leading zero, at most 2^53-1 (RFC 7493 section 2.2). |
| flow hint | `_type` | no | An absolute `https` URI with no query or fragment, ending in `/<MAJOR>.<MINOR>` (decimal, no leading zeros) (section 4). |

A reader ignores names it does not know, so an unsigned link can lose any optional field on the way. **A security-relevant field added later MUST come with a new flow version that a reader without the field rejects.**

## 3. The link and how to read it

**Form.** `https://<host>/<path>#_from=<DID>&_id=<handle>[&_exp=<n>][&_type=<URI>]`. The trigger is the fragment, so no server receives it: a client sends no fragment in a request (RFC 9110 section 7.1: the target URI "excludes the reference's fragment component") or in `Referer` (section 10.1.3). The host is not part of the format: a reader accepts the same fragment on any host that meets the host rules, and which wallet opens an `https` link is the operating system's choice (annex A). The proposed shared host is `link.trustoverip.org`. A consumer MAY also read the same text under a custom scheme it registers for its own scanner (an **alias scheme**), with the same host, path and fragment; that form is never the one shown to a camera.

**Parsing.** The fragment is the text after the first `#`; the query is the text after the first `?` that comes before the first `#`, up to that `#` (RFC 3986 sections 3.4 and 3.5). Both are parsed by WHATWG `application/x-www-form-urlencoded` parsing (URL Standard section 5.1): split on `&`, skip empty sequences, split each at the first `=`, replace `+` with a space, percent-decode once (a malformed `%` sequence stays as written) and decode as UTF-8 without BOM. Names are compared case-sensitively after decoding. No field value admits a space or `%`, so `+`, `%20` and a doubly encoded value fail their field's rule. Standard encoders (`URLSearchParams`, Python `urlencode`) write `did%3Awebvh%3A…`; raw colons and slashes read the same.

**Names.** The four **reserved names** are `_from`, `_id`, `_exp` and `_type`; nothing else in the fragment is read. Another name that begins with `_` is ignored and reported as `fragment.<name>`, once per occurrence, in document order. Any other name is ignored and not reported, whatever its value. The query is never read, so a parameter a tracker appends to it changes nothing.

**Reading order.** Stop at the first failure. The result does not depend on whether the text was scanned, opened as a link or pasted.

1. Trim leading and trailing ASCII whitespace (TAB, LF, FF, CR, SPACE). More than 1,536 code points: `too-long`.
2. The text does not begin with `<scheme>://` (RFC 3986 scheme, compared case-insensitively) where the scheme is `https`, `http` or an alias scheme: `not-ours`. No reserved name in the fragment: `query-form` if the query has one, else `not-ours`. Scheme `http`: `insecure-scheme`.
3. Any code point from U+0000 to U+0020, or U+007F, anywhere in the text, or a second `#`: `bad-grammar`.
4. The authority (after `://`, up to the first `/`, `?` or `#`) has userinfo or a port, or its host, after WHATWG host parsing as for an `https` URL, fails the host rules: `bad-authority`.
5. A reserved name occurs more than once: `repeated-param`.
6. `_from` absent: `missing-from`; not as in section 2: `bad-from`. `_id` absent or not as in section 2: `bad-id`. `_exp` present and not as in section 2: `bad-exp`.
7. `_type` present and not as in section 2: `bad-type`. Its value without the version segment is not a flow the consumer implements: `unknown-flow`. A version the consumer does not accept (section 4): `unsupported-version`.
8. The flow requires a listed contact and `<host>` is neither equal to nor a subdomain of a host on the consumer's list for that flow: `from-not-allowed`. The flow requires an expiry and `_exp` is absent: `missing-exp`.
9. `_exp + skew <= now`, where `skew` is the consumer's clock allowance (300 seconds in the vectors): `expired`. The inviter enforces the real expiry.
10. Accept, with `from`, `id`, `exp` (or null), `flow` and `task` (or null when there is no hint) and `ignored`.

A reader MAY check in another order if it always reports the same result.

**What a person sees.** These are the only messages. A reader MUST NOT say which field failed or whether a host was on a list.

| Outcome | Reasons | Message |
|---|---|---|
| `update` | `unknown-flow`, `unsupported-version` | "This code needs a newer version of the app." |
| `expired` | `expired` | "This code has expired. Get a new one." |
| `unreachable` | `no-common-transport` (section 5) | "This service can't be reached from your wallet." |
| `pass-on` | `not-ours` | None: the text goes to the consumer's other handlers, unchanged. |
| `invalid` | every other reason | "This code can't be used." |

After `unknown-flow` or `unsupported-version` a consumer MUST NOT try another flow, version or parser on the same text.

## 4. Flows and versions

A flow is named by a URI with the shape and comparison rules of a Trust Tasks Type URI (framework Working Draft 0.7.0, Type URI: it "identifies a specification by its whole string, never by its slug alone"). A consumer holds a list of the flow URIs it implements, without their version segment, and compares the hint's whole string against it. The same slug under another prefix is a different flow (`unknown-flow`).

Versions follow the framework's Compatibility Rules: MINOR is additive and "A `MAJOR` mismatch is never forward-compatible". A consumer MUST reject a MAJOR it does not implement and SHOULD accept a higher MINOR of a MAJOR it implements. A flow whose status is draft may break at a MINOR ("a breaking change to a `draft` artifact MAY be released as a `MINOR` increment"), so for a draft flow a consumer accepts only the MINORs it implements, and an inviter keeps accepting first requests under the previous version until consumers have shipped the new one (framework, Migrating Between Versions: "Update receivers first").

**Proposed flows.** The prefix `https://registry.trustoverip.org/dtg/flow/` is a proposal to Trust Over IP, not registered and not agreed (annex B). If another prefix is chosen, only that string changes. Until registration these are private identifiers in the framework's sense, and they do not claim `trusttasks.org` (framework, Private and Unpublished Trust Task Specifications: a private Type URI "MUST NOT be served from, or claim to identify a resource at, the `https://trusttasks.org/` domain").

| Flow | Type URI (version 0.1, draft) | Contact | Expiry | Contact must be on the consumer's list |
|---|---|---|---|---|
| claim a parked agent (VTA) | `https://registry.trustoverip.org/dtg/flow/vta-claim/0.1` | the claim service's DID (a service that is always running, not the parked agent) | required | yes |
| sign in to a community portal | `https://registry.trustoverip.org/dtg/flow/community-sign-in/0.1` | the community's DID | required, at most 300 seconds after the code is made | no; the consumer acts only for a community it already knows |

A flow identifier names a flow, not the Trust Task a wallet sends first. The tasks a flow uses are agreed between the inviter and the consumer and may change without changing the identifier. A published identifier is never edited; a change is a new version. A new flow is added by a written proposal that gives its Type URI, contact, expiry rule, list rule and vectors, with an owner on the inviter side and on each consumer that implements it.

## 5. After the trigger

1. **Confirm before any network activity.** Before any network activity, DID resolution included, the consumer shows only the contact's host, labelled unverified, and waits for a tap.
2. **Approve after verification.** The consumer resolves the contact DID and verifies the document (for `did:webvh`, the log verifies). If it cannot, it stops with `did-document-unverified` (outcome `invalid`) and sends nothing. After verification it shows verified details and sends nothing until the person approves.
3. **Unauthenticated text is never fact.** No trigger field other than the contact's host in rule 1 is shown as a statement of what the exchange is.
4. **Fresh key.** The first request is signed with a key made for this exchange and not used elsewhere.
5. **Transport from the document only.** Candidates are the services of the verified DID document whose `type` maps to a binding the consumer implements (`DIDCommMessaging` to the DIDComm binding, `TrustTaskHTTPS` to the HTTPS binding), matched on `type` and never on `id` (`bindings/https/0.3` section 6.2), and whose endpoint is an `https:` URL with no userinfo and a host that meets rule 6; any other service is not a candidate. The consumer's own preference order chooses among bindings; among candidates of one type the first in document order wins. The order of services of different types and DIDComm's `accept` (media types) do not choose. No candidate: `no-common-transport`; nothing is sent and the consumer does not fall back to another path or to anything in the text. The request and its reply use the chosen binding. The document is resolved afresh for each exchange.
6. **Host rules.** These apply to the link host, the contact's host and every endpoint host. A host is a DNS name of at least two labels, at most 253 characters, with no trailing dot; each label is 1 to 63 of lowercase `a-z`, `0-9` and `-`, not beginning or ending with `-`; the last label is not all digits. It is not an IP address in any form, including the hexadecimal, octal and single-number IPv4 forms that WHATWG host parsing turns into an address, and not `localhost`, a name under `localhost` or `local` (RFC 6761, RFC 6762) or under `home.arpa` (RFC 8375). A consumer SHOULD also refuse an endpoint whose resolved address is loopback, link-local or private.
7. **The first request** is a Trust Task document with `issuer` the consumer's DID for this exchange, `recipient` the contact DID (framework, Audience Binding: a document carrying a `proof` "MUST also carry an in-band `recipient` member" unless its specification is a bearer specification), a unique `id`, and the handle as `parentThreadId`. The framework defines `parentThreadId` as "the `threadId` of the exchange that contains this one"; this document treats the invitation as that exchange, and `bindings/didcomm/0.2` section 3.1 maps the member to DIDComm `pthid`. `parentThreadId` "carries no normative validation semantics", so the inviter looks the handle up and decides by its own policy.
8. **No hint.** The consumer MAY ask the inviter which task types it supports with `trust-task-discovery` (draft). Discovery does not say which type a handle opens, so a consumer MAY refuse an unhinted trigger it cannot place (outcome `invalid`).

## 6. Security and producer requirements

1. **A trigger confers no authority.** Acting on it is the consumer's decision. Granting anything is the inviter's, on the signed request (framework, Consumer Requirements: "Not treat identity or document-proof validation as authorization").
2. **A handle alone is a bearer** wherever the inviter treats possession as authority, and proof of possession by the requester's key does not change that when the requester chooses its own key. An inviter that treats a handle that way MUST make it single use and short lived.
3. **Nothing is spent on a GET.** A link preview, mail scanner or browser that fetches the link MUST NOT consume the handle; the handle is spent, if at all, by the signed request. A trigger never causes a fetch by reference.
4. **The consumer does not leak it.** A consumer MUST NOT log the text, the handle or the contact, or put them in an error, notification or analytics, or send them anywhere but to the inviter in the first request. It logs at most the class of a link, and redacts before any logger runs.
5. **Producers.** An inviter (a) MUST make the handle at least 128 bits from a CSPRNG, written as unpadded base64url (22 characters); (b) MUST set `_exp` no later than its own lifetime for the handle; (c) MUST put the trigger in the fragment, never in the query, with `_from` and `_id`, and `_exp` and `_type` where used, each once; (d) MUST serve any page that carries or shows the link with `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, load no third-party scripts there, and never copy the fragment into a request, a log or a script that sends it; (e) MUST give any redirect from such a page an explicit fragment, possibly empty, because otherwise the client re-applies the original fragment to the target (RFC 9110 sections 10.2.2 and 17.11); (f) MUST NOT offer a custom-scheme link for a handle that can be spent, because any app can register a scheme (RFC 8252 section 8.1); (g) MUST publish in the contact's DID document a service the consumer can select (section 5 rule 5).

## 7. Conformance

A **reader** conforms if it returns the expected result for every vector in `vectors` under the file's `config`, and, if it implements section 5 rule 5, for every vector in `selectionVectors`. A **producer** conforms if every trigger it emits is accepted by a conforming reader configured with its flow, and it meets section 6 rule 5. Each vector has `id`, `input`, `channel` and `expect`; an accepted result has `outcome`, `via`, `from`, `id`, `exp`, `flow`, `task` and `ignored`, and a rejected one has `outcome`, `reason` and `ui`. The file's `legacyVectors` belong to the annex, not to this section.

No vector can test section 5 rules 1 to 4, 7 and 8, the resolved-address check of rule 6, fresh resolution and same-binding replies in rule 5, section 6 rules 1 to 5, DID verification, or what any phone does with a link. The vectors test a reader's parsing, not any wallet's code.

## 8. References

BCP 14 (RFC 2119, RFC 8174); RFC 3986 sections 3.4, 3.5; RFC 6761; RFC 6762; RFC 7493 section 2.2; RFC 8252 section 8.1; RFC 8375; RFC 9110 sections 7.1, 10.1.3, 10.2.2, 17.11; WHATWG URL Standard (section 5.1, host parsing); Trust Tasks framework Working Draft 0.7.0 (Type URI; Compatibility Rules; Migrating Between Versions; Private and Unpublished Trust Task Specifications; Audience Binding; Consumer Requirements; `parentThreadId`); `bindings/didcomm/0.2`, `bindings/https/0.3`, `bindings/push/0.1`, `trust-task-discovery/0.3` (all draft). Where each was read is in annex G.
