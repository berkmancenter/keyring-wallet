# QR codes and links that trigger an exchange: claiming an agent and signing in

**Status:** DRAFT. Dated 2026-10-08. Author: bm. Not adopted by any party. Nothing in this document is implemented on the Farm or portal side, and Keyring's parsers do not read the formats defined here.
**Proposed home:** a Trust Tasks task-force document under Trust Over IP, with the task types in the Trust Tasks registry (section 5.1). **Not agreed, not proposed to anyone:** the governance of `trusttasks.org` is only informally understood to be Trust Over IP's (section 5.1).
**Audience:** the owners of the VTA Farm, of a VTC member portal, and of Keyring. Sections 0 to 11 are normative and use no Keyring internals; implementation notes are in Appendix A.
**Test vectors:** `keyring-qr-and-links.vectors.json`, next to this document. They are part of the conformance definition (section 12). They test a reader's parsing only.
**Keywords:** MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.
**Open, for team discussion (none decided):** the container (T1, section 2), how a claim is authorised (T2, section 7), the link domains a camera-opened link may use (T3, section 2.6), the first request when no flow hint is given (T5), and the order in which a wallet prefers transports (T7, section 6.2.1). A working position on some of these is recorded in the plan, marked DRAFT; this document stays neutral and records none of it as decided. The vectors cover both containers so that T1 costs only deleting the groups of the one not chosen.
**Working term.** "Trigger" is an unconfirmed working name for what this document defines. Upstream defines no such term in a task document; the only upstream uses are the push binding's *Trigger* role (the party that decides when to wake a device, whose wake-up payload a consumer treats as an "untrusted hint") and `vtc/admin/events/event/0.1` ("A hint is a trigger to re-read"). Brendan will ask the Trust Tasks expert for the exact term and its source. Until then the word is a label and carries no upstream meaning.

---

## 0. Purpose and model

Three parties exchange a short text shown as a QR code or passed as a link:

- an **inviter** creates it (the Farm, or a VTC portal);
- a **consumer** reads it (Keyring, on a phone);
- a person carries it between the two by scanning or tapping.

**The text is a one-way trigger, not a task.** It says who to contact, a handle that names the pending exchange, optionally when it stops being good, and optionally which kind of flow it opens. It confers no authority and carries no task body, no endpoint, no key, no challenge and no secret that authorises anything. The consumer treats every field as an **untrusted hint** (the push binding's stance toward a wake-up payload: "a consumer MUST treat every field of the push payload as an untrusted hint ... and MUST NOT take any framework action on the strength of a push alone"; `bindings/push/0.1`, `dtgwg-trust-tasks-tf` `origin/main` `7b6bb488`).

What the consumer does with it:

1. Read and validate the trigger (sections 2 and 3). Nothing is sent.
2. Resolve the inviter's DID and take the endpoint from a service in its DID document (section 6.2). Never from the text.
3. Send a **wallet-signed first request** to that endpoint over a real binding (DIDComm, the Trust Task HTTPS binding, or TSP) that opens the trust task or ceremony. The request echoes the handle (section 6.1).
4. Everything after that, the replies and the continuation, travels over that binding, between two parties who authenticate each other. The trigger is never consulted again.

**The legacy Farm QR is version 0 of the same model** (section 9): `{vta_did, callback_url}` is a trigger whose contact is `vta_did` and whose "pointer" is a callback URL, which is the endpoint and the secret in one string. Later versions separate the three: the contact is a DID, the endpoint comes from its document, and the handle is not a credential.

## 1. The trigger

| Field | Required | Meaning | Rules |
|---|---|---|---|
| contact (`from`) | yes | whom to contact: the inviter's DID | a `did:webvh` DID of at most 256 characters, no fragment, query or path. A URL form (an `https` origin the consumer maps to a DID) is **not** defined in this version (open question T4): the only URL-shaped contact today is the legacy callback, handled by section 9. **Limitation:** a `did:webvh` DID that encodes a port (`%3A`, as a lab stack on `localhost:<port>` uses) cannot be carried by container Y, whose values never contain `%` (section 2.2); container X can carry it as a JSON string |
| handle (`id`) | yes | names the pending exchange at the inviter | 16 to 128 characters of `A-Z a-z 0-9 - _` (unpadded base64url alphabet). Opaque to the consumer. **Grants nothing** (section 8.1). It becomes the correlation id of the first request (DIDComm `pthid`; the payload's handle member, section 6.1) |
| expiry (`exp`) | optional; **required by a flow that registers it** | when the inviter will stop honouring the handle | integer UTC epoch seconds. A consumer does not act on a trigger at or after it (`expired`). A hint only: the inviter enforces its own lifetime (section 8). Flows in section 5 register whether it is required |
| flow hint (`type`) | optional | which kind of exchange this opens | an absolute Trust Task Type URI, `https://<authority>/spec/<slug>/<MAJOR.MINOR>`, compared as an exact string after the authority is looked up in the consumer's accepted set (section 4). Absent: section 6.3 |
| transport hint (`tp`) | optional | which bindings the inviter would like the wallet to try first | an ordered list of binding names from `didcomm`, `https`, `tsp`. **Advisory only** (section 6.2.1): it can order a choice and can never add one. An unusable name is dropped and reported, never a reason to reject |
| `goal` | optional, OOB container only | a display string | may be shown; never decides anything |

Properties:

- **No secret, no endpoint, no task body.** A field never carries an administrator key, a challenge, a nonce, a signature the consumer must trust, a display name, or a URL the consumer then contacts.
- **Confers no authority.** Acting on a trigger is the consumer's decision under its own policy, and what the inviter grants is decided by the inviter when it receives the signed request (section 6.1). Framework: "Not treat identity or document-proof validation as authorization" (Consumer Requirements, framework 0.7.0 draft, `7b6bb488`).
- **A trigger names a flow, it does not carry one.** There is no `proof`, no `recipient` and no Trust Task document in the text. Audience binding therefore belongs to the wallet's request, not to the trigger (section 6.1).

## 2. Containers

A consumer reads the trigger from one of two containers. **Which is required of every consumer is open decision T1.** Both are specified so the decision costs one deletion.

### 2.1 Container X: DIDComm v2.1 out-of-band invitation with no attachment

A plaintext DIDComm Messaging v2.1 out-of-band invitation ([DIDComm v2.1], "Out Of Band Messages"), in the `_oob` query parameter of a link:

```
https://<domain>/<path>?_oob=<base64url, no padding, of this JSON in UTF-8>
{
  "type": "https://didcomm.org/out-of-band/2.0/invitation",
  "id": "<handle>",
  "from": "<the inviter's DID>",
  "expires_time": <integer UTC epoch seconds, optional>,
  "body": { "goal_code": "<flow hint: a Trust Task Type URI, optional>", "goal": "<display string, optional>", "tp": ["<binding name>", "..."] }
}
```

- `type`, `id` and `from` are the members DIDComm requires; `from` is "REQUIRED for OOB usage" there. `expires_time` is DIDComm's own message header (UTC epoch seconds, optional; "When omitted ... the message is considered to have no expiration by the sender"), used here as the expiry. The invitation `id` is the handle, and by DIDComm's thread rules it is what the first reply's `pthid` names (DIDComm "Message Correlation"; the mapping is this profile's choice).
- **No attachment.** `attachments` is absent or an empty array; any other value rejects (`attachments-not-allowed`). An attachment is never read, never dispatched, and never ignored silently: a trigger carries no task body. (An attachment-only v2 invitation is accepted by Credo's out-of-band handling at the connection level and then fails with "Invalid message type", because the attachment carries `type`, not `@type`: read from code, not run; Appendix A.)
- `goal_code` carries the flow hint as a Type URI. DIDComm calls `goal_code` "self-attested" and says "goal codes defined outside of this spec MUST use Reverse Domain Name Notation with the associated effort's domain as a prefix" (DIDComm v2.1, Goal Codes); a Type URI is not that form, so using one deviates from that sentence (a T1 con). The flow is still named once (the Type URI), not twice. Whether DIDComm tooling tolerates a Type URI there was not checked. A bare string such as `vta-claim` is `bad-type`.
- `body.tp` is the optional transport hint (section 1): an array of strings. A `tp` that is not an array of strings is ignored as a whole and reported as `body.tp`; an unknown, empty or repeated name is dropped and reported as `tp.<name>`.
- `body.accept` and `created_time` are DIDComm members this profile never reads and does not report. (DIDComm's `accept` is an ordered list of media types for the message; it is not a transport selector, section 6.2.1.)
- Other members are ignored and reported (`invitation.x`, `body.x`). Duplicate member names anywhere in the JSON reject the invitation (`bad-invitation`), so two readers cannot disagree about one text.
- The invitation MAY be signed (DIDComm: it "may be signed to provide tamper resistance"). This version does not require it and defines no place for the signature (open question Q5).

### 2.2 Container Y: an `https` link with a small fixed parameter set

```
https://<domain>/<path>?_from=<DID>&_id=<handle>[&_exp=<epoch seconds>][&_type=<Type URI>][&_tp=<binding names separated by .>]
```

`_tp` is the optional transport hint (section 1), for example `_tp=https.didcomm`. A name outside `didcomm`, `https`, `tsp`, an empty element or a repeat is dropped and reported as `tp.<name>`; the member is absent from the result when no usable name remains. The five names are placeholders chosen to be unlikely to collide with a site's own parameters (an ordinary link with `from=` or `id=` is `not-ours`; the marker is `_from`). Values use `A-Z a-z 0-9 . _ ~ - : /` and are never percent-decoded. Other parameters are ignored and reported (`query.x`).

### 2.3 T1: choosing the container (open)

| | **X: OOB invitation, no attachment** | **Y: plain `https` link, fixed parameters** |
|---|---|---|
| Standard | a published container; DIDComm scanners and Credo parse it; `from`, `id` and `expires_time` already exist | none: five names this document would have to govern (a second format every scanner learns: the ground on which a bespoke `keyring://<flow>?v=&crit=` envelope was rejected; companion F8) |
| Size | larger: base64url of about 250 to 350 bytes of JSON, a link of about 400 to 550 characters | smaller: about 150 to 250 characters |
| Parser | base64url, UTF-8, strict JSON with duplicate detection | name=value split only; no JSON, no encoding |
| Side effects | on receipt a generic DIDComm path (Credo) saves an out-of-band record and makes a **connection to `from`** (with a `did:peer` of its own) before it looks at the goal; the Keyring router must intercept the link first (Appendix A; read from code, not run) | none: no DIDComm library reads it |
| Flow named | `goal_code` (a Type URI); DIDComm says goal codes defined outside its spec MUST use reverse domain notation, which a Type URI is not | `_type` |
| Interop | a DIDComm scanner reads it and opens a connection, which is not what the inviter wants | no other reader understands it |
| Decision needs | the Trust Tasks view on a Type URI in `goal_code`; whether the unwanted DIDComm connection matters | someone to govern the names; the Trust Tasks view on a link profile |

No decision is recorded here. A working position (DRAFT, discussable) is in the plan and does not bind this document. The vectors implement both. **A new `link` transport binding (a bare Trust Task document in a URL, optionally wrapped) is not part of v1:** a trigger carries no task, so there is no document to carry and no binding to write, and a new binding needs Trust Tasks group acceptance for no gain over a hint. It is a recorded alternative in the companion (F12).

### 2.4 Delivery rules (both containers)

1. **`https` is primary and the only form shown to a generic camera.** RFC 8252 section 7.2: a claimed `https` URI "SHOULD" be preferred because the operating system establishes which app receives it. `keyring://` is a convenience alias for Keyring's own scanner, the paste screen and the lab, carrying the same host, path and query. RFC 8252 section 7.1 asks a private-use scheme to be a reverse domain name (`keyring` is not) and section 8.1 says several apps can register one scheme, so which app receives a `keyring://` link is "indeterminate". Nothing that matters may depend on the alias reaching only Keyring (section 8).
2. **A trigger never causes a fetch.** DIDComm's `_oobid` (a GET whose response format DIDComm does not define) is not part of this profile and rejects (`unsupported-form`). There is no host allow-list for a fetch because there is no fetch, and no secret is spent by a GET (section 8.1).
3. A link has exactly one marker (`_oob` or `_from`), once. A parameter name never repeats, known or unknown. A value is never percent-decoded; a `%` in a marker value is an error.
4. The text MUST NOT contain a fragment, whitespace or a control character, a userinfo, or a port. Surrounding ASCII whitespace is removed first. The path is mandatory, with no `.` or `..` segment and only unreserved characters and `%XX`. The host of the link is **not checked** against any list (it causes no request): trust comes from the contact (section 8).
5. **Length.** The whole text is at most 1,536 characters and the invitation JSON at most 1,024 bytes (proposals, T6). A consumer checks the text length first. DIDComm gives no byte limit: it says only that some messages are "too long to produce a useable QR code". The largest symbol, version 40, holds 2,953 bytes at error-correction level L, 2,331 at M, 1,663 at Q and 1,273 at H in byte mode (Denso Wave, `qrcode.com`, read 2026-10-08); how reliably a given phone reads a given symbol from a monitor at arm's length is **unverifiable from a document** and is what test C11 measures. Producers SHOULD keep the text small; both containers are far below the limits.
6. A text with no marker is **not ours** and goes to the consumer's other handlers. This leaves `keyring://vta/enrol` and ordinary web links alone (section 10).

### 2.5 Opening a link from a generic camera app (requirements)

The person points a phone's own camera, or a third-party scanner, at the code and expects the right app to open, as for any other link. Nothing in this document can make that happen by itself: **the operating system, not the wallet, decides which app opens an `https` link, from files the link's domain publishes.** The requirements below are on the inviter's domain and on each wallet's build. Sources are in the companion appendix (G); each is marked there as verified (the page was read) or unverified.

1. **G1. Camera-facing text is an `https` URL on a domain the inviter controls.** A custom scheme is not a link a generic camera is known to open (G9). The `keyring://` alias is for Keyring's own scanner.
2. **G2. iOS: Universal Links.** The domain serves `https://<fully qualified domain>/.well-known/apple-app-site-association` (no extension), over `https` "with a valid certificate and with no redirects" (Apple, Supporting associated domains). Each wallet it intends to open lists its application identifier (`<Team ID>.<bundle id>`) in `applinks.details[].appIDs`. The wallet declares `applinks:<domain>` in its Associated Domains entitlement, "only the desired subdomain and the top-level domain", no path or query. If a site uses several subdomains, "each requires its own entry in the entitlement, and each must serve its own `apple-app-site-association` file". "For services other than `appclips`, you can prefix a domain with `*.`" to match all of its subdomains (the exact exclusion is `appclips`, read in Apple's documentation data). Since iOS 14 the device reads the file through an Apple-managed CDN, which "requests the file for your domain within 24 hours", and devices re-check about weekly; `?mode=developer` bypasses the CDN for development. The system verifies at install time, so a link domain the installed build does not declare **never opens that build**, whatever the domain's file says.
3. **G3. Android: App Links.** The wallet declares an intent filter with `android:autoVerify="true"`, action `VIEW`, categories `DEFAULT` and `BROWSABLE`, scheme `https`, and the host. For each unique host Android fetches `https://<host>/.well-known/assetlinks.json`, served as `application/json`, not a redirect, holding statements with relation `delegate_permission/common.handle_all_urls` and a target of `namespace` `android_app`, the `package_name` and the `sha256_cert_fingerprints`. **A wildcard `android:host` such as `*.example.com` verifies against an `assetlinks.json` published at the root hostname `example.com`** ("if you declare your hostname with a wildcard ... you must publish your `assetlinks.json` file at the root hostname"; Android, Verify App Links, read raw 2026-10-08). On Android 11 and lower the app becomes the default handler only if every host in the manifest verifies; from Android 12 each host is verified separately. Android 15 and higher re-verify periodically; 14 and lower pick changes up at install or update.
4. **G4. The domain's files decide.** The inviter's domain MUST publish both files, each naming the wallets it wants to open its links. A wallet absent from the files is never the default handler, and a wallet in the files whose build does not declare the domain (G2, G3) does not open it either: both halves are needed.
5. **G5. Camera behaviour.** iOS Camera recognises QR codes; with Universal Links set up, "scanning a QR code with a URL to the website can take the user directly to your app" (Apple, WWDC 2017 session 206, iOS 11; current behaviour **unverified**). **For Android's stock camera, Google Lens and third-party scanners no source was read; it is unverified and is the first thing tests C2 and C3 measure.** The documented OS side: a verified App Link goes directly to the app, and from Android 12 "a generic web intent resolves to an activity in your app only if your app is approved for the specific domain contained in that web intent".
6. **G6. Two wallets.** iOS: if more than one installed app claims the domain, "an alert will appear prompting them to pick the application", remembered (WWDC 2017 session 206; current behaviour unverified). Android: **one `assetlinks.json` may list several apps** and each can verify; **if two apps resolve the exact same host and path, only the most recently installed resolves the web intent** ("only the app that was installed most recently can resolve web intents for that domain"; Android, Verify App Links, read raw 2026-10-08), and with several matching activities "there's no guarantee as to which Activity handles the link". A neutral domain that lists several wallets therefore gives iOS a chooser and Android an install-order outcome. This document promises no particular wallet.
7. **G7. The app is not installed.** The same URL loads in the browser (Apple: the system "opens the URL in their default web browser"; Android: users without the app "go to your website instead"). See 2.7.
8. **G8. The domain is part of the build.** The entitlement and the manifest are compiled into each wallet build, so a new inviter domain reaches a phone only with a wallet release, unless a wildcard or shared domain already in the build covers it (2.6).
9. **G9. Custom schemes are not enough.** RFC 8252 section 8.1: "multiple apps can typically register the same scheme, which makes it indeterminate as to which app will receive" the code; section 7.1 is a **MUST** ("apps MUST use a URI scheme based on a domain name under their control"). Android says a custom scheme "can still trigger the disambiguation dialog if another app registers the same custom scheme". **Whether a camera app turns a `keyring://` text into a tappable link is unverifiable from documents** and stays an untested hypothesis (test C6).

### 2.6 Link domains (open, decision T3)

Every inviter has its own domain, and G8 says each domain a camera is to open in Keyring must be in the Keyring build. Options, none chosen:

| | **N. Neutral shared link domain** | **W. Wildcard subdomains** | **P. Per-inviter domain (today's pattern)** |
|---|---|---|---|
| Shape | one domain operated for all inviters; one file pair lists every supported wallet | each party's links live under a subdomain of a domain it controls (`applinks:*.ic3.dev`; Android `*.ic3.dev`, file at the root host) | each inviter's domain is added to each wallet's build |
| New inviter needs a wallet release | no | no, if under a covered wildcard | **yes** |
| Cost | someone must run and govern the domain and both files; on Android two listed wallets resolve by install order (G6) | the parent domain's owner serves a file on every subdomain Apple fetches (whether a wildcard entry changes that per-subdomain rule is unverified) | the wallet release cadence limits partners |

There is no by-reference resolver option, because a trigger causes no fetch (2.4 rule 2). For the first release the Farm's two domains are already on Keyring's allow-list, so option P (add one host and path to the entitlement and manifest) is the cheap start. The Farm may prefer its own app (`vta-mobile-agent-ios` exists) and Android verifies by install order, so the Farm owners are asked early (T3).

### 2.7 No app installed: landing page

DIDComm: the URL "should return human readable instructions when loaded in a browser". The inviter's page at the link's path MUST:

1. load for any query with the same text, and never display or echo the handle or the contact;
2. say in plain words what the code is for and that it needs a compatible wallet;
3. offer a store link for each wallet the domain's files list, and on iOS MAY add a Smart App Banner;
4. offer an explicit "open in the app" tap that uses the `https` link itself;
5. **not offer a `keyring://` button for any trigger whose handle can be spent** (the legacy callback, an Option A claim, section 7): the alias can be received by any app that registers the scheme (RFC 8252 section 8.1), and a scheme fallback on a link carrying a spendable value hands that value to whoever registered first. Where the handle is not a credential (section 7 Option C) an alias button is permitted;
6. not redirect to a custom scheme without a tap.

## 3. Reading order

A consumer applies these steps in order and stops at the first that fails. The reason code is named for tests; section 8 rule 8 governs what is shown. The consumer reads from the containers it implements (T1); `unsupported-form` and the like apply to the others.

**Link stage** (no network):

1. Trim ASCII whitespace; longer than 1,536 characters: `too-long`.
2. Starts with `{` or `[`: the legacy format, read by its own order and reasons in section 9 (`not-ours`, `wrong-channel`, `missing-param`, `bad-value`, `callback-not-allowed`).
3. No `scheme://`, or a scheme other than `https`, `keyring` and `http`: `not-ours`. No marker (`_oob`, `_oobid`, `_from`) in the query (the query is what lies between the first `?` and any `#`): `not-ours`. Scheme `http` with a marker: `insecure-scheme`.
4. Whitespace or a control character anywhere: `bad-grammar`. A `#`: `fragment`.
5. Host not a lowercase-able DNS name of at least two non-empty labels, or userinfo, port, IP literal, a leading or trailing dot: `bad-authority`. No path, a dot segment or a bad character in the path: `bad-grammar`.
6. A parameter that is not `name=value`, a trailing `&`, a bad name, or (for an unknown parameter) a value outside the grammar: `bad-grammar`. A repeated name: `repeated-param`. More than one of `_oob`, `_oobid`, `_from`: `both-forms`. An empty value: `empty-value`.
7. `_oobid`: `unsupported-form`. `_oob`: not base64url, a length no base64url string has, or not UTF-8: `bad-base64url`.

**Invitation stage** (container X only):

8. Larger than 1,024 bytes: `too-long`. Not a JSON object, a duplicate member name, a `body` that is not an object, or a `goal` that is not a string: `bad-invitation`.
9. `type` is not exactly the OOB type: `wrong-type`. `attachments` present and not an empty array: `attachments-not-allowed`.

**Trigger stage** (both containers, after normalising to the fields of section 1):

10. Contact missing: `missing-from`. Not a `did:webvh` DID without fragment, query or path, or over 256 characters: `bad-from`.
11. Handle missing or not 16 to 128 characters of `A-Z a-z 0-9 - _`: `bad-id`.
12. Expiry present and not a non-negative integer (a URL `_exp` is digits with no leading zero): `bad-exp`.

    12a. Transport hint, if present: never a reason to reject. A name outside the consumer's known set, an empty name or a repeat is dropped and reported; a container-X hint that is not an array of strings is ignored whole.
13. **Flow hint**, if present: not an absolute URI, or with a query or fragment: `bad-type`. An absolute URI that is not `https://<authority>/spec/<slug>/<version>`, or whose authority is not in the consumer's accepted set (section 4), or whose slug is not registered: `unknown-flow`. A version that is not `MAJOR.MINOR` without leading zeros: `bad-type`. A MAJOR the consumer does not implement, or at MAJOR 0 a MINOR it does not implement: `unsupported-version`.
14. The flow does not allow the channel the text arrived on: `wrong-channel`.
15. A flow that requires it (`vta-claim`) and a contact whose domain is not on the consumer's list: `from-not-allowed`.
16. A flow that requires an expiry (section 5) and none carried: `missing-exp`.
17. Expiry at or before the consumer's clock: `expired`. (The clock check is last: static faults are reported first, so the vectors are deterministic.)
18. Accept.

A reader MAY work in another order if it reports the same result.

## 4. Versioning, identifiers and moving the authority

There is no version in the link. The container type fixes the container (`out-of-band/2.0`; a different type URI is `wrong-type`). A **flow** is versioned by the **Trust Task Type URI** in the hint, `https://<authority>/spec/<slug>/<MAJOR.MINOR>` (Trust Tasks framework; read at the pin `bdae1cf9`, framework 0.5, and at `origin/main` `7b6bb488`, working draft 0.7.0):

1. **MINOR is additive, MAJOR is breaking** (Compatibility Rules). A consumer at `M.N` SHOULD accept `M.K` for `K > N` where it can ignore members it does not recognise; a consumer MUST reject a MAJOR it does not implement with `unsupportedVersion`. Quote: "A `MAJOR` mismatch is never forward-compatible".
2. **Draft caveat.** While a task is `draft`, a breaking change may be released as a MINOR. A consumer accepts a MAJOR 0 flow only at the MINORs it implements (`unsupported-version` otherwise). Both new tasks start as drafts at MAJOR 0, so a producer bump would strand wallets on every change. **Producers therefore keep the previous version working alongside**: the inviter's endpoint continues to accept first requests under the previous Type URI until the named wallets have shipped the new one (Migrating Between Versions, expand-then-contract: "Update receivers first ... Update senders" and only then "Retire the old version"). Use the `ext` extension member for additive extensions in a request (framework 0.7.0, The `ext` Extension Member; `extCritical` makes an unknown namespace a rejection). The hint names one version and a link cannot repeat `_type`; so the previous version is kept at the endpoint, and the hint is moved to the new version last.
3. **Exact comparison.** Type URIs are compared as exact strings after the authority lookup. A consumer does not follow redirects or resolve the authority.
4. **Identifier rules this document follows** (framework 0.7.0, Type URI, Stability, Private and Unpublished Specifications; DTG VSC Predicate Registry governance, identifiers): the slug is lowercase and hyphen-separated; the version is the last path segment and is `MAJOR.MINOR` (the reserved slug `trust-task` carries three parts and is not used here); the scheme MUST NOT be `http`; the public registry form is `https://trusttasks.org/spec/<slug>/<MAJOR.MINOR>`; a **private** specification MAY use a DID URL or URN form and MUST NOT be served from or claim `trusttasks.org`, and such an identifier is a different one from any registry identifier (this reader files it under `unknown-flow`); no query; a fragment only where the framework defines one; `trust-task*` and `trust-ceremony*` slugs and the `/binding/` and `/ceremony/` subtrees are reserved, so a binding URI as a hint is `unknown-flow`; a published identifier is never edited, a change is a new version. The VSC registry has no releases ("is not tagged and has no release versions of its own"; `GOVERNANCE.md`, `dtgwg-vsc-registry` `54a13abe`) and is for predicates only, so this document pins nothing there.
5. **The flow is named once.** The hint is the only name of a flow; there is no second registry of bare flow codes (a bare `goal_code` string such as `vta-claim` has no namespace and would collide with other ecosystems', so it is `bad-type`). Routing is by the Type URI's slug, after the authority and version checks.
6. **Moving the authority is not one string.** The authority appears in every Type URI the consumer knows. If the task types move from `trusttasks.org` to another authority, the rules are:
   1. **Wallets accept a set of authorities before any producer switches.** The consumer's `acceptedAuthorities` is a list; the vectors carry two. Receivers first, per Migrating Between Versions.
   2. **Inviters accept first requests under both authorities** during the window and **switch the hint last.** (A hint names one URI and a link cannot repeat `_type`, so the "dual" part is at the inviter's endpoint, not in the text.)
   3. **The registry publishes an alias.** Framework (Private and Unpublished Specifications): old and new URIs "identify distinct specifications unless and until the registry policy explicitly aliases them". Until it does, they are different tasks.
   4. **`trusttasks.org` keeps serving the old URIs** (Stability: a published identifier is not edited or withdrawn).
   5. **A known flow under an unknown authority is `unknown-flow`, shown as "update the app"**, not as "this code can't be used".
   6. Framework Type URI: the public-registry form is written with `https://trusttasks.org/spec/...`. **Moving core tasks to another authority therefore needs a framework change**, and every upstream Type URI Keyring already speaks changes with it. Codes live for minutes; **installed wallets are the risk**, not deployed codes.

## 5. Registry

Registry revision: 0 (draft). A flow's Type URI slug is reserved the moment it is listed.

| Flow | Slug (authority per section 5.1) | Inviter (`from`) | Channels | Expiry | `from` list |
|---|---|---|---|---|---|
| claim a parked VTA | `vta-claim` (proposed; **no upstream task exists**, section 6.4) | the Farm's claim-service DID | scan, deep link, paste | required, minutes | required |
| sign in to a community's portal | `auth/cross-device/claim` (the name proposal B uses; no published spec found at `origin/main`, section 6.4) for the pairing; `auth/authenticate/0.3` for the sign-in itself | the community's DID | scan, deep link, paste (section 8.2) | required, 120 seconds | not required; the community must already be one the wallet knows (wallet policy) |

Type URIs are `https://<authority>/spec/<slug>/<MAJOR.MINOR>`. The slug `auth/cross-device/claim` is **B's name, not an upstream spec.** `vtc-login` as a bare code does not exist in this version.

### 5.1 Authority (provisional)

**Proposed home (provisional, not agreed).** One proposal, not a decision: that this work lives under Trust Over IP.

- The task types are proposed for the **Trust Tasks registry**, whose public form is `https://trusttasks.org/spec/<slug>/<MAJOR.MINOR>`.
- This trigger profile is proposed as a **Trust Tasks task-force (Trust Over IP) document**.
- **Reported by Brendan, not independently verified:** `trusttasks.org` is informally governed by Trust Over IP; its owner is a ToIP editor; long term the core tasks are likely to sit under a `trustoverip` subdomain; Brendan is an editor and can propose. What was read: the registry repository is `trustoverip/dtgwg-trust-tasks-tf`, its `README.md` says it is "Developed under the Trust Over IP Foundation (ToIP) Decentralized Trust Graph Working Group (DTGWG)", and the framework calls the process "the registry policy referenced in Maturity Levels" and does not say who runs it. That is a statement about the repository, not the domain.

**The authority is a configured set** (section 4 rule 6), not one string. Until the position is confirmed no consumer ships the registry authority as a trusted default on the strength of this document. A private authority under section 4's private forms is the fallback, and costs one new Type URI.

**The VSC registry is not the home for flows.** Its `GOVERNANCE.md` scopes it to credential predicates and admits only a predicate that "is not meaningful only inside one exchange (that is a trust task artifact, not a statement)". A claim or a login is a flow, so neither is a VSC predicate.

## 6. After the trigger

### 6.1 The first request

The consumer's first request is a **Trust Task document** that opens the flow named by the hint (or by T5), sent over a binding resolved from the contact's DID document (6.2). Requirements, at the level this document owns; the task's own schema belongs to the task:

1. **Issued by the wallet, signed.** `issuer` is the wallet's DID for this exchange, with a `proof` (framework, Audience Binding: when a document carries a `proof` it "MUST also carry an in-band `recipient` member" unless its specification is a bearer specification).
2. **Audience-bound to the inviter.** `recipient` is the contact's DID. This is where audience binding belongs: framework Consumer Requirements: a consumer MUST "reject any document whose `recipient` member is set and does not identify the consumer's own party", so a signed document addressed to an unknown phone is audience-free and would have to declare a bearer specification ("MUST NOT declare themselves bearer unless the audience-free property is intrinsic"). A request to the inviter is not bearer.
3. **Echoes the handle.** The handle is carried in a payload member the task defines, and as the DIDComm `pthid` where the binding is DIDComm. This lets the inviter find the pending exchange. It is a lookup key, not authority.
4. **`id`, `issuedAt` and `expiresAt`.** A unique `id` (the consumer's duplicate-execution rule keys on it) and a short `expiresAt`. A task that defines a consequential effect MUST require `issuedAt` (Specification Requirements).
5. **The inviter decides.** Receiving a well-formed signed request does not authorise anything: the inviter evaluates its own policy for that handle, that key and that moment (Consumer Requirements, item on authorization). Acting on a trigger is likewise the wallet's decision under its own policy.
6. **Step-up and consent are policy, not task text.** A task specification "MUST NOT declare that a task does or does not require consent, human approval, or an authentication step-up" (Governance Considerations, framework 0.7.0). A task declares what it does (`sideEffects` `destructive`: "irreversible or authority-shifting"; `exposure.actsAsSubject` for a login, Specification Requirements) and the wallet and the inviter apply their own approval and biometric rules. This document therefore writes none into a task.
7. **Which key signs.** The first request is signed with a key the wallet holds for this exchange. For `vta-claim` the key that becomes the agent's administrator is the phone's key; whether it is the temporary `did:key` or the final key is the task's to define (the key swap happens within the first hour; plan section 3).

### 6.2 Transport

Transport is never read from the text. The consumer resolves the contact DID and picks a service from its DID document (6.2.1):

| Service type in the contact's DID document | Binding | What the consumer does |
|---|---|---|
| `DIDCommMessaging` | `didcomm` | sends the first request as a DIDComm message to the service endpoint, by DIDComm's own rules; a plaintext or anoncrypt arrival "MUST NOT enter the framework pipeline" (binding `didcomm/0.2`), so the request is authcrypt between known DIDs and nothing is carried plaintext in an attachment |
| `TrustTaskHTTPS` | `https` | sends the Trust Task HTTPS binding (`https/0.2` and `0.3` section 6.2, "MUST match on the service `type` and MUST NOT match on the `id` fragment") to the base URL, an `https:` URL |
| `TSPTransport` | `tsp` | reserved for a TSP inviter. The name appears in one upstream source comment and is **not a verified registered service type**; binding `tsp/0.1` resolves a VID through TSP's own mechanism and names no DID-document service type |

DID Core defines `service` and `relativeRef` DID URL parameters; a later version could name an endpoint with them (Q8). **TSP defines no invitation format**: the specification calls out-of-band introduction "out of scope" (Experimental Implementor's Draft Rev 3), so a TSP-only inviter shows a trigger in whichever container above and the reply goes over TSP (open, Q3).

#### 6.2.1 Agreeing on the transport

**The screen that shows the code is usually not the endpoint.** A browser page that draws a QR, or a printed card, is a presentation surface; the service that will answer the wallet is somewhere else. The trigger names that service by its inviter DID (section 1) and says nothing about how to reach it. The wallet and the inviter agree on a transport as follows.

1. **Resolve and verify.** The consumer resolves the contact DID and uses the document only if it is verifiable (for `did:webvh`, the log verifies). A document that cannot be resolved or verified ends the exchange: nothing is sent (`did-document-unverified`).
2. **Candidates.** The candidates are the services in the document whose `type` maps to a binding in the table of 6.2 that the consumer implements. Types are matched, never service ids. A candidate whose endpoint does not meet its binding's form (the `https` binding's endpoint is an `https:` URL) is not a candidate. Any other service type is ignored.
3. **The consumer chooses.** The consumer picks the candidate its own configured preference order ranks first. The order of the services in the document, and DIDComm's `accept`, do not choose. DIDComm's `accept` is "an array of media types in the order of preference for sending a message to the endpoint", a property of one DIDComm service, and not a transport selector. DIDComm also says the order of the endpoints inside one `DIDCommMessaging` service "SHOULD indicate the DID Document owner's preference"; that orders endpoints within the service and says nothing about ranking one service against another. **It is not verified how DID Core or the upstream Trust Tasks documents rank several services in one DID document**, so no ranking among services is assumed from the document.
4. **The transport hint is advisory.** A trigger's `tp` (section 1) may reorder the consumer's choice among candidates; it can never add a candidate, remove one, or make an endpoint acceptable, and a consumer whose policy ranks bindings MAY ignore it.
5. **No common transport.** If there is no candidate, the outcome is `no-common-transport`: the consumer sends nothing and shows "This service can't be reached from your wallet." (section 8 rule 8). It does not fall back to an endpoint from the text, to another binding it did not select, or to the generic connection path.
6. **One binding for the exchange.** The first request and the reply use the selected binding. A reply that arrives on another binding is not accepted as the reply.
7. **The endpoint comes from the DID document, never from the trigger.** The reader recognises no member of the text as an endpoint: any member this version does not define, whatever its name or value, is ignored and reported (sections 2.1 and 2.2) and is never used, so an appended parameter cannot end or redirect an exchange. The one endpoint in a text that is ever used is the legacy Farm callback (section 9), on a host of the consumer's allow-list.

The conformance vectors for this subsection are the `selectionVectors` list (section 12), which test the selection and rejection rules above and nothing else.

**Out of scope, and a future profile: the device-to-device case.** Everything above assumes an inviter that runs a service reachable by a binding. When the holder of the QR **is** the endpoint (no server; for example the mutual-attestation anchors of the Trust Tasks ceremonies, or two phones exchanging a credential), the code must carry how to reach the device. ISO/IEC 18013-5 device engagement lists the retrieval methods in the code, and CTAP 2.2 hybrid transport fixes a BLE advertisement plus a tunnel and puts the routing data in the QR (section 11.5.1); both are precedents, and ISO 18013-5 was not read (paywalled; unverified). A profile for that case would add a `transports` list to the trigger, with the routing data each entry needs, and would require a proximity check (section 8.2). It is not defined here, and nothing in this version is a basis for it.

### 6.3 No flow hint (open, T5)

A trigger with no hint names an inviter and a handle only. The consumer then has to choose its first request. Options not chosen: a generic discovery request to the inviter, which answers with the flow; or a route per link path registered in configuration. Until T5 is decided a consumer MAY refuse an unhinted trigger it cannot place (`invalid` in the UI); the vectors accept it as `flow: null` and say nothing about what happens next.

### 6.4 Upstream Trust Tasks that fit, and where they do not

Checked at `origin/main` of `dtgwg-trust-tasks-tf` (`7b6bb488`, 2026-10-05; the pin is `bdae1cf9`, so these specs are **not in the pinned copy**). Every task named is `status: draft`.

| Upstream task | `vta-claim` | login |
|---|---|---|
| `vtc/invitations/deliver/0.1` (an OID4VCI offer "small enough for a QR code"; code redeems only for a key-binding proof by the invited DID) | **Pattern only.** The invited DID is known when the offer is made; a pool claim's is not. A precedent for "a small offer, redeemable only with a key", and **not** for a Trust Task in a QR | not relevant |
| `vtc/install/claim/start/0.3`, `finish/0.3` (install token plus a separately delivered `claimCode`, a challenge, a step-up approver) | **Pattern only**, and the model for Option B (section 7). The token must name an admin DID; the subject is a community | not relevant |
| `auth/step-up/approver/invite/0.1`, `redeem/*` (single-use invite URL plus a separate code; five wrong codes void it) | pattern only | not relevant |
| `auth/authenticate/0.2`, `0.3` (0.3: a delegate such as a holder's VTA authenticates a principal) | not relevant | **fits** the VTA-proxied sign-in leg (0.3, draft); whether a portal can use it was not checked |
| `auth/step-up/approve-request/0.4`, `approve-response/0.6` | not relevant | **a partial fit only**: a bound-operation or `task-consent` task may fit a login consent better; the fit is **not verified** |
| `auth/passkey/enroll/invite/0.2` ("never carried in the URL"; two channels) | pattern only | not relevant |
| `bindings/push/0.1` (the Trigger role; a contentless doorbell whose payload is an untrusted hint) | the closest upstream stance for how a consumer treats a trigger | same |
| `vtc/admin/events/event/0.1` ("A hint is a trigger to re-read") | the other upstream use of the word | same |
| pool claim, Farm, `auth/cross-device/claim`, `qr-login` | **no upstream task** (`git grep` at `7b6bb488`: one unrelated hit, a persona "pool claim" schema description) | **no upstream task**: the pairing is a new type |

**Ceremonies.** Trust Ceremonies are in the framework at `origin/main`: the `ceremony` member and the `/ceremony/` namespace are normative (framework 0.4 and later: The `ceremony` Member; Ceremony Namespace), the design note `docs/design-notes/trust-ceremonies.md` is marked "Draft — proposed, not implemented", and ceremony definitions exist for `vtc/member-onboarding`, `vetting/identity-vetting` and `mutual-attestation`. `mutual-attestation` anchors on "a scanned code ... a compared short authentication string". **No ceremony definition defines an entry or trigger or a QR format**, and "Membership Is a Claim, Not a Permission": a `ceremony` member grants no authority. A trigger MAY open a ceremony by naming it in the first request; wallets MAY tag their exchanges with the `ceremony` member as a **claim only**. (VTI's "ceremonies" documents describe a different, server-side policy pipeline whose "trigger" is an authenticated actor; they are not this.)

## 7. Claim authorisation for `vta-claim` (open, T2)

The goal is the same in every option: a person scans the Farm's code and the Farm binds one parked slot to the phone's key, once. The options differ in where authority sits. **No option is chosen.** Facts from the Farm owner reply (an external artifact dated 2026-10-08, treated as data) that bound the decision:

- The current claim QR `{vta_did, callback_url}` is **frozen** until a Keyring release ignores unknown keys (section 9). Option C below changes what the QR means and cannot ship before then.
- The callback is an HMAC-SHA256 over the request id under a server secret, recomputed by the Farm, single-use per DID; a re-post of the same `admin_did` within 24 hours is idempotent and a different DID gets `409`; callbacks are built server-side and are always Farm-origin.
- A slot reserved and never scanned returns to the pool and refunds the link use; a slot scanned and never connected is destroyed and rebuilt. The pool is capped near 100 slots.
- Registration of the Farm credential needs only a DID; login requires proof of possession (section 7.2).

| | **A. Handle single-use, bearer** | **B. Second-factor claim code** | **C. No-secret QR, signed claim, confirmed on the Farm page** |
|---|---|---|---|
| Mechanism | the handle in the trigger (or the legacy callback) is the authority; **spent on the signed claim request, never on a GET** | the trigger names the slot; the authority is a **claim code delivered on another channel** (shown on the Farm's page, sent by message), as in `vtc/install/claim/start/0.3` ("token ... and its claim code ... separately delivered") and OpenID4VCI's `tx_code`; wrong-code limit (upstream: five) | the QR holds no authorising value. The phone's signed claim, carrying a server challenge, the slot, the audience and the phone's key, makes the slot **pending**. The Farm page then shows a short code derived from the phone's key; the person confirms it on the page (or types the phone-displayed code into the page). Only then does the Farm bind |
| Bearer? | **Yes.** In a pool claim the phone's key is unknown in advance, so an attacker signs with their own key: **proof of possession does not stop a leaked handle claiming.** Controls are lifetime, single use and first-wins only | no secret in the QR; needs the second channel | no secret anywhere in the QR; a screenshot, a link preview, a scanner or a hijacking app gets nothing |
| Within DIDComm's "no private information in a QR" | deviates | within | within |
| Steps for the person | one scan | scan plus entering a code | one scan plus one tap on a screen already in front of them; no second channel, no account |
| Residual risk | whoever uses the handle first wins; a photographed code, a pasted link and a `keyring://` fallback all carry it | a code shown on the same screen as the QR is no second factor; a code is phishable | an attacker who controls the displaying page (a relay or phishing Farm page); reduced by the `from` list |
| Fits the frozen QR | yes (it is today's QR) | no (changes the Farm's QR and adds a channel) | **no**: it conflicts with the Farm's frozen QR, so it is a later phase and needs the Farm owners' input |
| Farm builds | nothing new; rate limits | second channel, code and limit logic | a challenge endpoint, a pending-claim state, a confirm UI, rate limits |

Notes common to all options:

- **Never spend a handle on GET.** A GET is made by link previews, chat unfurlers, mail and safe-browsing scanners and in-app browsers, and by the browser when App Links did not verify (C9). Single use is applied to the signed claim request. This is why a trigger causes no fetch (2.4 rule 2).
- **The legacy QR is Option A.** Its `callback_url` is the endpoint and the secret in one string, whose lifetime and single use are the Farm's (above). It is bearer, and the controls in section 8 apply to it.
- Option C reuses a comparison pattern Keyring already has: `keyring://vta/enrol` "carries a signed proof of the key and a code both screens compare" (Appendix A). VTI also forces a cross-device type-to-confirm for destructive operations. Both are precedents, not proof that C fits the Farm.
- If C is rejected, A with B's code as `tx_code` is the fallback and beats A alone.

### 7.1 Ownership after the claim

The Farm exposes the grant kind (`provision_vta` = owner, `grant_acl` = delegate). This is a **Farm assertion, usable to gate screens only.** After the key swap the phone SHOULD verify the fact itself: an `acl/list` (`acl/list/0.1` and `0.2` are on the phone's own send list) that shows the phone's key as the **sole super-administrator** entry, and refuse to call itself owner otherwise. The host operator still has infrastructure-level control of a hosted VTA; the claim screen says so and shows which Farm account, if any, the slot is provisioned under, from a signed response. The admin key is permanent once accepted: the 1-hour figure is the lifetime of Keyring's Farm progress credential and is **not** an admin grant window.

### 7.2 The Farm credential and login (Farm owner reply, data)

Registration of the Farm credential needs only a DID (the progress credential authenticates it); **login requires proof of possession** by a strict SIOPv2 `id_token`:

- header: only `alg=EdDSA`, `kid=<did>#<fragment>`, optional `typ=JWT`; payload exactly `iss`, `sub`, `aud`, `nonce`, `iat`, `exp`; `iss == sub`; Ed25519 only;
- the nonce is a challenge valid 120 seconds and one-time; `aud` is the `rp_did` from the public `GET /api/v1/auth/siop/metadata`;
- `did:key` is recommended; `did:webvh` and `did:peer` are accepted.

This is a separate phone-held Ed25519 `did:key`, **not a persona key**. Ed25519 is mandatory, so P-256-only hardware does not satisfy it (the current Keyring stack holds hardware keys as P-256/ES256 only: Appendix A), and the key is software-held. A pooled VTA is reached by DID plus mediator, never by hostname (pooled VTAs move to a separate DNS zone; names carry a random suffix such as `brave-otter-k7`). There is no recovery and the claim page says the instance is temporary. "Default manager", where the Farm uses it, means the PNM role; it is not a Keyring concept and the term is retired.

### 7.3 Pool draining (requirements on the Farm)

A scripted client of the Farm's QR page can drain the parked pool, and a scanned-but-never-connected slot is destroyed, not returned. The Farm SHOULD: rate-limit QR issuance per session and address, put a CAPTCHA or an account gate before showing a code, cap the number of pending claims, and destroy a pending claim on page timeout. Reserved-never-scanned slots already return to the pool and refund the link use (Farm owner reply).

## 8. Security

1. **A trigger confers no authority.** Everything in it is an untrusted hint (section 0). Acting on it is the consumer's policy; granting anything is the inviter's, decided on the signed request (6.1).
2. **A text never supplies an endpoint**, a key, a challenge or a task body. The endpoint comes from the inviter's DID document, and the only fetch in this profile is that DID resolution. (Legacy callbacks, version 0, are the one exception and are allow-listed, section 9.)
3. **No private information in a QR (DIDComm).** DIDComm says "no private information may be passed in the message" and that such a message "should not be passed via URL or QR code". The trigger carries no credential. A legacy callback does; section 7 treats it as bearer.
4. **Handles are not logged, shown in an error, a toast, a crash report or analytics, or sent anywhere but to the inviter** (in the first request). **The router MUST redact before anything logs.** Keyring's deep-link handler logs every link in full today (`logger.info(`Handling deeplink: ${deepLink}`)` at `TabStack.tsx:146`, in the Keyring core package) and the app's logger can ship logs off the device; a trigger link, or any text opened as a deep link, is written to device logs and possibly remote logs before any classifier runs. The legacy JSON is scan-only and does not pass that line: the scan path (`connectFromScanOrDeepLink`, `utils/helpers.ts`) logs only the channel ("qr scan"). A consumer MUST log at most the class of a link (scheme, flow slug or "trigger"), never the text, the handle or the contact. Two tests, one per path: feed a trigger link through the deep-link handler, and feed a trigger text and a legacy JSON through the scan path; assert in each that no logger call contains the text, the handle or the contact.
5. **Expiry and single use belong to the inviter.** A consumer never decides that a trigger is "still good" beyond `expired`.
6. **Limits are enforced before parsing** (1,536 characters, 1,024 bytes).
7. **An unknown flow or major is never read another way.** After `unknown-flow` or `unsupported-version` a consumer MUST NOT try another flow, another major or another parser.
8. **Failures are generic.** The reason codes are for tests and MUST NOT be shown to the person or sent to the inviter. Five messages exist: **update** (`unknown-flow`, `unsupported-version`): "This code needs a newer version of the app."; **expired** (`expired`): "This code has expired. Get a new one."; **scan only** (`wrong-channel`, which arises only for the legacy JSON): "Scan the code on the website's screen."; **unreachable** (`no-common-transport`, which arises after the trigger is accepted, section 6.2.1): "This service can't be reached from your wallet."; **invalid** (everything else): "This code can't be used." A reader MUST NOT say which field failed or whether a host was on a list. A consumer does not contact the inviter to ask why a code failed.
9. **Host list defects to avoid.** A list check on a host MUST reject an empty label (`.ic3.dev`, `a..ic3.dev`), a trailing dot, userinfo, a port, a fragment and control characters in the path, and MUST compare the whole host. The vectors include each (`allowedHostOf` accepts several today; Appendix A).
10. **Pool draining and the scheme fallback** are addressed in 7.3 and 2.7 item 5.

### 8.1 A handle alone is a bearer

A handle names a pending exchange. If the inviter treats possession of the handle as the authority to claim, the exchange is a **bearer** flow: anyone who sees the code (a photograph of the screen, a link-preview log, a CDN log) can use it, and **proof of possession by the claimant's key does not change that**, because the claimant chooses its own key. The only controls are lifetime, single use and first-wins, and the legitimate user who finds the handle already spent learns only that the code "can't be used". A handle MUST therefore never be the sole authority for anything the Farm cannot undo, and the options of section 7 exist for that reason.

### 8.2 Relay and same-device attacks on login

The login trigger sits on a screen other than the phone's; an attacker can start a login in their own browser and relay the portal's code to a victim, who scans it with Keyring (RFC 8628 section 5.4, "Remote Phishing"; RFC 10027 / BCP 247, *Best Current Practice for Security of Cross-Device Flows*, August 2026, and its relay and proximity guidance; both read in full text 2026-10-08).

- **The channel is not a control.** A stock camera hands the link to the app as a link, so refusing links would break the generic-camera requirement (2.5) and would do nothing against a relay. "Scanner only" is therefore not a control and is not used: all three channels are accepted for login (the vectors).
- **Mitigations, in the order they are cheap:** (1) **an inviter-signed screen** on the phone showing who requested the login: the community's name, the requesting browser and its coarse location and time, signed by the inviter's key over the wallet's request and checked against the contact's DID document before anything is shown; (2) **number matching** between the portal screen and the phone; (3) a short time to live (120 seconds); (4) a biometric on every approval; (5) **proximity**: RFC 10027 section 6.1.1 says proximity-enforced cross-device flows "are more resistant to CDCP attacks than proximity-less cross-device flows", while noting that the authorization server "cannot independently measure or enforce proximity on its own" (it relies on the surrounding systems); the same section list also names short-lived QR codes (6.1.2), one-time codes (6.1.3) and request binding with out-of-band data (6.1.17). The strongest precedent is CTAP 2.2 hybrid transport (section 11.5.1: the QR is `FIDO:/` followed by a digit-encoded CBOR payload, and "This transport requires a proof of proximity to help prevent attacks, thus notification of the connection attempt comes in the form of a BLE advertisement"). Keyring has no proximity transport; it is a later phase.
- **A held link outlives its 120 seconds.** A deep link arriving while the wallet is locked is held until unlock; the `expired` check at unlock handles that.

### 8.3 Threat table

| Actor | Asset | Channel | What it can do | Control |
|---|---|---|---|---|
| bystander or screenshot | a spendable handle (legacy callback; Option A) | the displayed code | claim first | Option C; lifetime, single use (7) |
| link preview, mail scanner, in-app browser | a handle | an `https` GET of the link | spend it, if the server spends on GET | never spend on GET (7); a trigger causes no fetch |
| another app that registers `keyring` | a link with a spendable handle | the `keyring://` fallback | receive it first (RFC 8252 section 8.1) | no `keyring://` button on a spendable handle (2.7) |
| relaying attacker | a login | the displayed code | have the victim approve the attacker's login | 8.2 |
| lookalike inviter | the person's trust | a QR on a phishing page | get a claim signed to a lookalike | `from` list; endpoint from the DID document; inviter-signed screen |
| script | pool slots | the Farm's QR page | drain the pool | 7.3 |
| device logs | a link | the deep-link handler | leak a handle | redaction (8 rule 4) |
| the operator of a hosted VTA | the agent | infrastructure | control it regardless of the key | said on the claim screen; `acl/list` check (7.1) |

## 9. The legacy format (version 0)

The Farm's existing code is a JSON object, not a link: `{"vta_did":"did:webvh:…","callback_url":"https://…"}`. It is **version 0 of the same model**: the contact is `vta_did`; the endpoint and the secret are `callback_url`.

- Exactly these two keys must be present. **A reader ignores any other key and reports it (`legacy.x`).** Today's Keyring rejects an extra key (`parseAgentHostQr` requires exactly the two; Appendix A), and that is the blocker the Farm owner reply names: **the Farm keeps the QR frozen, with no extra key, until a Keyring release ignores unknown keys.** No such release is queued (the changelog's 0.2.0 section is "Unreleased"; the latest tag is `staging-v0.2.0-241`). The vectors encode the behaviour of that release; no earlier release does.
- `callback_url` is HTTPS on a host on the consumer's list (`ic3.dev`, `firstperson.dev`, which the Farm's server-side construction keeps true), at most 512 characters, with the host rules of section 8 rule 9. `vta_did` is a `did:webvh` DID of at most 256 characters.
- **Reading order and reasons** (stop at the first failure): (1) not a JSON object, or no `callback_url` key: `not-ours`; (2) the channel is not `scan`: `wrong-channel`; (3) `vta_did` or `callback_url` absent: `missing-param`; (4) `vta_did` not a string, or not a `did:webvh` DID of at most 256 characters, or `callback_url` not a string: `bad-value`; (5) `callback_url` a string that is not HTTPS, is over 512 characters, or whose host fails the list or the rules of section 8 rule 9: `callback-not-allowed`. A wrong type is a `bad-value`, never a host failure. All three map to `invalid` in the UI (section 8 rule 8), as `wrong-channel` maps to `scan only`.
- QR only: from a pasted text or a link it is `wrong-channel`.
- Accepted for as long as the Farm emits it. **Sunset: to be set by the owners (Q9).** The wallet SHOULD log (the class of link only, never the text) when the legacy path is used, to see when it is safe to retire.
- A text that is not a JSON object, or has no `callback_url` key, is `not-ours`.
- The callback is single-use per DID and is the bearer credential (7). It is never logged.

## 10. Texts outside this document

- **`keyring://vta/enrol?o=…`** is a lab and self-hosted flow with no marker, so it is `not-ours` here and nothing in this document changes it. Neither the Farm nor a portal is asked to emit or read it. It stays lab-only. Its parser tolerates trailing parameters; do not build on that.
- Other texts a consumer reads (links to waiting approvals, community and invitation links, ticket links, bare DIDs, OpenID4VCI offers, DIDComm v1 invitations) are the consumer's own and are `not-ours` here.
- A bare DID in a QR is what the upstream browser plugin and VTC page draw to say "connect to this agent or community". It is a different, simpler purpose and stays.

## 11. Change process

1. **Adding a flow** is a written proposal naming: the flow and its Type URI and authority; inviter and consumer; whether an expiry is required; channels; whether the `from` list applies; and test vectors. One named owner each for the Farm, the VTC portals and Keyring reviews it.
2. **A new task version** follows the framework: additive is a MINOR, anything breaking a MAJOR (section 4); at MAJOR 0 producers keep the previous version working (section 4 rule 2). A consumer's supported list changes in a release.
3. A published slug or Type URI is never edited or reused.
4. **The container** changes only by a revision of this document that readers of the previous revision reject by `wrong-type` or `bad-invitation` rather than misread.
5. The host lists, the authority set and the sunset of the legacy format change by the same process; each registered change bumps the registry revision and is announced to all three owners with new vectors. Owners and contacts: **to be named** (Q10).
6. **If adopted under Trust Over IP** (section 5.1, unconfirmed) the document follows that task force's process (`CONTRIBUTING-SPECS.md` in `dtgwg-trust-tasks-tf`, not read in detail).

## 12. Conformance

`keyring-qr-and-links.vectors.json` lists, for each case, an `id`, a `group`, an `input`, the `channel` (`scan` unless stated), and the expected result: `outcome`, and for a reject the `reason` (section 3) and `ui` (section 8 rule 8); for an accept `via`, `from`, `id`, `exp`, `flow`, `task`, `ignored` (and `callbackUrl` for the legacy format). `config.now` is the reader's clock. An accept result carries `tp` only when at least one usable transport name remains. A consumer conforms if it gives the expected result for every vector under the configuration at the top of the file (for the container it implements).

The set (201 cases) covers: valid triggers of both containers and both flows, the `keyring://` alias, extra parameters and members, the flow hint and its versions (the draft MAJOR 0 rule, a higher MINOR of a stable test flow, unknown MAJOR, leading-zero and missing minors), the authority set (a second accepted authority, an unknown one, a lookalike, private DID and URN forms, a binding URI), expiry (accepted, equal to now, past, malformed, required and absent), the contact and the `from` list, the handle's length and alphabet, the invitation's type, attachments and duplicate members, the length limits, link grammar (scheme, authority, path, fragment, parameters), base64url faults, the `_oobid` rejection, the three channels for both flows, and the legacy format (including unknown keys ignored), the transport hint (names kept, dropped and reported; never a rejection), and an endpoint member in the text (ignored and reported).

`selectionVectors` is a second list of 17 cases with its own shape: the contact's DID document (with a `verified` flag), optionally a `textEndpoint`, a `legacyCallback` or a `tp`, and the wallet's configuration in `config.selection`; the expected result is a `select` (binding, endpoint, source), `no-common-transport` or a `reject` (`did-document-unverified`, `callback-not-allowed`), each with `sent: false` where nothing is sent. They cover: the services chosen by type and not by id, the wallet's preference winning over document order, `accept` not selecting, a hint that cannot add or override, a TSP-only and a service-less and an unrelated-service document (the no-common-transport outcome), an endpoint in the text, which is ignored whether it is absent from or equal to the document's (the document's endpoint is taken), an unverified document, and the allow-listed and unlisted legacy callback.

**What the vectors do and do not test.** They fix a reader's parsing from this document alone. **They do not test Keyring's parsers or selection code** (which do not read these formats yet), DID resolution or verification itself, the first request, that the reply arrives on the selected binding, any secret-handling rule, redaction of logs, or what any phone does with a link. A throwaway reference reader written from sections 2 and 3 agrees with all 201 trigger vectors and all 17 selection vectors; **that shows the vectors and this text are consistent, nothing more.** Task payloads do not appear in the vectors because a trigger carries none. The Type URI authority `trusttasks.org` is provisional (5.1); `tasks.example.org` and the slug `example-stable` are test-only. The URL parameter names are placeholders.

### 12.1 Generic camera acceptance tests (device, manual)

The vectors cannot test what a phone does with a link, so conformance of a producer's domain and of a wallet build also requires these runs, on the real devices and OS versions the parties name, using a real code from the inviter's real domain. Record for each: device, OS version, camera or scanner app and version, wallet build, date, tester, pass or fail. **Every expected result is a hypothesis built from section 2.5 until the run is recorded; none has been run, and camera and QR-app behaviour with custom schemes in particular is unverifiable from documents.**

| # | Setup | Action | Expected |
|---|---|---|---|
| C1 | iOS, stock Camera, wallet installed, build declares the link domain, files published | point Camera at the `https` code (lock screen and unlocked) | a notification for the link; tapping opens the wallet on the flow's screen, not Safari; the link reaches section 3's reader unchanged |
| C2 | Android, stock camera (and the Google app's Lens, as a second run), wallet installed and verified for the domain | point at the code | the scanner offers the link; opening it opens the wallet directly; if it opens the browser instead, the landing page (2.7) must get the person into the wallet in one tap |
| C3 | a third-party QR scanner on each OS (one with an in-app browser, one that hands off to the system) | scan | the URL reaches the wallet or the landing page; an in-app web view that does not hand `https` to the system is a recorded limitation |
| C4 | wallet not installed, each OS, each path of C1 to C3 | scan | the landing page loads (2.7): plain instructions, a store link per listed wallet; no handle shown; install, then scan again, and C1 or C2 passes |
| C5 | two wallets installed, both listed in the domain's files, only one a Keyring build | scan on each OS | iOS: a prompt, choice remembered (record current behaviour). Android: record which opens (documented: the most recently installed) and the user steps needed to change it |
| C6 | control: a code whose text is `keyring://…` only | scan with each camera path | record what each does. Not expected to pass; evidence for demoting the alias |
| C7 | negative: build that does not declare the domain, files list it | scan | not opened by the wallet (both halves are needed); landing page loads |
| C8 | negative: AASA or `assetlinks.json` through a redirect | install, scan | not opened by the wallet |
| C9 | Android 12 or later, wallet installed, domain not yet verified | scan | the browser opens; after the user selects the domain under **Open by default** the wallet opens. **The landing page must not spend the handle on this GET** |
| C10 | wallet locked, or cold start, each OS | scan | the link is held until unlock, then routed as section 3; a login trigger held past its `exp` is `expired` |
| C11 | the real sizes of each container (X and Y) | render the QR at the size the inviter's page uses, scan from a monitor at about arm's length on a low-end phone | reads within a few seconds on each path; record time and symbol version; a failure is a size finding for T1 |
| C12 | AASA or `assetlinks.json` changed after install | follow Apple's 24-hour CDN and weekly re-check, Android's propagation (15 and higher) | record how long a domain change takes to reach an installed wallet |

## 13. Open questions

**Decisions for the team:**

- **T1. Container** (section 2.3): X (OOB invitation, no attachment) or Y (plain link, fixed parameters)? Needs the Trust Tasks view on a Type URI in `goal_code` (X) or on a link profile (Y).
- **T2. Claim authorisation** (section 7): A (handle, bearer), B (second-factor claim code), C (no-secret QR plus signed claim confirmed on the Farm page, later phase)? Owned by the Farm.
- **T3. Link domains** (2.6): neutral shared, wildcard, or per-inviter; and whether the Farm wants its own app to open Farm links (Android install-order rule).
- **T4. Contact as URL.** Is an `https` origin contact (resolved to a DID by configuration) needed, beyond the legacy callback?
- **T5. First request with no hint** (6.3).
- **T6.** Are 1,536 characters, 1,024 bytes and 16 to 128 handle characters the right limits? Proposals, not taken from a Farm or VTC contract.
- **T7. Transport preference order** (6.2.1): which binding a wallet ranks first when the inviter offers several, and whether the `tp` hint may break ties. A wallet decision; recorded here because inviters need to know it.

**For the Trust Tasks expert (Brendan will ask):** the exact upstream term and source for "trigger" (section 0); whether a Type URI is an acceptable DIDComm `goal_code` value; whether a trigger profile belongs to a task-force document; the authority move (4 rule 6).

**Other:**

- **Q1. Authority** for the Keyring-published tasks (5.1). Unconfirmed.
- **Q3.** What does a TSP-based inviter show (6.2)?
- **Q5.** Should the invitation be signed, and where does a consumer find the key?
- **Q8.** Should `service` and `relativeRef` DID URL parameters name the claim endpoint?
- **Q9.** What ends the legacy format?
- **Q10.** Who are the named owners, and where does this document live when it leaves draft?
- **Q13.** Do `auth/authenticate/0.3` and `auth/step-up/*` fit login without change (6.4)? Fit not verified.
- **Q16.** Is a fragment form worth defining for a non-DIDComm reader, given server logs (query parameters reach logs and analytics; RFC 9110 excludes the fragment from the target URI)? This version uses the query. A producer SHOULD serve the landing page with no third-party scripts, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and a host SHOULD NOT log the query of these paths.
- **Q18. Rank of several services.** How do DID Core or the upstream Trust Tasks documents rank several services in one DID document? Not verified; 6.2.1 uses the consumer's own preference.
- **Q17. Unverified platform behaviour** (the camera and QR-app paths, and the open items of 2.5), answered by 12.1.

**Questions the Farm owners put to Keyring (Farm owner reply):**

- F-a. Which Keyring release ignores unknown keys in the agent-host QR, and when?
- F-b. Can Keyring mint strict SIOPv2 `id_token`s (section 7.2), and when?
- F-c. Which DID method will the login identity use?
- F-d. Does Keyring need hostname access to a pooled VTA, or only DID plus mediator?
- F-e. What does admin-side revocation look like for Keyring?
- F-f. Can any Keyring target hold Ed25519 in an enclave?
- F-g. What happens if the login registration fails after the VTA is `connected`?
- F-h. Can Keyring read the ownership signal inside the VTA session (section 7.1), not only from the Farm?

## 14. References

- [DIDComm v2.1] DIF, DIDComm Messaging v2.1, Editor's Draft, "Out Of Band Messages", message headers and thread sections (fetched 2026-10-08).
- Trust Tasks framework (`dtgwg-trust-tasks-tf`): the pin `bdae1cf9` (framework 0.5) and `origin/main` `7b6bb488` (working draft 0.7.0) for Compatibility Rules, Migrating Between Versions, Type URI, Stability, Private and Unpublished Specifications, Audience Binding, Bearer Specifications, The `ceremony` Member, Consumer Requirements, Specification Requirements, Governance Considerations, Binding Namespace; `bindings/didcomm/0.2`, `bindings/https`, `bindings/push/0.1`, `bindings/tsp/0.1`; the specs of 6.4; `docs/design-notes/trust-ceremonies.md`.
- DTG VSC Predicate Registry, `GOVERNANCE.md` (`dtgwg-vsc-registry` `origin/main` `54a13abe`; not pinned).
- RFC 8252 (BCP 212) sections 7.1, 7.2, 8.1, 8.4. RFC 8628 sections 3.3.1 and 5.4. RFC 10027 (BCP 247), *Best Current Practice for Security of Cross-Device Flows*, August 2026, section 6.1.1. FIDO CTAP 2.2 (PS 2025-07-14) section 11.5.1. OpenID4VCI 1.0 (`tx_code`). W3C DID Core 1.0 section 3.2. RFC 9110 sections 7.1, 10.1.3, 17.11. RFC 3986.
- ToIP TSP specification, Experimental Implementor's Draft Rev 3 (out-of-band introduction).
- Apple, "Supporting associated domains", "Allowing apps and websites to link to your content", `applinks`; WWDC 2017 session 206. Android, "Verify Android App Links", "About Android App Links", "Create deep links to app content", "Configure website associations"; Google, Digital Asset Links. Denso Wave, QR Code version information (`qrcode.com`).
- Farm owner reply (external artifact, 2026-10-08, treated as data), cited as "Farm owner reply".

---

## Appendix A. Keyring implementation notes (non-normative)

For the Keyring side only. None of this binds the Farm or a portal. Paths are in the bifold submodule under `bifold/packages/core/src/` unless stated.

- **The legacy parser and its blocker.** `parseAgentHostQr` (`modules/trust-tasks/module/agentHostConnection.ts:152-172`) requires exactly the sorted keys `callback_url` and `vta_did` and returns undefined for any other key set. The minimal fix is to require the two keys and ignore the rest. The test case `'an extra member'` (`modules/trust-tasks/__tests__/agentHostConnection.test.ts`, about line 49) must flip from "not a QR" to accepted. No release is queued (changelog 0.2.0 "Unreleased"; latest tag `staging-v0.2.0-241`).
- **Credo on a v2 invitation, receiver side** (read from `node_modules/@credo-ts/didcomm`, `DidCommOutOfBandApi.receiveInvitation` and `DidCommConnectionsApi.acceptOutOfBandInvitation`, **not run**): it saves a receiver-role out-of-band record, then accepts the invitation with handshake protocol `None`, which creates a connection and, when no `ourDid` is given, a `did:peer:2` through `createPeerDidForV2OOB`. This is why container X would make a connection as a side effect (section 2.3).
- **`allowedHostOf` has defects**, `agentHostConnection.ts:121-126` (`/^https:\/\/([a-z0-9.-]+)(\/[^\s]*)?$/i`, then `host === site || host.endsWith('.'+site)` against `AGENT_HOST_SITES`): it accepts `https://.ic3.dev/x`, `https://a..ic3.dev/x`, a fragment after a path and control characters in the path. In every accepted case the host still ends in an allowed name. **Follow-up code fix, not part of this change:** parse the host into labels, reject empty labels, a trailing dot, `#` and control characters, and share one implementation with any later host check.
- **The deep-link log.** `navigators/TabStack.tsx:146` logs every deep link in full (section 8 rule 4); `UTIL_LOGGER` is a remote logger toggled in `app/src/screens/Developer.tsx`.
- **Does Keyring ingest a v2 `_oob` link today? Partly, and not by flow.** `modules/trust-tasks/module/vtiLinks.ts` has no `https` or `_oob` classification (a comment at about `:103` is the only mention). The generic path, `utils/helpers.ts:1127-1224` (`connectFromInvitation`, `oob.receiveInvitation`, `processBetaUrlIfRequired`), hands a v2 `_oob` link to Credo as an ordinary connection invitation. Container X therefore needs the Keyring router to intercept first.
- **Credo on an attachment-only invitation** (read from `node_modules/@credo-ts/didcomm`, `0.7.1-pr-2704-20260909134930`, **not run**): `DidCommOutOfBandApi` (about `:455-462`) calls `connectionsApi.acceptOutOfBandInvitation` with no handshake (a connection to `from`), then `emitWithConnection` (about `:636`) takes the first attachment whose `@type` is a supported message type, otherwise throws "There is no message in requests~attach supported by agent." A Trust Task document carries `type`, not `@type`, so the attachment fails dispatch with "Invalid message type". **Unverified at runtime.** `_oobid`: Credo has no `_oobid` name; its short-URL fallback GETs any URL without `_oob`/`oob`/`c_i` (no allow-list).
- **No SIOP or `id_token` minting exists in Keyring.** Reusable: `signCompactJws` (`modules/trust-tasks/module/vtiInvitationOffer.ts:175`, from `@bifold/trust-tasks`). `VtiMediatorTransport.login` (about `:533`) is authcrypt DIDComm, not SIOP. The VTC proposal's rule that "the phone never signs an `id_token`" and the plan's grep guard must be **scoped to persona keys and the login module**, because the Farm login identity (7.2) is a separate phone-held Ed25519 `did:key` that does sign an `id_token`.
- **Persona keys do reach the phone.** `VtaClient.borrowKey` (`VtaClient.ts:1683-1691`) copies persona keys over `keys/export-secret/0.1`; callers: `VtaClient.ts:1627`, `:1630`, `:1717`, `vtaRotation.ts:78-79`, `vtaKeyMigration.ts:83-84`, `app/src/screens/Developer.tsx:629`.
- **Ed25519 hardware custody is not possible on the current stack:** Credo's `SecureEnvironmentKeyManagementService` is P-256/ES256 only, `expo-secure-environment` is secp256r1, and `react-native-attestation` is P-256. The Farm login key is software-held.
- **`acl/list`.** `VtaClient.listAcl` (`VtaClient.ts:1284`) calls `acl/list/0.1` (or `0.2`); both are on the phone's own send list (`approvalRules.ts:62-63`). It returns every entry the caller may audit; the sole-super-administrator check of 7.1 filters the result.
- **`keyring://vta/enrol`** lives in `bifold/packages/trust-tasks/src/enrolment/offer.ts`; its lab page is `scripts/openvtc/local-vti-stack/enrol-page`.
- **Native link configuration today.** iOS entitlements `app/ios/AriesBifold/AriesBifold.entitlements:5-11` declare `applinks:wallet.asml.berkmancenter.org` and `applinks:witness.asml.berkmancenter.org`, each also with `?mode=developer`. Android `app/android/app/src/main/AndroidManifest.xml:50-84` declares the Keyring schemes in one filter (no `autoVerify`) and two `autoVerify` `https` filters for the same two hosts. **No Farm, portal or `ic3.dev` domain is declared on either platform**, so no link of this document opens in Keyring from a camera without a wallet release (G8).
- **Upstream clones.** The VTI pin `822ff78a` is present in the clone and is an ancestor of `origin/main` (`49f5f1be`); the working tree is still at `187ad9cd`, 906 commits behind the pin, so anything read in the working tree is off-pin. `vta-service/src/operations/vault/proxy_login.rs` exists at the pin. `vtafarm-api` is not cloned: every statement about the Farm is from the Farm owner reply and is unverified here.
- **The reference reader** that checked the vectors is a throwaway script outside the repository. It does not test Keyring's parsers.
