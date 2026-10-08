# Proposal: a shared link host and a flow namespace for one-scan links

**Status:** DRAFT, not sent. From Brendan Miller to the Trust Tasks and registry editors. Trust Over IP has agreed to nothing here; every name is a proposal. The link format is specified in [`keyring-qr-and-links.md`](./keyring-qr-and-links.md).

## The problem

A person scans one QR code from an ordinary camera app, and the wallet they already use opens. The party showing the code cannot know which wallet that is, and a page with one button per wallet is not one scan. On both iOS and Android the operating system picks the app from files the link's host publishes, so one link can open any of several wallets only if one host lists them all.

## What I propose

1. **A shared link host, `link.trustoverip.org`.** It serves two static association files, `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`, and one small fallback page for people with no wallet. A wallet is listed by a reviewed pull request giving its iOS team and bundle identifiers and its Android package name and certificate fingerprints. I suggest a dedicated host rather than `registry.trustoverip.org` because these files decide which apps open every link, so they need their own change control, and the fallback page is a running service.
2. **A flow namespace, `https://registry.trustoverip.org/dtg/flow/<slug>/<MAJOR>.<MINOR>`**, starting with `vta-claim/0.1` (claim a parked VTA) and `community-sign-in/0.1` (sign in to a community portal). A flow identifier names a flow, not the Trust Task a wallet sends first. `dtg` and `flow` are my guesses at your conventions; please correct them.
3. **The link format**, as a profile the Trust Tasks task force could adopt. The trigger is in the URL fragment, which browsers never send to a server, so the host never sees it:

```
https://link.trustoverip.org/t#_from=did:webvh:QmExampleScid:example.org&_id=q3Vn7Zk2Xo9Rt1LwPb4HdA&_exp=1791461100
https://link.trustoverip.org/t#_from=did:webvh:QmExampleScid:example.org&_id=q3Vn7Zk2Xo9Rt1LwPb4HdA&_exp=1791461100&_type=https://registry.trustoverip.org/dtg/flow/vta-claim/0.1
```

`_from` is the inviter's DID, `_id` an opaque handle that grants nothing, `_exp` an expiry, `_type` an optional flow hint. The link carries no task, endpoint or key: the wallet resolves the DID and takes the endpoint from the DID document. A wallet reads the same fragment on any host, so a different host changes nothing in the format.

## Hosting requirements

- Both files on the host itself over HTTPS with a valid certificate and no redirects; `assetlinks.json` served as `application/json`.
- A fallback page with no analytics or third-party scripts, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, no script that reads the fragment, and no redirects, because a redirect without its own fragment carries the original one to the target (RFC 9110 sections 10.2.2 and 17.11). It names the listed wallets and links to their store pages.
- The host holds no secret. It never receives a handle, a DID or a key.

## What I am asking you to decide

1. Will Trust Over IP run `link.trustoverip.org`, or name another host?
2. Who operates it, and in which account?
3. Who approves a wallet's listing, on what evidence?
4. What is the change control for the association files, including certificate rotation and removing a wallet?
5. Is a `flow` vocabulary under `/dtg/`, with `MAJOR.MINOR` versions, the right home for flow identifiers, or should they go elsewhere?
6. Should the Trust Tasks task force take the link format as a profile, and is it right to carry the handle as `parentThreadId`, reading the invitation as the exchange that contains the wallet's first request?

## Alternatives I considered

- **A shared custom scheme.** Any app can register a scheme (RFC 8252 section 8.1: "indeterminate as to which app will receive"), and I could not confirm that camera apps open one.
- **One link or button per wallet.** The page this is meant to avoid.
- **A DIDComm out-of-band invitation.** A receiving agent may create a connection before it reads the goal, the text is about twice as long, and the payload sits in the query, which the host receives.

## What I have not verified

No phone has been tested. I do not yet know whether camera apps keep the fragment when they open a link in a browser or hand it to an app, what each OS does when several installed wallets are listed for one host, whether the fragment reaches the app, or what a person with no wallet sees. If a platform drops the fragment, the format needs a different answer there. I have also not confirmed that the registry would take flow identifiers: its documents describe credential predicates with integer versions, and Trust Task specifications are registered at `trusttasks.org`.
