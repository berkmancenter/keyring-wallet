# Proposal: a shared link host and a flow namespace for scan-to-start exchanges

**Status:** DRAFT, not sent. From Brendan Miller to the Trust Tasks and registry editors. Nothing here has been agreed by Trust Over IP, and every name below is a proposal. The working spec is [`keyring-qr-and-links.md`](./keyring-qr-and-links.md) (with its [annex](./keyring-qr-and-links.annex.md), section H, and test vectors).

## The problem

A person scans one QR code, or taps one link, from an ordinary camera app, and the wallet they already have set up opens. The party showing the code (a VTA provider, a community portal) does not know which wallet that is, and a page with one button per wallet is not one scan. The first two flows that need this are claiming a parked VTA and signing in to a community portal.

## What I am proposing

**1. A registry namespace for the flows, starting with two.** `https://registry.trustoverip.org/dtg/flow/<slug>/<MAJOR>.<MINOR>`, with `vta-claim/0.1` and the sign-in flow (`auth/oob/describe/0.1` today; its family name is its authors', and a rename such as `auth/handoff` is recommended but undecided). The group `dtg` and the vocabulary name `flow` are my guesses at your conventions, and I would rather you correct them. Until you register or decline them they are provisional private identifiers; nothing claims `trusttasks.org`.

**2. `link.trustoverip.org` as a shared link host.** It would serve two static association files (`/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`) and one small fallback page for people with no wallet. Each participating wallet is listed by a reviewed pull request that carries its iOS team and bundle identifiers and its Android package name and SHA-256 certificate fingerprints. This is the only way one link can open any of several wallets: the operating system picks the app from files the link's host publishes.

**3. The link format.** The trigger is in the URL fragment, so the host never receives it:

```
https://link.trustoverip.org/t#_from=did:webvh:QmExampleScid:example.org&_id=q3Vn7Zk2Xo9Rt1LwPb4HdA&_exp=1791461100
https://link.trustoverip.org/t#_from=did:webvh:QmExampleScid:example.org&_id=q3Vn7Zk2Xo9Rt1LwPb4HdA&_exp=1791461100&_type=https://registry.trustoverip.org/dtg/flow/vta-claim/0.1
```

`_from` names the inviter's DID, `_id` is an opaque handle that grants nothing by itself, `_exp` is an expiry, `_type` is an optional flow hint. The link carries no task, endpoint or key; the wallet resolves the DID and takes the endpoint from the DID document. The host is not part of the format: a wallet reads the same parameters on any host it has claimed.

## Why a dedicated host and not `registry.trustoverip.org`

As I read the registry's repository, it serves static identifier documents that others configure verifiers against. Association files decide which apps open every flow's links, so they need their own change control and blast radius (a bad edit or a key rotation touches every wallet and every inviter), and a fallback page is a service with its own availability and header requirements. I would keep them apart.

## Hosting requirements

- Both association files at `/.well-known/` on `link.trustoverip.org` itself, over HTTPS with a valid certificate and **no redirects** (Apple and Android both require this). `assetlinks.json` is served as `application/json`; I have not confirmed whether Apple requires a particular media type for the other file.
- A fallback page with no analytics and no third-party scripts, a minimal Content Security Policy, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and no script that reads `location.hash`. Because the fragment is never sent in a request, request logs cannot hold it, but a script on the page could read it, and a redirect that lacks a fragment lets the client re-apply the original one to the target (RFC 9110, sections 10.2.2 and 17.11). So the page does not redirect.
- The page names the wallets listed in the files and links to each one's store page; it never shows or stores the handle.

## What I am asking you to decide

1. Will Trust Over IP host `link.trustoverip.org`, or name another host? (The spec does not change if the host does.)
2. Who operates it, and in which account?
3. Who approves a wallet's listing, on what evidence, and how quickly?
4. What is the change control for the association files, and what happens on key rotation or when a wallet is removed?
5. Is a `flow` vocabulary under `/dtg/` the right home for these flow identifiers, with `MAJOR.MINOR` versions and hierarchical slugs? Or should they be registered somewhere else?
6. Is the fragment trigger format acceptable to the Trust Tasks task force as a profile, and is it right to read the invitation as the enclosing exchange whose `threadId` the handle is, for `parentThreadId`?

## What Trust Over IP is not asked to do

Hold any secret. The fragment is never sent to the host, so the host never sees a handle, a DID or a key. It would hold public wallet identifiers and a page.

## Alternatives considered

- **A shared custom scheme.** Any app can register a scheme (RFC 8252, section 8.1: it is "indeterminate as to which app will receive" the request), camera apps often do not open one, and OpenID4VCI's default scheme is the precedent and carries that weakness.
- **Per-wallet hosts.** Each inviter shows a link or button per wallet. That is the many-buttons page this is meant to avoid.
- **A DIDComm out-of-band link.** The receiving agent creates a connection before it can look at the goal, and the text is about twice the size.

## What is not verified

No device has been tested. Four questions are open: whether a camera app keeps the fragment when it opens a link in a browser and when it hands it to an app, on iOS and Android; what iOS and Android do when more than one installed wallet is listed for the host; whether the fragment reaches the app (iOS `NSUserActivity.webpageURL`, Android intent data); and what happens with no wallet installed. If the fragment does not survive on a platform, the format needs a different answer there. I have also not verified that the registry would take flow documents, `MAJOR.MINOR` versions or hierarchical slugs: its documents describe predicates with integer versions, and Trust Task specifications are registered at `trusttasks.org`.

## What Keyring will do meanwhile

Use its own already-declared host, `wallet.asml.berkmancenter.org`, as an interim link host that opens only Keyring, keep scanning in-app, and not put that host in any flow identifier. No dates are committed.

## Next steps

Keyring runs the four device tests (annex B, C13, C14 and the rest of C1 to C14) and keeps the interim host and the in-app scanner meanwhile. Nothing proceeds on the fragment container until those tests report, and if a camera or OS drops the fragment the format needs a different answer there. Of Trust Over IP I ask, in order, the six decisions listed above: the host, its operator, listing approval, change control, the home for the flow identifiers, and acceptance of the fragment profile. Nothing here is agreed until you confirm. Formal Trust Over IP linkage or registration of `trusttasks.org` is a separate question that I will raise separately. I have no dates to give.
