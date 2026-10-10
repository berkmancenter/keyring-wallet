# Proposal: a shared link host for one-scan links

**Status:** DRAFT, not sent. From Brendan Miller to Trust Over IP. Trust Over IP has agreed to nothing here. The link format is specified in [`keyring-qr-and-links.md`](./keyring-qr-and-links.md). VTI's flows and their identifiers are specified in the VTI specification draft (`trustoverip/dtgwg-vti-spec`, trigger-link chapter), so this proposal asks only for a host.

## The problem

A person scans one QR code from an ordinary camera app, and the wallet they already use opens. The party showing the code cannot know which wallet that is, and a page with one button per wallet is not one scan. On both iOS and Android, the operating system picks the app from files the link's host publishes. So one link can open any of several wallets from a camera only if one host lists them all.

A shared host is a convenience, not a requirement of the format. Anyone may host trigger links on their own domain. Such links work through any wallet's own scanner, by pasting, and by camera in wallets that declare that host.

## What I propose

**Trust Over IP runs a shared link host, `link.trustoverip.org`, which serves:**
- **The association files.** Two static files, `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`. They claim only the trigger path `/t`, never other paths.
- **A no-wallet page at `/t`.** One small page for people with no wallet. It never reads the fragment, sends it nowhere, and never redirects to a custom scheme.
- **Flow pages.** A page at each flow identifier the host carries, describing the flow. The VTI specification defines its flows under `https://link.trustoverip.org/vti/flow/` and governs them. This host would serve their pages and nothing else about them.

**How a wallet is listed.** By a reviewed pull request giving its iOS team and bundle identifiers, and its Android package name and certificate fingerprints.

**Why a dedicated host.** These files decide which apps open every link on the host, so they need their own change control. The no-wallet page is a running service.

A link looks like this. The trigger is in the URL fragment, which browsers never send to a server, so the host never sees it:

```
https://link.trustoverip.org/t#_from=did:webvh:QmPEQVM1JPTyrvEgBcDXwjK4TeyLGSX1PxjgyeAisPviUx:members.example.org&_id=Hk2pQ9xV4mT7rW1sZ8yN3A&_exp=1791460920&_type=/vti/flow/sign-in/0.1
```

`_from` is the inviter's identifier, `_id` an opaque handle that grants nothing, `_exp` an expiry, and `_type` an optional flow, here written as a path on the link's own host. The link carries no task, endpoint or key: the wallet resolves the identifier and takes the endpoint from its DID document.

## Hosting requirements

- **The association files** are served on the host itself over HTTPS, with a valid certificate and no redirects. `assetlinks.json` is served as `application/json`.
- **Every page** has no analytics or third-party scripts, sends `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, has no script that reads the fragment, and does no redirects. A redirect without its own fragment carries the original one to its target (RFC 9110 sections 10.2.2 and 17.11).
- **The no-wallet page** names the listed wallets and links to their store pages.
- **The host holds no secret.** It never receives a handle, an identifier or a key.

## What I am asking you to decide

1. Will Trust Over IP run `link.trustoverip.org`, or name another host?
2. Who operates it, and in which account?
3. Who approves a wallet's listing, and on what evidence?
4. What is the change control for the association files, including certificate rotation and removing a wallet?
5. Will the host serve the VTI specification's flow pages under `/vti/flow/`, and pages for other groups' flows on request?

## Alternatives I considered

- **A shared custom scheme.** Any app can register a scheme (RFC 8252 section 8.1: "indeterminate as to which app will receive"), and I could not confirm that camera apps open one.
- **One link or button per wallet.** This is the page the proposal is meant to avoid.
- **A DIDComm out-of-band invitation.** A receiving agent may create a connection before it reads the goal, the text is about twice as long, and the payload sits in the query, which the host receives.

## What I have not verified

No phone has been tested. I do not yet know:
- whether camera apps keep the fragment when they open a link in a browser or hand it to an app;
- what each OS does when several installed wallets are listed for one host;
- whether the fragment reaches the app;
- what a person with no wallet sees.

If a platform drops the fragment, the format needs a different answer there.
