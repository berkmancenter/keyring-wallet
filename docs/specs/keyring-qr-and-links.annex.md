# QR codes and links that trigger an exchange: annex (non-normative)

**Status:** DRAFT, non-normative. Dated 2026-10-08. Author: bm. Companion to [`keyring-qr-and-links.md`](./keyring-qr-and-links.md) (the core, which is the only normative text) and [`keyring-qr-and-links.vectors.json`](./keyring-qr-and-links.vectors.json) (which test the core only).
**What this is.** Material moved out of the core when it was cut to a minimal contract: a recorded alternative container, Farm design discussion, platform restatements (Apple, Android), restatements of upstream framework rules, Keyring implementation notes. Nothing here is a requirement, no vector covers it, and where it differs from the core the core wins. Sources and their verified or unverified marks are as in the plan's companion (`docs/plans/one-scan-and-vtc-sign-in-plan/2026-10-08-bm.md`, appendix).
**Numbering.** Each part says which section of the pre-slimming draft (the text at commit `be56dfb6`) it came from. A reference written "section N" or "rule N" inside the text of a part is to that pre-slimming numbering, not to the core's. Where the text mentions `Q`, `T`, `F-` identifiers, they are the draft's own; the plan's section 11 is the live list and Annex G says what became of each (T7 and the `tp` hint are withdrawn).

---

## Annex A. Container X: a DIDComm v2.1 out-of-band invitation with no attachment (was section 2.1; recorded alternative, not part of v1)

Why it is not in v1: on receipt Credo creates a `did:peer` connection and an out-of-band record before it looks at the goal (so the router must intercept the link first); the text is about twice the size of container Y; `goal_code` is not namespaced as DIDComm asks ("goal codes defined outside of this spec MUST use Reverse Domain Name Notation"), and a Type URI is not that form; and a handler for it has to be written. If it is ever adopted it also needs: canonical base64url (RFC 4648 section 3.5: no non-zero trailing bits), the duplicate-member rule of I-JSON (RFC 7493 section 2.3), and `attachments` absent or empty. The text below is as drafted, with the display-string and transport-hint members removed.

A plaintext DIDComm Messaging v2.1 out-of-band invitation ([DIDComm v2.1], "Out Of Band Messages"), in the `_oob` query parameter of a link:

```
https://<domain>/<path>?_oob=<base64url, no padding, of this JSON in UTF-8>
{
  "type": "https://didcomm.org/out-of-band/2.0/invitation",
  "id": "<handle>",
  "from": "<the inviter's DID>",
  "expires_time": <integer UTC epoch seconds, optional>,
  "body": { "goal_code": "<flow hint: a Trust Task Type URI, optional>" }
}
```

- `type`, `id` and `from` are the members DIDComm requires; `from` is "REQUIRED for OOB usage" there. `expires_time` is DIDComm's own message header (UTC epoch seconds, optional; "When omitted ... the message is considered to have no expiration by the sender"), used here as the expiry. The invitation `id` is the handle, and by DIDComm's thread rules it is what the first reply's `pthid` names (DIDComm "Message Correlation"; the mapping is this profile's choice).
- **No attachment.** `attachments` is absent or an empty array; any other value rejects (`attachments-not-allowed`). An attachment is never read, never dispatched, and never ignored silently: a trigger carries no task body. (An attachment-only v2 invitation is accepted by Credo's out-of-band handling at the connection level and then fails with "Invalid message type", because the attachment carries `type`, not `@type`: read from code, not run; Appendix A.)
- `goal_code` carries the flow hint as a Type URI. DIDComm calls `goal_code` "self-attested" and says "goal codes defined outside of this spec MUST use Reverse Domain Name Notation with the associated effort's domain as a prefix" (DIDComm v2.1, Goal Codes); a Type URI is not that form, so using one deviates from that sentence (a T1 con). The flow is still named once (the Type URI), not twice. Whether DIDComm tooling tolerates a Type URI there was not checked. A bare string such as `vta-claim` is `bad-type`.
- `body.accept` and `created_time` are DIDComm members this profile never reads and does not report. (DIDComm's `accept` is an ordered list of media types for the message; it is not a transport selector.)
- Other members are ignored and reported (`invitation.x`, `body.x`). Duplicate member names anywhere in the JSON reject the invitation (`bad-invitation`), so two readers cannot disagree about one text.
- The invitation MAY be signed (DIDComm: it "may be signed to provide tamper resistance"). This version does not require it and defines no place for the signature (open question Q5).

## Annex B. Delivery, camera apps, link domains, landing page (was sections 2.4 rules 1, 2 and 5, 2.5, 2.6, 2.7 and 12.1)

1. **`https` is primary and the only form shown to a generic camera.** RFC 8252 section 7.2: a claimed `https` URI "SHOULD" be preferred because the operating system establishes which app receives it. `keyring://` is a convenience alias for Keyring's own scanner, the paste screen and the lab, carrying the same host, path and query. RFC 8252 section 7.1 asks a private-use scheme to be a reverse domain name (`keyring` is not) and section 8.1 says several apps can register one scheme, so which app receives a `keyring://` link is "indeterminate". Nothing that matters may depend on the alias reaching only Keyring (section 8).

2. **A trigger never causes a fetch.** DIDComm's `_oobid` (a GET whose response format DIDComm does not define) is not part of this profile and rejects (`unsupported-form`). There is no host allow-list for a fetch because there is no fetch, and no secret is spent by a GET (section 8.1).

5. **Length.** The whole text is at most 1,536 characters and the invitation JSON at most 1,024 bytes (proposals, T6). A consumer checks the text length first. DIDComm gives no byte limit: it says only that some messages are "too long to produce a useable QR code". The largest symbol, version 40, holds 2,953 bytes at error-correction level L, 2,331 at M, 1,663 at Q and 1,273 at H in byte mode (Denso Wave, `qrcode.com`, read 2026-10-08); how reliably a given phone reads a given symbol from a monitor at arm's length is **unverifiable from a document** and is what test C11 measures. Producers SHOULD keep the text small; both containers are far below the limits.

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

## Annex C. Upstream restatements: identifiers, first request, transport selection, fitting tasks (was sections 4 rule 4, 6.1, 6.2, 6.2.1, 6.4)

**Identifier rules (was section 4 rule 4).** (framework 0.7.0, Type URI, Stability, Private and Unpublished Specifications; DTG VSC Predicate Registry governance, identifiers): the slug is lowercase and hyphen-separated; the version is the last path segment and is `MAJOR.MINOR` (the reserved slug `trust-task` carries three parts and is not used here); the scheme MUST NOT be `http`; the public registry form is `https://trusttasks.org/spec/<slug>/<MAJOR.MINOR>`; a **private** specification MAY use a DID URL or URN form and MUST NOT be served from or claim `trusttasks.org`, and such an identifier is a different one from any registry identifier (this reader files it under `unknown-flow`); no query; a fragment only where the framework defines one; `trust-task*` and `trust-ceremony*` slugs and the `/binding/` and `/ceremony/` subtrees are reserved, so a binding URI as a hint is `unknown-flow`; a published identifier is never edited, a change is a new version. The VSC registry has no releases ("is not tagged and has no release versions of its own"; `GOVERNANCE.md`, `dtgwg-vsc-registry` `54a13abe`) and is for predicates only, so this document pins nothing there.

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
5. **No common transport.** If there is no candidate, the outcome is `no-common-transport`: the consumer sends nothing and shows "This service can't be reached from your wallet." (section 8 rule 8). It does not fall back to an endpoint from the text, to another binding it did not select, or to the generic connection path.
6. **One binding for the exchange.** The first request and the reply use the selected binding. A reply that arrives on another binding is not accepted as the reply.
7. **The endpoint comes from the DID document, never from the trigger.** The reader recognises no member of the text as an endpoint: any member this version does not define, whatever its name or value, is ignored and reported (sections 2.1 and 2.2) and is never used, so an appended parameter cannot end or redirect an exchange. The one endpoint in a text that is ever used is the legacy Farm callback (section 9), on a host of the consumer's allow-list.


**Out of scope, and a future profile: the device-to-device case.** Everything above assumes an inviter that runs a service reachable by a binding. When the holder of the QR **is** the endpoint (no server; for example the mutual-attestation anchors of the Trust Tasks ceremonies, or two phones exchanging a credential), the code must carry how to reach the device. ISO/IEC 18013-5 device engagement lists the retrieval methods in the code, and CTAP 2.2 hybrid transport fixes a BLE advertisement plus a tunnel and puts the routing data in the QR (section 11.5.1); both are precedents, and ISO 18013-5 was not read (paywalled; unverified). A profile for that case would add a `transports` list to the trigger, with the routing data each entry needs, and would require a proximity check (section 8.2). It is not defined here, and nothing in this version is a basis for it.

### 6.4 Upstream Trust Tasks that fit, and where they do not

Checked at `origin/main` of `dtgwg-trust-tasks-tf` (`7b6bb488`, 2026-10-05; the pin is `bdae1cf9`, so these specs are **not in the pinned copy**). Every task named is `status: draft`.

| Upstream task | `vta-claim` | login |
|---|---|---|
| `vtc/invitations/deliver/0.1` (an OID4VCI offer "small enough for a QR code"; code redeems only for a key-binding proof by the invited DID) | **Pattern only.** The invited DID is known when the offer is made; a pool claim's is not. A precedent for "a small offer, redeemable only with a key", and **not** for a Trust Task in a QR | not relevant |
| `vtc/install/claim/start/0.3`, `finish/0.3` (install token plus a separately delivered `claimCode`, a challenge, a step-up approver) | **Pattern only**, and the model for Option B (section 7). The token must name an admin DID; the subject is a community | not relevant |
| `auth/step-up/approver/invite/0.1`, `redeem/*` (single-use invite URL plus a separate code; five wrong codes void it) | pattern only | not relevant |
| `vault/sign-trust-task/0.2` (draft; a vault consumer asks the maintainer to attach an `eddsa-jcs-2022` proof as the principal DID of a `didSelfIssued` or `didcommPeer` entry; `issuer` must equal the principal; capability `SignTrustTask`; policy may require step-up) | not relevant | **fits** the key-grant sign-in: the VTA signs `auth/oob/respond` as the chosen DID (verified at the VTI pin; the VTC side is not in the pin) |
| `auth/authenticate/0.2`, `0.3` (0.3: a delegate such as a holder's VTA authenticates a principal) | not relevant | not used by the key-grant sign-in; the Farm login's SIOPv2 `id_token` is a separate matter (7.2) |
| `auth/step-up/approve-request/0.4`, `approve-response/0.6` | not relevant | **a partial fit only**: a bound-operation or `task-consent` task may fit a login consent better; the fit is **not verified** |
| `auth/passkey/enroll/invite/0.2` ("never carried in the URL"; two channels) | pattern only | not relevant |
| `bindings/push/0.1` (the Trigger role; a contentless doorbell whose payload is an untrusted hint) | the closest upstream stance for how a consumer treats a trigger | same |
| `vtc/admin/events/event/0.1` ("A hint is a trigger to re-read") | the other upstream use of the word | same |
| pool claim, Farm, `auth/oob/*`, `auth/cross-device/*`, `qr-login` | **no upstream task** (`git grep` at `7b6bb488`: one unrelated hit, a persona "pool claim" schema description; `specs/auth/` has no `oob` or `cross-device` directory at the pin or at `origin/main`) | **no upstream task**: the pairing is a new type |

**Ceremonies.** Trust Ceremonies are in the framework at `origin/main`: the `ceremony` member and the `/ceremony/` namespace are normative (framework 0.4 and later: The `ceremony` Member; Ceremony Namespace), the design note `docs/design-notes/trust-ceremonies.md` is marked "Draft — proposed, not implemented", and ceremony definitions exist for `vtc/member-onboarding`, `vetting/identity-vetting` and `mutual-attestation`. `mutual-attestation` anchors on "a scanned code ... a compared short authentication string". **No ceremony definition defines an entry or trigger or a QR format**, and "Membership Is a Claim, Not a Permission": a `ceremony` member grants no authority. A trigger MAY open a ceremony by naming it in the first request; wallets MAY tag their exchanges with the `ceremony` member as a **claim only**. (VTI's "ceremonies" documents describe a different, server-side policy pipeline whose "trigger" is an authenticated actor; they are not this.)

## Annex D. Claim authorisation and the Farm (was sections 7, 7.1, 7.2, 7.3 and the Farm owners' questions F-a to F-h)

No option is chosen here; the plan records the working position (A hardened in v1, C the phase 2 target, B only if C is impractical). The relay risk the plan records (an attacker relaying a code issued from the attacker's own Farm account) is **not verified** and is not analysed in this annex.

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

#### 7.1 Ownership after the claim

The Farm exposes the grant kind (`provision_vta` = owner, `grant_acl` = delegate). This is a **Farm assertion, usable to gate screens only.** After the key swap the phone SHOULD verify the fact itself: an `acl/list` (`acl/list/0.1` and `0.2` are on the phone's own send list) that shows the phone's key as the **sole super-administrator** entry, and refuse to call itself owner otherwise. The host operator still has infrastructure-level control of a hosted VTA; the claim screen says so and shows which Farm account, if any, the slot is provisioned under, from a signed response. The admin key is permanent once accepted: the 1-hour figure is the lifetime of Keyring's Farm progress credential and is **not** an admin grant window.

### 7.2 The Farm credential and login (Farm owner reply, data)

Registration of the Farm credential needs only a DID (the progress credential authenticates it); **login requires proof of possession** by a strict SIOPv2 `id_token`:

- header: only `alg=EdDSA`, `kid=<did>#<fragment>`, optional `typ=JWT`; payload exactly `iss`, `sub`, `aud`, `nonce`, `iat`, `exp`; `iss == sub`; Ed25519 only;
- the nonce is a challenge valid 120 seconds and one-time; `aud` is the `rp_did` from the public `GET /api/v1/auth/siop/metadata`;
- `did:key` is recommended; `did:webvh` and `did:peer` are accepted.

This is a separate phone-held Ed25519 `did:key`, **not a persona key**. Ed25519 is mandatory, so P-256-only hardware does not satisfy it (the current Keyring stack holds hardware keys as P-256/ES256 only: Appendix A), and the key is software-held. A pooled VTA is reached by DID plus mediator, never by hostname (pooled VTAs move to a separate DNS zone; names carry a random suffix such as `brave-otter-k7`). There is no recovery and the claim page says the instance is temporary. "Default manager", where the Farm uses it, means the PNM role; it is not a Keyring concept and the term is retired.

### 7.3 Pool draining (requirements on the Farm)

A scripted client of the Farm's QR page can drain the parked pool, and a scanned-but-never-connected slot is destroyed, not returned. The Farm SHOULD: rate-limit QR issuance per session and address, put a CAPTCHA or an account gate before showing a code, cap the number of pending claims, and destroy a pending claim on page timeout. Reserved-never-scanned slots already return to the pool and refund the link use (Farm owner reply).

**Questions the Farm owners put to Keyring (Farm owner reply):**

- F-a. Which Keyring release ignores unknown keys in the agent-host QR, and when?
- F-b. Can Keyring mint strict SIOPv2 `id_token`s (section 7.2), and when?
- F-c. Which DID method will the login identity use?
- F-d. Does Keyring need hostname access to a pooled VTA, or only DID plus mediator?
- F-e. What does admin-side revocation look like for Keyring?
- F-f. Can any Keyring target hold Ed25519 in an enclave?
- F-g. What happens if the login registration fails after the VTA is `connected`?
- F-h. Can Keyring read the ownership signal inside the VTA session (section 7.1), not only from the Farm?

## Annex E. Security detail (was section 8 rules 4, 9 and 10, and sections 8.1, 8.2, 8.3)

4. **Handles are not logged, shown in an error, a toast, a crash report or analytics, or sent anywhere but to the inviter** (in the first request). **The router MUST redact before anything logs.** Keyring's deep-link handler logs every link in full today (`logger.info(`Handling deeplink: ${deepLink}`)` at `TabStack.tsx:146`, in the Keyring core package) and the app's logger can ship logs off the device; a trigger link, or any text opened as a deep link, is written to device logs and possibly remote logs before any classifier runs. The legacy JSON is scan-only and does not pass that line: the scan path (`connectFromScanOrDeepLink`, `utils/helpers.ts`) logs only the channel ("qr scan"). A consumer MUST log at most the class of a link (scheme, flow slug or "trigger"), never the text, the handle or the contact. Two tests, one per path: feed a trigger link through the deep-link handler, and feed a trigger text and a legacy JSON through the scan path; assert in each that no logger call contains the text, the handle or the contact.

9. **Host list defects to avoid.** A list check on a host MUST reject an empty label (`.ic3.dev`, `a..ic3.dev`), a trailing dot, userinfo, a port, a fragment and control characters in the path, and MUST compare the whole host. The vectors include each (`allowedHostOf` accepts several today; Appendix A).

10. **Pool draining and the scheme fallback** are addressed in 7.3 and 2.7 item 5.

### 8.1 A handle alone is a bearer

A handle names a pending exchange. If the inviter treats possession of the handle as the authority to claim, the exchange is a **bearer** flow: anyone who sees the code (a photograph of the screen, a link-preview log, a CDN log) can use it, and **proof of possession by the claimant's key does not change that**, because the claimant chooses its own key. The only controls are lifetime, single use and first-wins, and the legitimate user who finds the handle already spent learns only that the code "can't be used". A handle MUST therefore never be the sole authority for anything the Farm cannot undo, and the options of section 7 exist for that reason.

### 8.2 Relay and same-device attacks on login

The login trigger sits on a screen other than the phone's; an attacker can start a login in their own browser and relay the portal's code to a victim, who scans it with Keyring (RFC 8628 section 5.4, "Remote Phishing"; RFC 10027 / BCP 247, *Best Current Practice for Security of Cross-Device Flows*, August 2026, and its relay and proximity guidance; both read in full text 2026-10-08).

- **The channel is not a control.** A stock camera hands the link to the app as a link, so refusing links would break the generic-camera requirement (2.5) and would do nothing against a relay. "Scanner only" is therefore not a control and is not used: all three channels are accepted for login (the vectors).
- **Mitigations, in the order they are cheap:** (1) **an inviter-signed screen** on the phone showing who requested the login: the community's name, the requesting browser and its coarse location and time, signed by the inviter's key over the wallet's request and checked against the contact's DID document before anything is shown; (2) **number matching** between the portal screen and the phone; (3) a short time to live (120 seconds); (4) a biometric on every approval; (5) **proximity**: RFC 10027 section 6.1.1 says proximity-enforced cross-device flows "are more resistant to CDCP attacks than proximity-less cross-device flows", while noting that the authorization server "cannot independently measure or enforce proximity on its own" (it relies on the surrounding systems); the same section list also names short-lived QR codes (6.1.2), one-time codes (6.1.3) and request binding with out-of-band data (6.1.17). The strongest precedent is CTAP 2.2 hybrid transport (section 11.5.1: the QR is `FIDO:/` followed by a digit-encoded CBOR payload, and "This transport requires a proof of proximity to help prevent attacks, thus notification of the connection attempt comes in the form of a BLE advertisement"). Keyring has no proximity transport; it is a later phase.
- **A held link outlives its 120 seconds.** A deep link arriving while the wallet is locked is held until unlock; the `expired` check at unlock handles that.

### 8.4 The sign-in proposal's QR (`keyring://oob`) mapped onto the trigger

The portal sign-in proposal (key grant, `auth/oob/*`) shows `keyring://oob?v=1&svc=<VTC DID>&id=<requestId>` and rejects any other scheme, any `v` but `1`, and any unknown or repeated parameter. It maps onto the trigger as follows, and section 8.2 of the specification reads the custom-scheme form.

| Proposal | Trigger | Notes |
|---|---|---|
| `svc` (percent-encoded VTC DID) | `_from` | the grammar of section 2 requires `did:webvh`; a VTC on another method does not fit and the proposal should say which it uses |
| `id` (`requestId`, 128 bits or more, base64url; also the nonce) | `_id` | 22 characters of the same alphabet; a handle that grants nothing alone (the approval needs the number and a biometric), so it is a handle, not a bearer |
| `v=1` | none | the version lives in the flow's Type URI, and `_type` carries it |
| none | `_exp` | the proposal's QR has no expiry although the request has one (`expiresAt`, 120 s); the container should carry it so the phone refuses a stale code before it asks |
| none | `_type` | the sign-in flow's Type URI (section 5), a hint only |
| `keyring://oob` | `https://<portal host>/<path>?_from=&_id=&_exp=&_type=` | the container form; one handle, no custom scheme |

**Recommendation to the proposal's authors: emit the container link, not `keyring://oob`.** A custom scheme does not open from a generic camera app and any app may register it (RFC 8252 section 8.1; 2.5 above). The portal's QR is scanned by the member's phone camera more often than by an in-app scanner, which is the case the `https` form serves. Keyring MAY read `keyring://oob` as a legacy reader form (section 8.2) **only if the portal ships it before the container exists**; once the container is available the legacy form is retired by the same sunset rule as the Farm's JSON.

**Unknown parameters: the proposal's side moves.** The proposal rejects unknown parameters, the specification ignores them (section 3: "Unknown parameters are ignored, so a tracker cannot break a link"), and a QR on a web page or in an email is exactly where a tracker or a redirector appends one. Rejecting turns an unrelated addition into a sign-in failure with no security gain, because every field that matters is read by name and validated by grammar; and the specification already rejects the case that does matter, a **repeated** reserved name. The proposal's repeated-parameter rule stays; its unknown-parameter rule goes. A security-relevant parameter added later must be tied to a flow version that a reader without it rejects (section 2).

**Other fits and gaps.**

- *Confirm before network (6 rule 1).* The proposal reads "scan, the VTC must be a known community, resolve the DID document, call `describe`". The specification asks for a tap before any network activity, the DID resolution included, with only the contact shown and labelled unverified. For a known community that is one tap; for an unknown community nothing is sent at all and the person is offered the join flow.
- *Fresh pairwise key (6 rule 4).* The proposal's `describe` is issued from an ephemeral `did:key`: it already meets this.
- *The handle as `parentThreadId` (6 rule 7).* The proposal carries `requestId` in the `describe` payload. Keyring sends it there and as `parentThreadId`; the portal may ignore the envelope member.
- *No GET (7 rule 3).* `describe` is a signed request from the phone and only sets a `viewed` flag; the code is not spent by a fetch.
- *Name collision.* `oob` here is the proposal's family name for an out-of-band flow and is not DIDComm's out-of-band message. Keyring's generic path reacts to `oob=` and `_oob=` query names (`helpers.ts:1170-1186`, and the deep-link filter in `TabStack.tsx`), and `keyring://oob?` contains neither, so the text is not mistaken for an invitation; but a reader or a person skimming logs would confuse the two, and a future `auth/oob` Type URI beside DIDComm `_oob` links invites a mis-route. The proposal's authors are asked whether another family name (for example `auth/handoff`) is acceptable.

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

## Annex F. Keyring implementation notes (was Appendix A)

For the Keyring side only. None of this binds the Farm or a portal. Paths are in the bifold submodule under `bifold/packages/core/src/` unless stated.

- **The legacy parser and its blocker.** `parseAgentHostQr` (`modules/trust-tasks/module/agentHostConnection.ts:152-172`) requires exactly the sorted keys `callback_url` and `vta_did` and returns undefined for any other key set. The minimal fix is to require the two keys and ignore the rest. The test case `'an extra member'` (`modules/trust-tasks/__tests__/agentHostConnection.test.ts`, about line 49) must flip from "not a QR" to accepted. No release is queued (changelog 0.2.0 "Unreleased"; latest tag `staging-v0.2.0-241`).
- **Credo on a v2 invitation, receiver side** (read from `node_modules/@credo-ts/didcomm`, `DidCommOutOfBandApi.receiveInvitation` and `DidCommConnectionsApi.acceptOutOfBandInvitation`, **not run**): it saves a receiver-role out-of-band record, then accepts the invitation with handshake protocol `None`, which creates a connection and, when no `ourDid` is given, a `did:peer:2` through `createPeerDidForV2OOB`. This is why container X would make a connection as a side effect (section 2.3).
- **`allowedHostOf` has defects**, `agentHostConnection.ts:121-126` (`/^https:\/\/([a-z0-9.-]+)(\/[^\s]*)?$/i`, then `host === site || host.endsWith('.'+site)` against `AGENT_HOST_SITES`): it accepts `https://.ic3.dev/x`, `https://a..ic3.dev/x`, a fragment after a path and control characters in the path. In every accepted case the host still ends in an allowed name. **Follow-up code fix, not part of this change:** parse the host into labels, reject empty labels, a trailing dot, `#` and control characters, and share one implementation with any later host check.
- **The deep-link log.** `navigators/TabStack.tsx:146` logs every deep link in full (section 8 rule 4); `UTIL_LOGGER` is a remote logger toggled in `app/src/screens/Developer.tsx`.
- **Does Keyring ingest a v2 `_oob` link today? Partly, and not by flow.** `modules/trust-tasks/module/vtiLinks.ts` has no `https` or `_oob` classification (a comment at about `:103` is the only mention). The generic path, `utils/helpers.ts:1127-1224` (`connectFromInvitation`, `oob.receiveInvitation`, `processBetaUrlIfRequired`), hands a v2 `_oob` link to Credo as an ordinary connection invitation. Container X therefore needs the Keyring router to intercept first.
- **Credo on an attachment-only invitation** (read from `node_modules/@credo-ts/didcomm`, `0.7.1-pr-2704-20260909134930`, **not run**): `DidCommOutOfBandApi` (about `:455-462`) calls `connectionsApi.acceptOutOfBandInvitation` with no handshake (a connection to `from`), then `emitWithConnection` (about `:636`) takes the first attachment whose `@type` is a supported message type, otherwise throws "There is no message in requests~attach supported by agent." A Trust Task document carries `type`, not `@type`, so the attachment fails dispatch with "Invalid message type". **Unverified at runtime.** `_oobid`: Credo has no `_oobid` name; its short-URL fallback GETs any URL without `_oob`/`oob`/`c_i` (no allow-list).
- **No SIOP or `id_token` minting exists in Keyring.** Reusable: `signCompactJws` (`modules/trust-tasks/module/vtiInvitationOffer.ts:175`, from `@bifold/trust-tasks`). `VtiMediatorTransport.login` (about `:533`) is authcrypt DIDComm, not SIOP. The key-grant portal sign-in signs no `id_token` at all (the VTA signs `auth/oob/respond` as the chosen DID), but the Farm login identity (7.2) is a separate phone-held Ed25519 `did:key` that does sign an `id_token`, so the plan's grep guard is **scoped to persona keys and the sign-in module**.
- **Persona keys do reach the phone.** `VtaClient.borrowKey` (`VtaClient.ts:1683-1691`) copies persona keys over `keys/export-secret/0.1`; callers: `VtaClient.ts:1627`, `:1630`, `:1717`, `vtaRotation.ts:78-79`, `vtaKeyMigration.ts:83-84`, `app/src/screens/Developer.tsx:629`.
- **Ed25519 hardware custody is not possible on the current stack:** Credo's `SecureEnvironmentKeyManagementService` is P-256/ES256 only, `expo-secure-environment` is secp256r1, and `react-native-attestation` is P-256. The Farm login key is software-held.
- **`acl/list`.** `VtaClient.listAcl` (`VtaClient.ts:1284`) calls `acl/list/0.1` (or `0.2`); both are on the phone's own send list (`approvalRules.ts:62-63`). It returns every entry the caller may audit; the sole-super-administrator check of 7.1 filters the result.
- **`keyring://vta/enrol`** lives in `bifold/packages/trust-tasks/src/enrolment/offer.ts`; its lab page is `scripts/openvtc/local-vti-stack/enrol-page`.
- **Native link configuration today.** iOS entitlements `app/ios/AriesBifold/AriesBifold.entitlements:5-11` declare `applinks:wallet.asml.berkmancenter.org` and `applinks:witness.asml.berkmancenter.org`, each also with `?mode=developer`. Android `app/android/app/src/main/AndroidManifest.xml:50-84` declares the Keyring schemes in one filter (no `autoVerify`) and two `autoVerify` `https` filters for the same two hosts. **No Farm, portal or `ic3.dev` domain is declared on either platform**, so no link of this document opens in Keyring from a camera without a wallet release (G8).
- **Upstream clones.** The VTI pin `822ff78a` is present in the clone and is an ancestor of `origin/main` (`49f5f1be`); the working tree is still at `187ad9cd`, 906 commits behind the pin, so anything read in the working tree is off-pin. `vta-service/src/operations/vault/proxy_login.rs` exists at the pin. `vtafarm-api` is not cloned: every statement about the Farm is from the Farm owner reply and is unverified here.
- **The reference reader** that checked the vectors is a throwaway script outside the repository. It does not test Keyring's parsers.

## Annex G. Open questions and references carried from the pre-slimming draft (was sections 13 and 14)

The live decision list is the plan's section 11 (`docs/plans/one-scan-and-vtc-sign-in-plan.md`). This part keeps the draft's own question numbers so the references elsewhere in this annex resolve.

- **T1 (container)** is settled as a working position in the plan (WP3): container Y, container X recorded in Annex A. **T7 (transport preference order, and whether a `tp` hint may break ties) is withdrawn:** the `tp` hint and the `goal` display string were cut from the core, and the wallet's preference order is its own business (core section 6 rule 5). T2, T3, T4, T5 and T6 are open in the plan.
- **Q1. Authority** for the Keyring-published tasks: provisional private identifiers now; registration under `trusttasks.org` is to be proposed (plan WP7, companion section F15). Unconfirmed.
- **Q3.** What does a TSP-based inviter show? (Annex C.) Plan F6.
- **Q5.** Should an invitation be signed, and where does a consumer find the key? Container X only (Annex A); not a v1 question.
- **Q8.** Should the `service` and `relativeRef` DID URL parameters name the claim endpoint? (Annex C.)
- **Q9.** What ends the legacy format? Core section 8 sets a sunset condition with no invented date; the period is for the Farm and Keyring owners.
- **Q10.** Who are the named owners, and where does this document live when it leaves draft? Open (core section 10).
- **Q13.** Do `auth/authenticate/0.3` and `auth/step-up/*` fit login without change? Fit not verified (Annex C).
- **Q16.** Is a fragment form worth defining for a non-DIDComm reader, given server logs? The core uses the query and now requires, of a producer's page, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, no third-party scripts and no query logging as a SHOULD (core section 7 rule 5 (c)).
- **Q17.** Unverified platform behaviour (camera and QR-app paths): Annex B tests C1 to C12.
- **Q18.** How do DID Core or upstream Trust Tasks rank several services in one DID document? Not verified; the core uses the consumer's own preference.
- **Farm owners' questions to Keyring** (F-a to F-h: the release that ignores unknown keys; strict SIOPv2 `id_token`s; the login DID method; hostname access; admin-side revocation; Ed25519 in an enclave; login registration failing after `connected`; the ownership signal inside the VTA session) are carried in the plan's section 11 ("Questions the Farm put to Keyring").
- **New, not verified (claim relay).** Reported by the independent review and not verified: an attacker can relay a Farm claim code from the attacker's own Farm session or account to a victim, so the victim's key administers a VTA provisioned under the attacker's account while the operator-level control stays with the attacker. Annex E has the login-relay analysis only. It is recorded as a risk and a Farm question (plan F12) with the mitigation in the plan (WP11).

**References (as the pre-slimming draft listed them).** DIDComm Messaging v2.1 (Out Of Band Messages, Goal Codes, Message Correlation, Service Endpoint); the Trust Tasks framework (`dtgwg-trust-tasks-tf`, pin `bdae1cf9`, `origin/main` `7b6bb488`) sections on Compatibility Rules, Migrating Between Versions, Type URI, Stability, Private and Unpublished Specifications, Audience Binding, Bearer Specifications, the `ceremony` member, Consumer Requirements, Governance Considerations; DTG VSC Predicate Registry `GOVERNANCE.md` (`dtgwg-vsc-registry` `54a13abe`, unpinned); RFC 8252 (BCP 212) sections 7.1, 7.2, 8.1, 8.4; RFC 8628 sections 3.3.1 and 5.4; RFC 10027 (BCP 247) section 6.1.1; FIDO CTAP 2.2 section 11.5.1; OpenID4VCI 1.0 (`tx_code`); W3C DID Core 1.0 section 3.2; RFC 9110 sections 7.1, 10.1.3, 17.11; RFC 3986; RFC 4648 section 3.5; ToIP TSP Experimental Implementor's Draft Rev 3 (out-of-band introduction); Apple "Supporting associated domains" and "Allowing apps and websites to link to your content", WWDC 2017 session 206; Android "Verify Android App Links", "About Android App Links", "Create deep links to app content", "Configure website associations", Google Digital Asset Links; Denso Wave QR Code version information; the Farm owner reply (external artifact, 2026-10-08, treated as data).
