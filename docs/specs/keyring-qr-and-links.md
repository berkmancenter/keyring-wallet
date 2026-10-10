# One-scan trigger links: QR codes and links that start an exchange

**Status:** DRAFT proposal. Implemented by no one. Aligned with the trigger-link chapter of the VTI specification draft (`trustoverip/dtgwg-vti-spec` PR #58, `spec/07a-links.md`, requirements VTI-LNK-001 to 116), which carries the same rules as normative text for VTI. Each rule below names the VTI requirement it matches. Where this document differs from that draft, the difference is named. The link host `link.trustoverip.org` is a proposal to Trust Over IP that has not been agreed. No phone has been tested with these links.

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
- **What VTI and Keyring adopt.** Section 8 holds VTI's choices: the Trust Task first request and VTI's two flows, which Keyring and the VTA Farm adopt. They are examples of the format, not part of it. What Keyring and the Farm choose for themselves, which is deliberately narrower, is in the plan ([`one-scan-and-vtc-sign-in-plan.md`](../plans/one-scan-and-vtc-sign-in-plan.md), section 1.3), not here.

**Keywords:** MUST, MUST NOT, SHOULD and MAY are used as in BCP 14 (RFC 2119, RFC 8174), only when in capitals.

**Companions:**
- [conformance vectors](./keyring-qr-and-links.vectors.json) (section 7);
- [annex](./keyring-qr-and-links.annex.md) (non-normative: link hosting, device tests, rendering guidance, rationale, alternatives, one consumer's legacy format, and upstream fit);
- [proposal to Trust Over IP](./keyring-qr-and-links.toip-proposal.md) (the shared link host).

"Trigger link" is this document's term, and the VTI draft uses it too.

## 1. Model

An **inviter** shows a short text as a QR code or a link. A person carries it to a **consumer** (a wallet, the VTI draft's "reader") by scanning it with a camera, opening it as a link, or pasting it. The text is a **trigger**: it names whom to contact, a handle for the pending exchange, optionally when it stops being good, and optionally which flow it opens. It carries no task, endpoint, key, challenge or authorising secret. A **producer** is anything that emits a trigger on the inviter's behalf.

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
9. The flow does not allow the contact (section 4): `from-not-allowed`. The flow requires an expiry and `_exp` is absent: `missing-exp`.
10. `_exp + 60 <= now`, by the consumer's clock: `expired`. The 60 seconds absorb phone clock error. The inviter still decides expiry by its own clock.
11. Accept, with `from`, `id`, `exp` (or null), `flow` and `task` (or null when there is no hint), and `ignored`.

A consumer MAY check in another order if it always reports the same result.

**What a person sees** (VTI-LNK-021). These are the only messages. A consumer MUST NOT say which field failed, or whether a contact was on a list.

| Outcome | Reasons | Message |
|---|---|---|
| `update` | `unsupported-vid`, `unknown-flow`, `unsupported-version` | "This code needs a newer version of the app." |
| `expired` | `expired` | "This code has expired. Get a new one." |
| `unreachable` | `no-common-transport` (section 5) | "This service can't be reached from your wallet." |
| `pass-on` | `not-ours` | None. The text goes to the consumer's other handlers, unchanged. |
| `invalid` | every other reason | "This code can't be used." |

After `unsupported-vid`, `unknown-flow` or `unsupported-version`, a consumer MUST NOT try another flow, version or parser on the same text (VTI-LNK-022).

- `unsupported-vid` maps to `update`, because a newer wallet may support that kind of identifier.
- `from-not-allowed` maps to `invalid`, because no update changes a flow's rule.
- `wrong-host` maps to `invalid`, because telling the person to update the app would be wrong.

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
   - For a contact without a domain, it shows its own label for that contact if it has one, and otherwise says the contact has no domain to show.
   - **Exception for known contacts.** For a flow that acts only for contacts already in the consumer's own records, the consumer MAY resolve such a contact before the person continues. The host contacted is then one the person chose when the record was made.
2. **Approve after verification** (VTI-LNK-052). The consumer resolves the contact's DID document and verifies it (for `did:webvh`, the log verifies) before sending anything. If it cannot, it stops with `did-document-unverified` (outcome `invalid`) and sends nothing. After verification it shows the verified details, and sends nothing until the person approves.
3. **Unauthenticated text is never fact** (VTI-LNK-052). No field of the trigger other than the contact is shown as a statement of what the exchange is.
4. **Fresh key.** A first request the consumer signs is signed with a key made for this exchange and not used elsewhere. The exception is a flow that defines a signature by an identifier the person chose in rule 2's approval. *Differs from the VTI draft as it stands,* which states this only inside its Trust Task first request. Our proposed change to PR #58 moves it into a general VTI-LNK-054.
5. **Transport from the document only** (VTI-LNK-053).
   - **Candidates.** The candidates are the services of the verified DID document that meet three conditions:
     - their `type` maps to a binding the consumer implements, for example `DIDCommMessaging` to the DIDComm binding or `TrustTaskHTTPS` to the Trust Tasks HTTPS binding. The match is on `type`, never on `id` (`bindings/https/0.3` section 6.2);
     - their endpoint is an `https` URL with no userinfo, or a DID;
     - their endpoint host, where it has one, meets rule 6.

     Any other service is not a candidate.
   - **Choosing.** The consumer's own preference order chooses among bindings. Among candidates of one type, the first in document order wins. The order of services of different types, and DIDComm's `accept`, do not choose.
   - **No candidate.** The result is `no-common-transport`. Nothing is sent, and the consumer does not fall back to another path or to anything in the text.
   - **Replies and freshness.** The request and its reply use the chosen binding. The document is resolved afresh for each exchange.
6. **Host rules** (VTI-LNK-060, 061). These apply to the link host, to the host of a contact that has one, and to every endpoint host the consumer contacts.
   - A host is a DNS name of at least two labels and at most 253 characters, with no trailing dot.
   - Each label is 1 to 63 characters of lowercase `a-z`, `0-9` and `-`, not beginning or ending with `-`. The last label is not all digits.
   - It is not an IP address in any form, including the forms WHATWG host parsing turns into an address.
   - It carries no port.
   - It is not `localhost`, a name under `localhost` or `local` (RFC 6761, RFC 6762), or a name under `home.arpa` (RFC 8375).
   - A consumer SHOULD also refuse an endpoint whose resolved address is loopback, link-local or private.
7. **The first request is the flow's choice.** Each flow states the request a consumer sends first.
   - It is sent only after rule 2's approval, and only over the transport rule 5 chose.
   - It carries the handle, so the inviter can find the pending exchange.
   - A flow MAY use the Trust Task first request (section 8.1), or define its own, for example a DIDComm or OpenID request. This document requires no particular protocol.

   *Differs from the VTI draft as it stands,* whose VTI-LNK-054 requires the Trust Task first request of every trigger link. Our proposed change to PR #58 makes VTI-LNK-054 this general rule, and moves the Trust Task first request to VTI-LNK-057 for VTI's own flows.
8. **No hint** (VTI-LNK-055). The consumer MAY ask the inviter what it supports, through a discovery mechanism of a protocol both implement; for Trust Tasks, that is `trust-task-discovery` (draft). Discovery does not say which flow a handle opens, so a consumer MAY refuse a trigger it cannot place (outcome `invalid`).
9. **A link activated on a page** (VTI-LNK-056). A consumer that receives a trigger from the activation of a link on a page, such as a browser extension, MUST record the origin of that page at activation, and MUST NOT act on an activation the person did not make. A flow may use the recorded origin; `sign-in` refuses a page that is not the portal (VTI-LNK-105).

## 6. Security and producer requirements

1. **A trigger confers no authority** (VTI-LNK-070). Acting on it is the consumer's decision. Granting anything is the inviter's, on the first request (framework, Consumer Requirements: "Not treat identity or document-proof validation as authorization").
2. **A handle alone is a bearer** wherever the inviter treats possession as authority (VTI-LNK-071). Proof of possession by the requester's key does not change that when the requester chooses its own key. An inviter that treats a handle that way MUST make it single use and short lived.
3. **Nothing is spent on a GET** (VTI-LNK-072). Fetching a trigger MUST NOT spend its handle. A handle is spent, if at all, by the first request. A trigger never causes a fetch by reference.
4. **The consumer does not leak it** (VTI-LNK-073). A consumer MUST NOT log the text, the handle or the contact. It MUST NOT put them in an error, a notification or analytics, or send them anywhere but to the inviter in the first request. It logs at most the outcome or class of a link, and redacts before any logger runs.
5. **Producers.** A producer:
   - (a) MUST generate the handle's bytes from a cryptographically secure random source (VTI-LNK-034). An inviter compares a handle as a string (VTI-LNK-035).
   - (b) MUST set `_exp` no later than the inviter's own lifetime for the handle (VTI-LNK-037).
   - (c) MUST emit only ASCII (VTI-LNK-080), and MUST percent-encode `&`, `=`, `#` and `%` inside a value.
   - (d) MUST NOT emit a trigger whose `https` form exceeds 251 bytes where the code is rendered at QR error-correction level M, or 177 bytes where it is rendered at level Q (VTI-LNK-081). These are the capacities of a version 11 QR code. A flow's field limits follow from them. The limit binds producers, not readers, so a valid link stays valid after something appends to it.
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
- The file's `legacyVectors` belong to the annex, not to this section.

**What no vector can test:**
- section 5 rules 1 to 4 and 7 to 9;
- the resolved-address check of rule 6, and the host rules on a contact's host, which apply at resolution;
- fresh resolution, and same-binding replies, in rule 5;
- section 6;
- DID verification;
- what any phone does with a link.

The vectors test a reader's parsing, not any wallet's code.

## 8. VTI's use of the format, adopted by Keyring and the VTA Farm

This section is not part of the general standard. It records what the VTI specification adopts on top of the format, and what Keyring and the VTA Farm therefore implement. It keeps their own stack simple: one kind of first request, and a small set of flows. Another party may adopt the format without any of it.

### 8.1 The Trust Task first request

One option a flow may adopt under section 5 rule 7. A flow that adopts this option sends, as its first request, a Trust Task document (VTI-LNK-057) with:
- `issuer`: an identifier the consumer generated for this exchange and uses nowhere else;
- `recipient`: the contact (framework, Audience Binding: a document carrying a `proof` "MUST also carry an in-band `recipient` member" unless its specification is a bearer specification);
- a unique `id`;
- the handle as `parentThreadId`;
- a signature by the issuer's key.

The framework defines `parentThreadId` as "the `threadId` of the exchange that contains this one". This document treats the invitation as that exchange, and `bindings/didcomm/0.2` section 3.1 maps the member to DIDComm `pthid`. `parentThreadId` "carries no normative validation semantics", so the inviter looks the handle up and decides by its own policy.

Every flow under `https://link.trustoverip.org/vti/flow/` uses this option (VTI-LNK-057).

### 8.2 The flows VTI defines

The VTI specification governs flows under `https://link.trustoverip.org/vti/flow/` (VTI-LNK-046). Both use the Trust Task first request (section 8.1). Their full requirements are VTI-LNK-100 to 105 and 110 to 116.

| Flow | Identifier (version 0.1, draft) | Contact | Expiry | Contact rules |
|---|---|---|---|---|
| sign in to a community portal | `https://link.trustoverip.org/vti/flow/sign-in/0.1` | the community's VTC | required, at most 300 seconds after the code is made | The consumer acts only for a community already in its records, and sends nothing to any other. The contact's document must list the portal's service, so a `did:key` is `from-not-allowed`. |
| claim a VTA from a VTA Farm | `https://link.trustoverip.org/vti/flow/vta-claim/0.1` | the Farm | required, at most 300 seconds after the code is made | A first contact: rule 1's known-contact exception does not apply. The contact's document must list the claim service, so a `did:key` is `from-not-allowed`. |

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
- **VTI.** The VTI specification draft, trigger-link chapter (`trustoverip/dtgwg-vti-spec` PR #58, branch `feat/trigger-links`, read 2026-10-10).

Where each was read is in annex G.
