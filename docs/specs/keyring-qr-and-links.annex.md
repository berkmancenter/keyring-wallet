# One-scan trigger links: annex (non-normative)

**Status:** DRAFT. Nothing here is a requirement; where it differs from the [spec](./keyring-qr-and-links.md), the spec wins. Rationale, link hosting, device tests, alternatives, upstream fit, one consumer's legacy format, and where each source was read. Plans, owners and history are in [`docs/plans/one-scan-and-vtc-sign-in-plan.md`](../plans/one-scan-and-vtc-sign-in-plan.md) and its dated companion.

## A. Opening a link from a camera app

The operating system, not the wallet, decides which app opens an `https` link, from files the link's host publishes and from what each installed app declares. A wallet opens a link only if both halves agree: the host lists the wallet, and the wallet's build declares the host.

| | iOS (Universal Links) | Android (App Links) |
|---|---|---|
| Host file | `https://<host>/.well-known/apple-app-site-association`, "with a valid certificate and with no redirects"; the wallet's `<Team ID>.<bundle id>` in `applinks.details` | `https://<host>/.well-known/assetlinks.json`, "served with content-type application/json" and "accessible without any redirects"; the wallet's package name and signing-certificate SHA-256 fingerprints. One file may list several apps. |
| Wallet build | entitlement `applinks:<host>`; each subdomain needs its own entry and its own file; "For services other than `appclips`, you can prefix a domain with `*.`" | an `autoVerify="true"` intent filter for `https` and the host; a wildcard host is verified against the file at the root hostname |
| When it changes | Apple's CDN "requests the … file for your domain within 24 hours"; `?mode=developer` (entitlement documentation) bypasses it during development | re-verification timing not re-checked; record it in C12 |
| Several wallets on one host | a choice prompt (WWDC 2017 session 206; current behaviour unverified) | if two apps resolve the exact same host and path, "only the app that was installed most recently can resolve web intents for that domain" |
| Wallet not installed | the link opens in the browser | from Android 12, an unapproved link "resolves to the user's default browser app instead" |

Sources are in G. Because the host must be in each wallet's build, a new inviter host reaches phones only with a wallet release. **One shared host listed in every participating wallet's build is therefore the only way one link can open whichever wallet a person has.** The proposed shared host is `link.trustoverip.org` (B). Until one exists, an inviter's link opens only wallets whose builds declare the inviter's own host.

**Custom schemes are not a substitute.** RFC 8252 section 8.1: "multiple apps can typically register the same scheme, which makes it indeterminate as to which app will receive the authorization code"; section 7.1 requires a private-use scheme to be "based on a domain name under their control, expressed in reverse order". OpenID4VCI's `openid-credential-offer://` (section 12.1.1) is a shared scheme with this weakness. Whether camera apps open a custom-scheme text at all is unverified (test C6). This is why the spec's alias scheme is for a wallet's own scanner only and why a spendable handle is never offered under one (spec section 6 rule 5 (f)).

**Fallback page.** A person with no wallet lands on the host's page at the link's path. It says in plain words what the code is for, links to each listed wallet's store page, offers an "open in the app" tap that uses the `https` link itself, and never redirects to a custom scheme. It loads for any fragment, never reads `location.hash`, and sends the fragment nowhere: the server never receives the fragment (RFC 9110 section 7.1), but a script on the page could read it, and a redirect without its own fragment would carry it on (section 10.2.2; section 17.11, "Disclosure of Fragment after Redirects").

## B. The shared host and the flow namespace (proposals)

**Neither exists and Trust Over IP has agreed to neither.** The draft request is [`keyring-qr-and-links.toip-proposal.md`](./keyring-qr-and-links.toip-proposal.md).

- **Why a dedicated host and not `registry.trustoverip.org`.** The registry serves identifier documents that others configure verifiers against. Association files decide which apps open every flow's links, so a bad edit or a certificate rotation affects every wallet and inviter at once; they need their own change control. A fallback page is a running service with its own availability and header rules. Keeping them apart limits the damage either can do to the other.
- **What the registry is, as read.** `dtgwg-vsc-registry` describes `https://registry.trustoverip.org/dtg/vsc/<name>/<n>` for credential predicates (integer versions, single-segment names) and `/dtg/context/v<k>`; `GOVERNANCE.md` 2.5 says a new vocabulary under `/dtg/` "gets its own sibling of `vsc/` and its own definition format"; changes need two editor approvals, a DCO sign-off and the CLA. Trust Task specifications are not registered there: they live in `dtgwg-trust-tasks-tf` as `https://trusttasks.org/spec/<slug>/<MAJOR.MINOR>`. So `dtg/flow` as a sibling vocabulary, and `MAJOR.MINOR` versions in it, are our proposal and unverified as acceptable.
- **The prefix is not ours.** The framework says a private Type URI "SHOULD sit in a namespace the publisher controls". The proposed prefix is Trust Over IP's, so this SHOULD is knowingly not met until Trust Over IP registers or declines. Nothing deploys on it before then, it is one string, and a consumer accepts only the identifiers on its own list.
- **Interim host.** Until a shared host exists, an inviter uses a host it controls, and the link opens only the wallets that declare that host. A wallet's own host is never part of a flow identifier.

## C. Device tests (none run)

The vectors cannot show what a phone does with a link. These runs use real devices, a real code from a real host, and record device, OS version, camera or scanner app, wallet build, date, tester and result. **None has been run; every expected result below is a hypothesis.**

| # | Setup | Expected |
|---|---|---|
| C1 | iOS Camera, wallet installed and declaring the host, files published | the wallet opens on the flow's screen with the link, fragment included |
| C2 | Android stock camera, then Google Lens; wallet verified for the host | the wallet opens directly; otherwise the fallback page gets the person into the wallet in one tap |
| C3 | a third-party scanner on each OS (one with an in-app browser) | the link reaches the wallet or the fallback page; an in-app view that keeps the link is a recorded limitation |
| C4 | no wallet installed, each path of C1 to C3 | the fallback page loads, shows no handle, and the server log has no fragment; after install, C1 or C2 passes |
| C5 | two or more listed wallets installed | iOS: record the prompt; Android: record which opens and how a person changes it |
| C6 | a code whose text is a custom-scheme link only | record what each camera does (control) |
| C7 | a build that does not declare the host, files list it | the wallet does not open |
| C8 | a host file served through a redirect | the wallet does not open |
| C9 | Android 12 or later, host not yet verified | the browser opens; the fallback page does not spend the handle |
| C10 | wallet locked or cold start | the link is held until unlock and then read; a code held past its expiry is `expired` |
| C11 | the real link length, rendered at the inviter page's size, scanned from a monitor on a low-end phone | reads within a few seconds; record time and QR version |
| C12 | a host file changed after install | record how long the change takes to reach the phone |
| C13 | each path of C1 to C3, a link with a known fragment, into the browser and into the app | record whether the fragment survives each hand-off |
| C14 | wallet installed and associated | iOS: the fragment is in `NSUserActivity.webpageURL`; Android: in the intent's data URI |

**If C13 or C14 fails on a platform, the handle cannot travel in the fragment there** and the link form needs a different answer on that platform (for example a short-lived server-side lookup, which is a different trust model and not designed).

## D. Why the core rules are as they are

- **A trigger, not a task.** A task body, an endpoint or a credential in the text would make the text the authority, and the text is shown on screens, photographed, previewed and logged. A trigger grants nothing, so a leaked one costs only a request the inviter judges by its own policy.
- **The fragment.** No server, CDN or link-preview fetch receives it (RFC 9110 sections 7.1, 10.1.3), so nobody has to promise not to log the handle. The costs are the fallback-page rules of A and the unverified camera hand-off (C13, C14).
- **The query is never read.** A second place for the handle would put it back in front of the host. A reserved name only in the query is `query-form`, so a producer's mistake shows up in tests.
- **Unknown names are ignored, repeated reserved names rejected.** Trackers and redirectors append parameters; rejecting them breaks links with no security gain, since every field is read by name and checked by grammar. A repeated reserved name is the one case where two readers could disagree about what the link says. Names start with `_` so they cannot collide with a site's own.
- **Standard decoding.** `URLSearchParams` and `urlencode` percent-encode colons and slashes. A reader that refused `%` would refuse what standard libraries emit.
- **No fetch, nothing spent on a GET.** Link previews, mail scanners, chat unfurlers, in-app browsers and an unverified-link browser fallback all fetch a link before the phone does. A handle spent on a GET strands the real person.
- **Confirm before network.** Without it, any web page could make a phone fetch a DID log from a host the page chose (revealing the phone's address and reaching local hosts) and send a signed request. The first screen shows only what the text says, labelled unverified.
- **Transport from the verified document, chosen by the wallet.** The screen that shows a code is usually not the service that answers. The DID document says how to reach the service. DIDComm's `accept` is "An array of media types in the order of preference for sending a message to the endpoint", a property of one service, and the order of endpoints within one `DIDCommMessaging` service is the owner's preference within that service; neither ranks one service against another, and no ranking rule among services was found upstream. So the wallet's preference decides. A defined `no-common-transport` outcome stops a wallet falling back to something it was not told to use.
- **A handle alone is a bearer.** When the requester chooses its own key, proof of possession by that key does not stop someone who has the handle. Lifetime and single use are the controls.
- **Host rules.** WHATWG parsing turns `https://0x7f.1/` into `127.0.0.1` (its "ends in a number" check), so IP forms are refused after parsing. Names reserved for local networks (RFC 6761, 6762, 8375) are refused for the same reason: a trigger must not aim the phone at its own network.
- **Sign-in from a code on another screen can be relayed.** An attacker starts a sign-in on their own device and relays the code to a victim (RFC 8628 section 5.4, "Remote Phishing"). Refusing camera-opened links would not stop that and would break the one-scan goal. The controls are an inviter-signed description of the requester shown before approval, number matching, short expiry and a biometric at approval. RFC 10027 (BCP 247) section 6.1.1 says "proximity-enforced cross-device flows are more resistant to CDCP attacks than proximity-less cross-device flows", and the strongest precedent is CTAP 2.2 section 11.5.1 ("This transport requires a proof of proximity to help prevent attacks, thus notification of the connection attempt comes in the form of a BLE advertisement"). No proximity check is defined here.

| Actor | What it can do | Control |
|---|---|---|
| bystander or screenshot | use a spendable handle first | lifetime, single use; a flow design that puts no authority in the handle |
| link preview, mail scanner, in-app browser | spend a handle by fetching the link | nothing is spent on a GET; no fetch by reference |
| another app registering a custom scheme | receive the link first | no custom-scheme link for a spendable handle |
| relaying attacker | have a victim approve the attacker's session | signed requester details, number matching, expiry, biometric; later proximity |
| lookalike inviter | get a request signed to a lookalike | contact list per flow; endpoint only from the verified document |
| device logs | leak a handle | redaction before logging |

## E. Alternatives not taken

- **A DIDComm v2.1 out-of-band invitation with no attachment** (`https://<host>/<path>?_oob=<base64url JSON>`, with `from`, `id` and `expires_time`, and the flow in `body.goal_code`). Not used: a receiving agent may create a connection before it reads the goal (Credo does for a v2 invitation, read from code); the text is about twice as long; DIDComm requires goal codes defined elsewhere to "use Reverse Domain Name Notation with the associated effort's domain as a prefix", which a URI is not; and `_oob` is in the query, which the host receives. DIDComm also says "no private information may be passed in the message". Its by-reference form (`_oobid`, "the agent must do an HTTP GET") is a fetch the spec rules out.
- **A shared custom scheme.** See A.
- **One button per wallet on the inviter's page.** Not one scan.
- **The handle in the query with a no-log promise from the host.** The fragment removes the need for the promise.
- **A Trust Task document in the URL, on a new link binding.** A trigger carries no document, so there is nothing for a binding to carry, and a new binding needs the Trust Tasks group's acceptance for no gain over a hint.
- **The QR holder as the endpoint** (two phones, or a device with no server). Out of scope: the code would have to carry routing data and need a proximity check, as CTAP 2.2 hybrid does. Not defined here.

## F. One consumer's legacy format: Keyring and the VTA Farm's claim QR

This is not part of the core. Keyring reads one older text, the VTA Farm's claim QR, as one of its other handlers (spec section 3, `pass-on`). The vectors' `legacyVectors` test this reader under `config.legacy`. The text is a JSON object `{"vta_did": "did:webvh:…", "callback_url": "https://…"}`; `vta_did` is the contact and `callback_url` is both the endpoint and the secret, so the format is bearer. The Farm keeps its QR unchanged until a Keyring release reads it with unknown members ignored; this reader describes that release.

After the core's step 1 (trim, length), stop at the first failure:

1. Not a JSON object, or no `callback_url` member: `not-ours`.
2. Not scanned (opened as a link or pasted): `wrong-channel` (message: "Scan the code on the website's screen.").
3. A duplicate member name anywhere, compared "after processing any escaped characters" (RFC 7493 section 2.3): `bad-value`.
4. No `vta_did`: `missing-param`.
5. `vta_did` is not a string `did:webvh:…` of at most 256 characters, or `callback_url` is not a string: `bad-value`.
6. `callback_url` is not `https://`, or has userinfo, a port, a fragment or a control character: `bad-value`.
7. Its host fails the host rules or is not equal to or under `ic3.dev` or `firstperson.dev`, or it is longer than 512 characters: `callback-not-allowed`.
8. Accept, reporting every other member as `legacy.<key>` in document order, with `callbackUrl`.

## G. Upstream fit, and where sources were read

**Upstream Trust Tasks that bear on this** (`dtgwg-trust-tasks-tf`; all `status: draft`). Read at the fetched `origin/main` `7b6bb488` unless noted; most are not in the pinned commit `bdae1cf9`, whose framework is version 0.5.

| Upstream | Bearing |
|---|---|
| `bindings/push/0.1` | the closest stance: the push payload is "an untrusted hint", and a consumer "MUST NOT take any framework action on the strength of a push alone" |
| `vtc/admin/events/event/0.1` | "A hint is a trigger to re-read"; no specification defines "trigger" as a term |
| `vtc/invitations/deliver/0.1` | an offer "small enough for a QR code", redeemable only with a proof by the invited DID's key; a pattern, since the invited DID is known in advance |
| `vtc/install/claim/start/0.3` | a single-use token and "its separately delivered claim code"; a pattern for a second factor; wrong codes: SHOULD invalidate, 5 recommended |
| `auth/step-up/approver/invite/0.1`, `redeem/start/0.1`; `auth/passkey/enroll/invite/0.2` | single-use invite URL with a code "never carried in `url`"; "the fifth wrong code voids the invite" |
| `trust-task-discovery/0.3` | "A discoverer SHOULD ask in 0.3"; it "MUST NOT act on a discovery response whose origin it can authenticate neither in-band (via `proof`) nor from the transport" |
| ceremonies (`vtc/member-onboarding`, `vetting/identity-vetting`, `mutual-attestation`) | the `ceremony` member is normative and "A consumer MUST NOT grant any authority on the basis of ceremony membership alone"; no ceremony defines a QR or trigger format |
| claim of a parked agent, community sign-in | no upstream task (searched at `7b6bb488`); `specs/auth/` holds `_shared`, `authenticate`, `challenge`, `passkey`, `refresh`, `revoke-session`, `sessions`, `step-up`, `whoami` |

`TSPTransport` appears in upstream example DID documents and source, but no binding names a DID-document service type for TSP (`bindings/tsp/0.1`), and TSP itself defines no invitation format, so the spec maps no service type to TSP.

**Where each citation was read** (all on 2026-10-08):

- Trust Tasks framework (`SPEC.md`, Working Draft 0.7.0), the bindings and the tasks above: `external/dtgwg-trust-tasks-tf`, `origin/main` `7b6bb488`. At the pin `bdae1cf9` (version 0.5) the whole-string Type URI sentence and the DID and URN private forms are absent; the compatibility, migration, audience-binding, consumer and `parentThreadId` (section 4.9.2) text is present in both.
- `dtgwg-vsc-registry`: `external/`, HEAD `eb29484e` and `origin/main` `54a13abe`. HEAD's README says the registry IRIs "do not resolve" until deployment; `origin/main`'s README says the registry "is served at `registry.trustoverip.org`".
- Fetched primary texts: RFC 3986, 6761, 6762, 7493, 8174, 8252, 8375, 8628, 9110, 10027 (BCP 247, August 2026); WHATWG URL Standard (sections 3.5 and 5.1); DIDComm Messaging v2.1; OpenID for Verifiable Credential Issuance 1.0; FIDO CTAP 2.2 (Proposed Standard, July 2025); W3C DID Core 1.0; Apple "Supporting associated domains" and the associated-domains entitlement page; Android "Add App Links", "Configure website associations" (`configure-assetlinks`) and "Create deep links". The WWDC 2017 session was not re-read; camera and scanner behaviour is not documented anywhere we found (section C).
