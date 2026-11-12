# One-scan trigger links: QR codes and links that start an exchange

**Status:** DRAFT proposal. Implemented by no one. Tracks the merged trigger-link chapter of the VTI specification (`trustoverip/dtgwg-vti-spec`, `spec/07a-links.md`, read on `main` at `a8157ea3` on 2026-11-09, requirements VTI-LNK-001 to 131), which carries the same rules as normative text for VTI. Each rule below names the VTI requirement it matches; where this document and the chapter differ, the chapter wins. This document was written before `dtgwg-vti-spec` issue 86 (a person-to-person shared-connect flow, a per-flow size budget and a registry entry) and predates it. The outcomes of that issue are pending, and nothing here specifies a shared-connect flow, an `inv` field or a `_label` field. The one size budget below (section 6 rule 5 (d), VTI-LNK-081) is expected to become a budget per flow. The link host `link.trustoverip.org` is a proposal to Trust Over IP that has not been agreed. No phone has been tested with these links.

**Principles.**
1. **Modular.** The format names whom to contact and which flow to start. It does not choose the protocol of the exchange: each flow states its first request. So it can carry flows built on Trust Tasks, DIDComm, OpenID or anything else, and it can later be contributed for use beyond VTI and Keyring.
2. **No central party.** Anyone may host trigger links on a domain they control, and define flows under URIs they control.
   - Taking part needs no registry, no shared link host and no namespace owner.
   - Flow identifiers are whole URIs, so two owners' flows never collide.
   - The path form gives every host's own flows the same shorthand.
   - A shared link host is a convenience for camera scans, not a requirement.
3. **Adoption is kept apart.** What VTI, Keyring and the VTA Farm choose for themselves is in section 8 and in the plan, never presented as a requirement of the format. Their choices are deliberately narrower, to keep their own stack simple.

**Scope: a general standard, and what we adopt.**
- **The general standard.** This document proposes a QR code and link format for any wallet and any inviter, in any ecosystem, written so that it can later be contributed for wider use. It is sections 1 to 7.
- **What VTI and Keyring adopt.** Section 8 holds VTI's choices: the Trust Task first request and VTI's registry flows (`sign-in`, `vta-claim` and `step-up`), of which Keyring and the VTA Farm adopt the first two. They are examples of the format, not part of it. What Keyring and the Farm choose for themselves, which is deliberately narrower, is in the plan ([`one-scan-and-vtc-sign-in-plan.md`](../plans/one-scan-and-vtc-sign-in-plan.md), section 1.3), not here.

**Keywords:** MUST, MUST NOT, SHOULD and MAY are used as in BCP 14 (RFC 2119, RFC 8174), only when in capitals.

**Companions:**
- [conformance vectors](./keyring-qr-and-links.vectors.json) (section 7);
- [annex](./keyring-qr-and-links.annex.md) (non-normative: link hosting, device tests, rendering guidance, rationale, alternatives, and upstream fit);
- [proposal to Trust Over IP](./keyring-qr-and-links.toip-proposal.md) (the shared link host).

**Terms.** "Trigger link" is the normative term, as in the VTI chapter. "One-scan" is informal shorthand for the goal (one scan opens the wallet the person already uses): it is not a defined term, and it appears in titles only. `keyring://vti/invitation` is a different Keyring link and is not a trigger link. This document says "consumer" where the chapter says "reader"; they are the same role.

## 1. Model

An **inviter** shows a short text as a QR code or a link. A person carries it to a **consumer** (a wallet; the chapter's "reader") by scanning it with a camera, opening it as a link, or pasting it. The text is a **trigger**: it names whom to contact, a handle for the pending exchange, optionally when it stops being good, and optionally which flow it opens. It carries no task, endpoint, key, challenge or authorising secret. A **producer** is anything that emits a trigger on the inviter's behalf.

The consumer treats every field as an untrusted hint, as the Trust Tasks push binding treats a wake-up payload (`bindings/push/0.1`: "A consumer MUST treat every field of the push payload as an untrusted hint"). It:
1. reads the text (section 3);
2. shows the person who claims to be asking;
3. resolves and verifies the inviter's DID;
4. picks a transport from the DID document;
5. after the person approves, sends the first request the flow defines over that transport (section 5).

The rest of the exchange uses that transport, and the text is not consulted again.

## 2. The trigger

| Field | Name | Required | Value |
|---|---|---|---|
| contact | `_from` | yes | A VID: a DID of any method, or another verifiable identifier (VTI-LNK-030). A value containing `/@` is reserved for agent names (VTI-LNK-032). |
| handle | `_id` | yes | 16 to 32 bytes as unpadded base64url (`A-Za-z0-9-_`), so 22 to 43 characters. Lengths 25, 29, 33, 37 and 41 cannot occur and are malformed. The unused bits of the last character are zero, so each handle has one spelling (VTI-LNK-033). Opaque: it names the pending exchange and grants nothing. |
| expiry | `_exp` | if the flow requires it | UTC epoch seconds as a decimal integer: `0`, or with no leading zero, and at most 2^53−1 (VTI-LNK-036; RFC 7493 section 2.2). |
| flow | `_type` | no | An absolute `https` URI with no query or fragment, whose last segment is `<MAJOR>.<MINOR>` (decimal, no leading zeros). Or the **path form** of section 4: a path starting with exactly one `/`, resolved against the link's own host (VTI-LNK-040). |

**`_from` in detail.** The consumer percent-decodes `_from` once and checks it against the syntax of its identifier type (VTI-LNK-030). Then:
- A value containing `/@` is an agent name (`example.com/@alice`), reserved until a later revision defines it. A consumer refuses it with `unsupported-vid`, and a producer MUST NOT emit one (VTI-LNK-032). No valid DID contains `/`, so no DID is mistaken for an agent name.
- A value beginning `did:` MUST meet the DID syntax (W3C DID 1.0, section 3.1). If the consumer supports the method, the value MUST also meet that method's syntax. A failure of either is `bad-from`.
- A DID of a method the consumer does not support is `unsupported-vid`. So is any other value that is not empty, because a consumer cannot tell a verifiable identifier type it does not know from one that does not exist, and a newer consumer may support it.
- An empty value is `bad-from`.

The host rules (section 5 rule 6) bind the contact's host before any network contact, not at reading. A `did:web` with an encoded port (`did:web:example.com%3A8443`) therefore reads, and is then refused when resolved.

A reader ignores names it does not know, so an unsigned link can lose any optional field on the way. **A security-relevant field added to a flow MUST come with a new version of the flow that a reader without the field refuses** (VTI-LNK-045).

## 3. The link and how to read it

**Form.** `https://<host>/<path>#_from=<VID>&_id=<handle>[&_exp=<n>][&_type=<flow>]`.

A producer emits it as an `https` URL with `_from` and `_id`, and `_exp` and `_type` where used, each exactly once, in the fragment, and none of them in the query (VTI-LNK-010).

The trigger is the fragment, so no server receives it. A client sends no fragment in a request (RFC 9110 section 7.1: the target URI "excludes the reference's fragment component"), or in `Referer` (section 10.1.3).

**Any host.** The host is not part of the format. A consumer accepts the same fragment on any host that meets the host rules (VTI-LNK-012). Which wallet opens an `https` link from a camera is the operating system's choice (annex A). The proposed shared host is `link.trustoverip.org`, with the path `/t`. It is a convenience, not a requirement.

**Alias scheme.** A consumer MAY also read the same text under a custom scheme it registers for its own scanner (an **alias scheme**), with the same host, path and fragment. A producer MUST NOT emit a trigger under a custom scheme (VTI-LNK-013).

**Parsing.** The fragment is the text after the first `#`. The query is the text after the first `?` that comes before the first `#`, up to that `#` (RFC 3986 sections 3.4 and 3.5). Both are parsed by WHATWG `application/x-www-form-urlencoded` parsing (URL Standard section 5.1):
- split on `&`, and skip empty sequences;
- split each at its first `=`;
- replace `+` with a space;
- percent-decode once (a malformed `%` sequence stays as written);
- decode as UTF-8 without BOM.

Names are compared case-sensitively after decoding. Some consequences:
- A raw `=` inside a value reads the same as `%3D`. An unencoded `&` or `#` ends the value.
- Raw colons and slashes read the same as their encoded forms. Standard encoders (`URLSearchParams`, Python `urlencode`) write `did%3Awebvh%3A…`, and both read the same.

**Names.**
- The four **reserved names** are `_from`, `_id`, `_exp` and `_type`. Nothing else in the fragment is read, and the query is never read (VTI-LNK-011). So a parameter that a tracker or a mail system appends, in either place, changes nothing.
- Another name that begins with `_` is ignored and reported as `fragment.<name>`, once per occurrence, in document order.
- Any other name is ignored and not reported, whatever its value.

**Reading order** (VTI-LNK-020). Stop at the first failure. The result does not depend on whether the text was scanned, opened as a link or pasted.

1. Trim leading and trailing ASCII whitespace (TAB, LF, FF, CR, SPACE). More than 1,536 code points: `too-long`.
2. The text does not begin with `<scheme>://` (an RFC 3986 scheme, compared case-insensitively) where the scheme is `https`, `http` or an alias scheme: `not-ours`. No reserved name in the fragment: `query-form` if the query has one, otherwise `not-ours`. Scheme `http`: `insecure-scheme`.
3. Any code point from U+0000 to U+0020, or U+007F, anywhere in the text, or a second `#`: `bad-grammar`.
4. The authority (after `://`, up to the first `/`, `?` or `#`) has userinfo or a port, or its host, after WHATWG host parsing as for an `https` URL, fails the host rules: `bad-authority`.
5. A reserved name occurs more than once: `repeated-param`.
6. `_from` absent: `missing-from`. Not a well-formed contact (section 2): `bad-from`. A contact form the consumer does not support: `unsupported-vid`.
7. `_id` absent or not as in section 2: `bad-id`. `_exp` present and not as in section 2: `bad-exp`.
8. `_type` present and not as in section 2: `bad-type`. A path form is resolved as in section 4. A resolved flow that names a flow the consumer implements, but on a different host: `wrong-host`. A resolved flow that, without its version segment, is not a flow the consumer implements: `unknown-flow`. A version the consumer does not accept (section 4): `unsupported-version`.
9. The flow does not allow the contact (section 4), such as a contact no route of the contact rule (section 8.3) can qualify: `from-not-allowed`. The flow requires an expiry and `_exp` is absent: `missing-exp`.
10. `_exp + 60 <= now`, by the consumer's clock: `expired`. The 60 seconds absorb phone clock error. The inviter still decides expiry by its own clock.
11. Accept, with `from`, `id`, `exp` (or null), `flow` and `task` (or null when there is no hint), and `ignored`.

A consumer MAY check in another order if it always reports the same result.

**What a person sees** (VTI-LNK-021). These are the only messages. A consumer MUST NOT say which field failed, or whether a contact was on a list.

| Outcome | Reasons | Message |
|---|---|---|
| `update` | `unsupported-vid`, `unknown-flow`, `unsupported-version` | "This code needs a newer version of the app." |
| `expired` | `expired`, `step-up-gone` (VTI-LNK-129) | "This code has expired. Get a new one." |
| `unreachable` | `no-common-transport` (section 5) | "This service can't be reached from your wallet." |
| `pass-on` | `not-ours` | None. The text goes to the consumer's other handlers, unchanged. |
| `invalid` | every other reason | "This code can't be used." |

After `unsupported-vid`, `unknown-flow` or `unsupported-version`, a consumer MUST NOT try another flow, version or parser on the same text (VTI-LNK-022).

- `unsupported-vid` maps to `update`, because a newer wallet may support that kind of identifier.
- `from-not-allowed` maps to `invalid`, because no update changes a flow's rule.
- `wrong-host` maps to `invalid`, because telling the person to update the app would be wrong.
- `domain-not-linked` (VTI-LNK-123, section 8.3) maps to `invalid`, because the fault is the service's, and no update to the consumer repairs it.
- The other reasons the VTI flows add after reading (`did-document-unverified`, `no-portal-service`, `wrong-origin`, `not-in-records`, `not-the-subject`, `binding-mismatch`) are all `invalid`, as the chapter's table (VTI-LNK-021) gives "every other reason".

## 4. Flows and versions

**Anyone may define a flow.** A flow is named by an absolute `https` URI whose last segment is its version, under a host its owner controls. No registry is required to define one. A flow names the purpose of an exchange, not the request a consumer sends first, and each flow states its first request (section 5 rule 7). A flow is identified by its whole string, never by its final name alone, so the same name under another host is a different flow. This follows the Trust Tasks Type URI rule (framework Working Draft 0.7.0: it "identifies a specification by its whole string, never by its slug alone").

A consumer holds the list of flow URIs it implements, without their version segments. A flow MAY restrict which contacts it accepts, for example by identifier type (VTI-LNK-031). A contact the flow does not allow is `from-not-allowed`.

**Path form: shorthand for a flow on the link's own host** (VTI-LNK-040 to 043).
- **Syntax.** A `_type` value that starts with exactly one `/` is a path form. It uses only `A-Za-z0-9-._~/`, has no `.` or `..` segment, no query, fragment or percent-encoding, and its last segment is a version. Any other path is `bad-type`, never normalised into shape.
- **Resolution.** A reader resolves it against `https://` and the link's host, lowercased, whatever the link's scheme (RFC 3986 section 5). It identifies the flow by the resolved URI, compared as a whole string.
- **Producers.** A producer MUST use the path form when the flow URI is on the link's own host, and MUST use the absolute form otherwise.
- **Equal for every host.** Any party that hosts its own links and its own flows gets the same shorthand.
- **Wrong host.** A path that names a flow the reader implements, but on another host, is `wrong-host`.

**Versions** (VTI-LNK-044, 045).
- A consumer MUST refuse a MAJOR version it does not implement, and SHOULD accept a higher MINOR of a MAJOR it implements.
- For a flow whose status is draft, a consumer accepts only the MINOR versions it implements. The framework allows "a breaking change to a `draft` artifact" as "a `MINOR` increment".
- An inviter keeps accepting first requests under the previous version until consumers have shipped the new one (framework, Migrating Between Versions: "Update receivers first").
- A published flow identifier MUST NOT be edited. A change is a new version.

## 5. After the trigger

1. **Confirm before any network activity** (VTI-LNK-050, 051).
   - Before any network activity, DID resolution included, the consumer shows who the contact claims to be, labelled unverified, and waits for the person to continue.
   - For a contact with a domain, it shows the domain, followed by the path where the identifier has one: `dids.example.org/farm-auth` for `did:webvh:<SCID>:dids.example.org:farm-auth`.
   - For a contact without a domain, it shows its own label for that contact if it has one, and otherwise says the contact has no domain to show. For a `did:scid:vh:1` identifier it shows the host and path of its `src` parameter.
   - **Exception for known contacts.** For a flow that acts only for contacts already in the consumer's own records, the consumer MAY resolve such a contact before the person continues. The host contacted is then one the person chose when the record was made.
   - **Exception for a page activation.** A consumer that received the trigger from the person's activation of a link on a page (rule 9) MAY also resolve and verify the contact before the person continues, for any flow except `vta-claim` (VTI-LNK-051, 111). A trigger read by a camera or pasted MUST NOT be resolved early on that ground.
   - **What early resolution fetches.** Only what resolving and verifying the DID document needs. The domain-linkage fetch of route B (section 8.3) is not part of resolution, and a consumer MUST NOT make it before the person continues, on any ground (VTI-LNK-051, 122).
2. **Approve after verification** (VTI-LNK-052). The consumer resolves the contact's DID document and verifies it (for `did:webvh`, the log verifies; for `did:scid:vh:1`, the log verifies as for `did:webvh`, through the source the contact names) before sending anything. If it cannot, it stops with `did-document-unverified` (outcome `invalid`) and sends nothing. After verification it shows the verified details, and sends nothing until the person approves, except as VTI-LNK-106 allows for `sign-in` (section 8.2). The consumer sends nothing to the contact's services, and fetches no endpoint the document lists, before then; the route B fetch of section 8.3 is the one fetch made after the person continues.
3. **Unauthenticated text is never fact** (VTI-LNK-052). No field of the trigger other than the contact is shown as a statement of what the exchange is.
4. **Fresh key** (VTI-LNK-057). A first request the consumer signs is signed by a key made for this exchange and used for no other exchange. The exception is a flow that defines a signature by an identifier the person chooses when approving. Such a flow MUST state why the exchange needs an identifier the person already uses, and the consumer MUST tell the person, before approval, which identifier the inviter will see.
5. **Transport from the document only** (VTI-LNK-053).
   - **Candidates.** The candidates are the services of the verified DID document that meet three conditions:
     - their `type` maps to a binding the consumer implements, for example `DIDCommMessaging` to the DIDComm binding or `TrustTaskHTTPS` to the Trust Tasks HTTPS binding. The match is on `type`, never on `id` (`bindings/https/0.3` section 6.2);
     - their endpoint is an `https` URL with no userinfo, or a DID;
     - their endpoint host, where it has one, meets rule 6.

     Any other service is not a candidate.
   - **Choosing.** The consumer's own preference order chooses among bindings. Among candidates of one type, the first in document order wins. The order of services of different types, and DIDComm's `accept`, do not choose.
   - **No candidate.** The result is `no-common-transport`. Nothing is sent, and the consumer does not fall back to another path or to anything in the text.
   - **Replies and freshness.** The request and its reply use the chosen binding. The document is resolved afresh for each exchange.
6. **Host rules** (VTI-LNK-060, 061). These apply to the link host, to the host of a contact that has one (for a `did:scid:vh:1` identifier, the host of its `src` parameter after percent-decoding), and to every endpoint host the consumer contacts.
   - A host is a DNS name of at least two labels and at most 253 characters, with no trailing dot.
   - Each label is 1 to 63 characters of lowercase `a-z`, `0-9` and `-`, not beginning or ending with `-`. The last label is not all digits.
   - It is not an IP address in any form, including the forms WHATWG host parsing turns into an address.
   - It carries no port.
   - It is not `localhost`, a name under `localhost` or `local` (RFC 6761, RFC 6762), or a name under `home.arpa` (RFC 8375).
   - A consumer SHOULD also refuse an endpoint whose resolved address is loopback, link-local or private.
7. **The first request is the flow's choice** (VTI-LNK-057). Each flow states the request a consumer sends first.
   - It is sent only after rule 2's approval, and only over the transport rule 5 chose.
   - It carries the handle, so the inviter can find the pending exchange.
   - A flow MAY use the Trust Task first request (section 8.1), or define its own, for example a DIDComm or OpenID request. The format requires no particular protocol; VTI's registry flows all use the Trust Task first request (VTI-LNK-054, section 8.1).
8. **No hint** (VTI-LNK-055). The consumer MAY ask the inviter what it supports, through a discovery mechanism of a protocol both implement; for Trust Tasks, that is `trust-task-discovery` (draft). Discovery does not say which flow a handle opens, so a consumer MAY refuse a trigger it cannot place (outcome `invalid`).
9. **A link activated on a page** (VTI-LNK-056). A consumer that receives a trigger from the activation of a link on a page, such as a browser extension, MUST record the origin of that page at activation, and MUST NOT act on an activation the person did not make. A flow may use the recorded origin; `sign-in` refuses a page that is not the portal (VTI-LNK-105), and may take the activation as the person continuing (VTI-LNK-106; section 8.2).

## 6. Security and producer requirements

1. **A trigger confers no authority** (VTI-LNK-070). Acting on it is the consumer's decision. Granting anything is the inviter's, on the first request (framework, Consumer Requirements: "Not treat identity or document-proof validation as authorization").
2. **A handle alone is a bearer** wherever the inviter treats possession as authority (VTI-LNK-071). Proof of possession by the requester's key does not change that when the requester chooses its own key. An inviter that treats a handle that way MUST make it single use and short lived.
3. **Nothing is spent on a GET** (VTI-LNK-072). Fetching a trigger MUST NOT spend its handle. A handle is spent, if at all, by the first request. A trigger never causes a fetch by reference.
4. **The consumer does not leak it** (VTI-LNK-073). A consumer MUST NOT log the text, the handle or the contact. It MUST NOT put them in an error, a notification or analytics, or send them anywhere but to the inviter in the first request. It logs at most the outcome or class of a link, and redacts before any logger runs.
5. **Producers.** A producer:
   - (a) MUST generate the handle's bytes from a cryptographically secure random source (VTI-LNK-034). An inviter compares a handle as a string (VTI-LNK-035).
   - (b) MUST set `_exp` no later than the inviter's own lifetime for the handle (VTI-LNK-037).
   - (c) MUST emit only ASCII (VTI-LNK-080), and MUST percent-encode `&`, `=`, `#` and `%` inside a value.
   - (d) MUST NOT emit a trigger whose `https` form exceeds 251 bytes where the code is rendered at QR error-correction level M, or 177 bytes where it is rendered at level Q (VTI-LNK-081). These are the capacities of a version 11 QR code. A flow's field limits follow from them. This is a single budget for every flow; it is expected to become a budget per flow once `dtgwg-vti-spec` issue 86 settles. The limit binds producers, not readers, so a valid link stays valid after something appends to it.
   - (e) MUST serve any page that carries or shows the trigger with `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. It MUST load no third-party scripts there, and never copy the fragment into a request, a log, or a script that sends it (VTI-LNK-082).
   - (f) MUST give any redirect from such a page an explicit fragment, possibly empty, because otherwise the client re-applies the original fragment to the target (RFC 9110 sections 10.2.2 and 17.11; VTI-LNK-083).
   - (g) MUST NOT show a trigger whose link host is the domain of the page showing it, because iOS opens such a link in the browser (VTI-LNK-084).
   - (h) MUST NOT emit a custom-scheme link, because any app can register a scheme (RFC 8252 section 8.1; VTI-LNK-013).
   - (i) MUST publish in the contact's DID document a service a consumer can select under section 5 rule 5 (VTI-LNK-085).
   - (j) SHOULD make a QR code also a link to the same `https` text, so that a person whose wallet is on the same device can click or tap it (VTI-LNK-086).
6. **Link hosts** (VTI-LNK-090 to 092). Any party may run a link host.
   - It MUST publish platform association files that claim only its trigger path, so that a flow identifier on the same host opens its page and not a wallet.
   - It MUST serve, at its trigger path, a page for a person with no wallet. That page MUST NOT read the fragment, send it anywhere, or redirect to a custom scheme.
   - It SHOULD serve, at each flow identifier on it, a page that describes the flow.
   - Annex A covers hosting.

## 7. Conformance

**Readers.** A reader conforms if it returns the expected result for every vector in `vectors` under the file's `config`. If it implements section 5 rule 5, it must also do so for every vector in `selectionVectors`.

**Producers.** A producer conforms if every trigger it emits is accepted by a conforming reader configured with its flow, and it meets section 6 rule 5.

**Vector format.**
- Each vector has `id`, `input`, `channel` and `expect`.
- An accepted result has `outcome`, `via`, `from`, `id`, `exp`, `flow`, `task` and `ignored`.
- A rejected result has `outcome`, `reason` and `ui`.

**What no vector can test:**
- section 5 rules 1 to 4 and 7 to 9, and everything in section 8.2 and 8.3 that needs resolution, a page, the consumer's records or a fetch: the routes of the contact rule, `domain-not-linked`, `no-portal-service`, `wrong-origin`, `not-in-records`, `step-up-gone`, `not-the-subject` and `binding-mismatch`;
- the resolved-address check of rule 6, and the host rules on a contact's host, which apply at resolution;
- fresh resolution, and same-binding replies, in rule 5;
- section 6;
- DID verification;
- what any phone does with a link.

The vectors do test the reader-side part of the contact rule that needs no resolution: a contact whose method cannot list services (`did:key`) is `from-not-allowed` for `sign-in` and `vta-claim`, and the `step-up` flow reads like the others.

The vectors test a reader's parsing, not any wallet's code.

## 8. VTI's use of the format, adopted by Keyring and the VTA Farm

This section is not part of the general standard. It records what the VTI specification adopts on top of the format, and what Keyring and the VTA Farm therefore implement. It keeps their own stack simple: one kind of first request, and a small set of flows. Another party may adopt the format without any of it.

### 8.1 The Trust Task first request

One option a flow may adopt under section 5 rule 7. For every flow in the VTI registry (VTI-LNK-046), the first request is a Trust Task document (VTI-LNK-054), with:
- `issuer`: a `did:key` identifier for a fresh Ed25519 key, generated by the consumer for this exchange and used for no other exchange (VTI-LNK-054; the general fresh-key rule is VTI-LNK-057, section 5 rule 4);
- `recipient`: the contact (framework, Audience Binding: a document carrying a `proof` "MUST also carry an in-band `recipient` member" unless its specification is a bearer specification);
- a unique `id`;
- the handle as `parentThreadId`;
- a signature by the issuer's key.

The consumer sends it only after the person approves, and only over the transport chosen under VTI-LNK-053 (VTI-LNK-054).

The framework defines `parentThreadId` as "the `threadId` of the exchange that contains this one". This document treats the pending exchange named by the handle as that exchange, and `bindings/didcomm/0.2` section 3.1 maps the member to DIDComm `pthid`. `parentThreadId` "carries no normative validation semantics", so the inviter looks the handle up and decides by its own policy.

**Scope of the fresh `did:key` rule.** VTI-LNK-054 is stated for the flows in the VTI registry, and no flow in the registry uses the exception of VTI-LNK-057 for an identifier the person chooses. This document does not generalise it. Whether a flow outside the registry, such as the shared-connect flow under discussion in `dtgwg-vti-spec` issue 86, would need an identifier the person already uses is open there, and is not decided here.

### 8.2 The flows VTI defines

The VTI specification governs flows under `https://link.trustoverip.org/vti/flow/` (VTI-LNK-046). All three use the Trust Task first request (section 8.1). Their full requirements are VTI-LNK-100 to 107 for `sign-in`, VTI-LNK-110 to 117 for `vta-claim`, and VTI-LNK-125 to 131 for `step-up`. Keyring and the VTA Farm adopt `sign-in` and `vta-claim`; the plan does not schedule `step-up`.

The 300 second expiry limit is stated for `sign-in` (VTI-LNK-100), `vta-claim` (VTI-LNK-110) and `step-up` (VTI-LNK-125, which also bounds it by the hand-off's `expiresAt`), and this document does not generalise it. Expiry rules for other flows are per flow, and a per-flow expiry for flows beyond these is pending `dtgwg-vti-spec` issue 86.

| Flow | Identifier (version 0.1, draft) | Contact | Expiry | Contact rules |
|---|---|---|---|---|
| sign in to a service's portal | `https://link.trustoverip.org/vti/flow/sign-in/0.1` | the service's VID: a VTC, or another service offering sign-in, such as a DID hosting service | required, at most 300 seconds after the code is made (VTI-LNK-100) | The consumer acts only for a service already in its records (VTI-LNK-101). The contact must qualify under the contact rule (section 8.3), and its verified document must list a `SignInPortal` service (VTI-LNK-102), so a `did:key` is `from-not-allowed` (VTI-LNK-102, 118). |
| claim a VTA from a VTA Farm | `https://link.trustoverip.org/vti/flow/vta-claim/0.1` | the Farm's VID | required, at most 300 seconds after the code is made (VTI-LNK-110) | A first contact: neither early-resolution exception of section 5 rule 1 applies (VTI-LNK-111). The contact must qualify under the contact rule, and its verified document must list the Farm's claim service (VTI-LNK-112), so a `did:key` is `from-not-allowed` (VTI-LNK-112, 118). |
| approve one operation a delegated key was refused | `https://link.trustoverip.org/vti/flow/step-up/0.1` | the VID of the service that refused the operation | required, no later than the hand-off's `expiresAt` and at most 300 seconds after the link is made (VTI-LNK-125) | The consumer acts only for a service already in its records, and never offers to add one (VTI-LNK-128). The contact rule does not apply: the service qualified when the person added it. |

**`sign-in`.**
- **Handle.** A VTC SHOULD use a 16-byte handle (VTI-LNK-103).
- **Names shown.** Before the first request the consumer shows the name it holds for the contact in its own records, and the portal origin from the verified document, never a name taken from the link. It flags a signed reply whose name differs from its record before the person approves anything further (VTI-LNK-104).
- **Same-device click.** A consumer that recorded the origin of the page the link was activated from (section 5 rule 9) compares it with the portal's origin in the verified document, and on a difference stops with `wrong-origin` (outcome `invalid`) and sends nothing (VTI-LNK-105).
- **Activation as approval.** Where that origin matched, the service is in the consumer's records, and the records hold exactly one identity for it, the consumer MAY take the activation as the person continuing and approving the first request. With more than one identity it lets the person choose. It still shows the service's name and portal origin before the person approves the sign-in itself (VTI-LNK-106).
- **Number entry.** A portal that asks the person to enter a number SHOULD mark the element showing it with `data-oob-request-id` (the handle) and `data-oob-match-number`. A consumer that received the link from the activation on that page MAY read the number from that page, for that handle, while the page's origin is still the one it recorded, and MUST NOT send anything to the page. If it finds no number, or a signed reply gives a name that differs from its records, it asks the person to enter it (VTI-LNK-107).

**`vta-claim`.**
- **First request.** The issuer of the first request is the identifier the claim makes an administrator of the VTA. The consumer MUST NOT use an identifier it already uses for another VTA or exchange (VTI-LNK-113).
- **First claim wins.** A Farm accepts at most one claim per handle, atomically, and does not treat a request without a valid signed first request as a claim (VTI-LNK-114).
- **Claim check.** After a successful claim a Farm SHOULD show a claim check on the claim page, the consumer SHOULD show the same one computed from its own identifier, and the Farm SHOULD hold the VTA in reservation until the person confirms they match (VTI-LNK-115).
- **Handle.** A Farm SHOULD use a 16-byte handle (VTI-LNK-116).
- **Adding an administrator.** A Farm that uses `vta-claim` to add an administrator to a running VTA MUST show the code only to a signed-in account that already controls the VTA, and MUST apply the claim check before the identifier is written (VTI-LNK-117).

**`step-up`.**
- **The link's producer.** It is the party that sent the refused operation, from the hand-off the service gave it. It shows the link only to the person the step-up's subject is, and does not present the inline step-up request as something the person approves (VTI-LNK-127). A service issues a handle only in the `details.stepUpHandoff` of a refusal for an operation bound under VTI-APV-015, answers each handle at most once, and answers every handle it cannot answer with the same refusal (VTI-LNK-126).
- **First request.** `auth/step-up/requests/show/0.1`, carrying the handle as `handle` as well as `parentThreadId`. A consumer that receives the refusal for an unanswerable handle stops with `step-up-gone` (outcome `expired`) (VTI-LNK-129). A contact not in the consumer's records is `not-in-records` (outcome `invalid`), and nothing is sent (VTI-LNK-128).
- **On the response.** The consumer verifies the returned step-up request as a Trust Task document in its own right, stops with `not-the-subject` if its records hold no identity for the service that is the subject, and recomputes the binding from the returned operation, stopping with `binding-mismatch` if it differs (VTI-LNK-130). If the person approves, the consumer sends the answer as the subject to the contact, and does not pass the evidence or the answer to the party that made the link (VTI-LNK-131).

### 8.3 The contact rule for `sign-in` and `vta-claim`

The contact rule decides which DIDs `sign-in` and `vta-claim` accept as a contact. It qualifies a contact by what the consumer can prove about it, not by its DID method. The **contact's origin** is, for `sign-in`, the portal's origin (VTI-LNK-102), and, for `vta-claim`, the origin of the claim service's endpoint (VTI-LNK-112).

- **The rule** (VTI-LNK-118). A contact qualifies only if the consumer resolves its DID with a method it supports and verifies the document (section 5 rule 2), the document lists the service the flow requires, and the contact qualifies through route A or route B. A consumer with no resolver for the method stops with `unsupported-vid` (outcome `update`), not `from-not-allowed`. It refuses with `from-not-allowed` only a contact no route can qualify, such as a method whose documents cannot list services (`did:key`). It refuses a `did:peer` contact with `from-not-allowed` by either route.
- **Route A, host-named** (VTI-LNK-119). The method names, in the identifier, the host that serves its document, and resolution confirms the document came from that host: for example `did:webvh`, `did:web`, `did:webs`, and a `did:scid:vh:1` DID URL with a `src` parameter, whose host is the host of `src`. A producer gives a `did:scid:vh:1` contact with its `src`. A contact without `src` names no host, so route A cannot qualify it and the consumer refuses it with `from-not-allowed`.
- **Route B, domain-linked** (VTI-LNK-120, 121). For a contact of any method route A does not cover, the consumer confirms, before it sends the first request, that the contact's origin is linked to the contact's DID by the Well-Known DID Configuration. It fetches `<contact's origin>/.well-known/did-configuration.json` with a `GET` that carries no cookies or credentials, follows no redirect to another origin, times out, and reads at most 64 KiB. It treats the origin as linked only on a Domain Linkage Credential in `linked_dids` that meets the four conditions of VTI-LNK-121 (issuer and subject equal the contact's DID; the origin equals the contact's origin exactly; valid now, with 60 seconds' allowance; signature verifies with an `assertionMethod` key of the verified document), in a JWT or Data Integrity (`eddsa-jcs-2022`) format the consumer supports.
- **When the fetch is made** (VTI-LNK-122). Only after the person has continued, whatever the activation (camera, paste or page), and never early under VTI-LNK-051. Until the check succeeds, the consumer does not show the contact's origin as its verified domain.
- **Failure** (VTI-LNK-123). Any failure of the check, a failed fetch included, stops the consumer with `domain-not-linked` (outcome `invalid`), and it sends nothing to the contact's services.
- **The inviter's part** (VTI-LNK-124). An inviter whose DID qualifies only through route B publishes a DID configuration that VTI-LNK-121 accepts before it emits a `sign-in` or `vta-claim` link, and serves it with `Access-Control-Allow-Origin: *` and without requiring credentials. For a contact that qualifies only through route B, the `vta-claim` service endpoint MUST be an `https` URL meeting the host rules (VTI-LNK-112).

## 9. References

- **Standards.**
  - BCP 14 (RFC 2119, RFC 8174);
  - RFC 3986 sections 3.4, 3.5 and 5;
  - RFC 4648;
  - RFC 6761; RFC 6762; RFC 7493 section 2.2; RFC 8252 section 8.1; RFC 8375;
  - RFC 9110 sections 7.1, 10.1.3, 10.2.2 and 17.11;
  - WHATWG URL Standard (section 5.1, host parsing);
  - W3C DID 1.0 (section 3.1);
  - ISO/IEC 18004 (QR code capacities).
- **Trust Tasks.** Framework Working Draft 0.7.0 (Type URI; Compatibility Rules; Migrating Between Versions; Audience Binding; Consumer Requirements; `parentThreadId`); `bindings/didcomm/0.2`, `bindings/https/0.3`, `bindings/push/0.1` and `trust-task-discovery/0.3`, all draft.
- **VTI.** The VTI specification, trigger-link chapter (`trustoverip/dtgwg-vti-spec`, `spec/07a-links.md`, merged from PR #58), read on `main` at `a8157ea3` on 2026-11-09. Issue 86 of that repository is open and not reflected here.

Where each was read is in annex F.
