# A permanent home for the demo state's did:webs

**Status:** **Draft** for the owner's review. Nothing is built, deployed or registered. No DNS record, account or
repository is created by this plan until the owner says so for that step (§8).

**Scope:** the demo state's published key histories (its did:webs) move off the temporary Cloudflare quick tunnel and
onto a host we run, for both SEDI demos. One demo is guardianship: a guardian's Guardian card, checked on the person's
phone against the state's live record ("Who approves"). The other is the holder's state card. This plan covers:

- where the host lives and what it serves;
- how its files are made and kept in step with the host;
- what the SEDI lane's planned real issuance and live revocation need from it;
- what changes in the app, what it costs, and what needs the owner's word.

It does not change the resolver, the Guardian check or any trust decision.

**Siblings:**

- [`delegated-batch-issuance-plan.md`](./delegated-batch-issuance-plan.md) Phase 2 and
  [`keri-holder-plan.md`](./keri-holder-plan.md) own the did:webs verifier this host feeds.
- [`push-notifications-plan.md`](./push-notifications-plan.md) and `deploy/keyring-ota` own the server whose Caddy this
  host would share.
- The local-only ngrok tunnelling plan (`ngrok-tunneling-plan.md`, not on `main`) is the developer-tunnel layer, which
  this plan is not (§2.3).

**Companions (review index):**

- [`2026-11-12-al.md`](./demo-state-hosting-plan/2026-11-12-al.md): the evidence behind the host choice (the tunnel's
  rate limits, GitHub Pages' fixed cache, the wallet host today), and the questions still open with the SEDI lane.

## 1. What the host serves

A did:webs identifier `did:webs:<host>:<path…>:<AID>` is published at `https://<host>/<path…>/<AID>/did.json` and
`…/keri.cesr` (`bifold/packages/core/src/modules/sedi/webs/identifier.ts`, which follows the did:webs specification's
method-specific identifier section and affinidi-did-webs `identifier.rs`).

The demo publishes the whole credential chain under one path on one host. The phone builds an issuer's did:webs from the
root's, with the issuer's AID in place of the root's (`intermediateDid` in `trust-tasks/guardianEvidence.ts`). So the
path is fixed: **`keyring-demo-state`**. Every AID in a demo chain sits beside the root:

```
https://<HOST>/keyring-demo-state/<AID>/keri.cesr   the AID's key event log, byte for byte
https://<HOST>/keyring-demo-state/<AID>/did.json    its DID document, derived from that log and naming <HOST>
```

For today's test state (K0, the keripy kit `sedi/__tests__/fixtures/k0-utah-v2`) that is three AIDs, six files:

| Who | AID | keri.cesr is |
|---|---|---|
| the state root | `IMTne_Mkgzgf4iVRanVTxV3RdtL1ggDUKdKOv2OuSBd6` | `kel-roy.cesr` |
| the org unit | `IBv2DqvYol_GdZH3R6M6X-UiSjqcBm6pooXoikn2alOZ` | `kel-deb.cesr` |
| the issuing agent | `IDTFZ-B3B25INJli8AtIDcYRyZpwcfE7sNYaS4ISbZjx` | `kel-sue.cesr` |

### 1.1 What the phone requires of the host (the contract)

These rules come from the phone's resolver (`sedi/webs/resolve.ts` and its `README.md`, bifold `main` at `72db4ffe7`).
A host that breaks any of them gets "Couldn't reach the state" on the phone, by design, never the card's copy.

- **HTTPS only**, from the identifier's own origin. **No redirect:** a 3xx, or an answer served from another URL, is
  refused (`redirectRefused`).
- **2xx only, within 10 s**, with `did.json` ≤ 64 KiB and `keri.cesr` ≤ 512 KiB (`WEBS_LIMITS`), which is about a
  thousand events.
- **No witnesses.** A KEL that declares any (`bt` > 0 or a witness list) is refused (`witnessesUnsupported`): "this
  package does not read witness receipts yet."
- **No delegation, no weighted thresholds.** "`versionId` queries, delegated KELs (`dip`/`drt`), weighted thresholds,
  services, key agreement, designated key roles. A document carrying any of these is refused, never partly accepted."
- **`did.json` matches the log exactly:**
  - one `JsonWebKey` method per current key, P-256 as `kty` `EC`, `crv` `P-256`, uncompressed x/y, `kid` the key's
    qb64;
  - its subject is this DID or its did:web twin;
  - `alsoKnownAs` lists did:keri only for this AID.

  So `did.json` names the host, and **is regenerated for every host** (§3).
- **The pair is consistent at every moment.** The phone fetches `keri.cesr` and then `did.json`. If a rotation is
  half-published, the two don't match and the phone refuses (`didDocMismatch`). Publishing is therefore an atomic swap
  (§3.2).

Our own additions, for the live-revocation demo (§4):

- **`Cache-Control: no-store`** on both files, so that no layer between the host and the phone serves an old log after
  a revocation is published. The phone fetches on every open of Who approves or the state card, and reuses its own last
  success only when a fetch fails, for under five minutes, labelled with the time (`sedi/webs/lastLive.ts`).
- **`Content-Type`**: `application/json` for `did.json` and `application/cesr` for `keri.cesr`. The resolver doesn't
  check it, but other did:webs resolvers may.
- **No access log**, as the existing Caddy sites have none (`deploy/keyring-ota/Caddyfile`): "No `log` directive, so no
  access log." Every request is a phone opening a screen, so a log would be a per-phone record.

## 2. Where it lives

### 2.1 Recommended: its own hostname, on the Caddy that already serves the wallet host

A third site block in `deploy/keyring-ota/Caddyfile`, beside the update server and the wallet host. It is a static
`file_server` over its own directory (`/srv/demo-state`) with the headers in §1.1. The hostname is a proposal, and the
owner picks it: **`demo-state.asml.berkmancenter.org`**. The demo DIDs then read
`did:webs:demo-state.asml.berkmancenter.org:keyring-demo-state:<AID>`.

Why this one:

- **It adds no server.** The Caddy host already obtains and renews certificates for our `asml.berkmancenter.org` names.
  It already serves a static site (the wallet host's `/srv/wallet-site`) the same way.
- **A separate hostname keeps the demo state apart from the wallet host.** The wallet host is the universal-link host
  the app's entitlements and Android manifest claim (`applinks:wallet.asml.berkmancenter.org`). A did:webs identifier
  carries its host, so a state published there would tie demo identifiers to the app-link host for good. Retiring the
  demo, or moving it, would then mean touching the site the app links through.
- **We set the cache headers.** Live revocation needs them (§1.1 and §2.3).

It needs **one DNS record** for the new hostname, before Caddy's first start with it, as every site on that host does
(`deploy/keyring-messaging/README.md`, "Prerequisites": "A DNS A record … created before the first start, since Caddy
asks for a certificate on boot").

### 2.2 Fallback, with no DNS: a path on the wallet host

`https://wallet.asml.berkmancenter.org/keyring-demo-state/<AID>/…`, served from the existing `/srv/wallet-site` root,
with the same headers set for that path. Today that path answers 404 (companion F3), and the app claims only `/invite`
and `/i/`, so it doesn't collide with app links. It costs the separation in §2.1, so it is the fallback if the DNS
record is slow, not the default.

### 2.3 Ruled out

- **GitHub Pages** (a repository under the organization). Pages sets `cache-control: max-age=600` on every answer, and
  a site can't change it (companion F2). A published revocation could then take ten minutes to reach a phone. That
  defeats the live-revocation demo, and the delay is invisible on the screen. It also needs a new organization
  repository, which is the organization owner's step.
- **A reserved ngrok domain, or a named Cloudflare tunnel.** Either one is still a laptop. The tunnelling plan rules
  hosting out in its own words (§6): "It is not a way to host anything. These origins exist so a phone, an emulator or
  a second implementation can reach a process on a developer's laptop during a test … They are alive while somebody is
  watching them and dead afterwards."
- **The quick tunnel as the demo's host.** It stays for ad hoc tests, through the Developer "Demo state host" field
  (the SEDI lane's runbook). But its hostname changes every run, so all six `did.json` files must be regenerated each
  time. Its free endpoint also refused new tunnels with Cloudflare's rate limit on the day before a demo (companion F1).

## 3. Making the files, and keeping them in step with the host

### 3.1 One generator

`sedi/__tests__/fixtures/webs-k0-root.gen.mjs` already writes the six K0 files for any host:

```sh
node src/modules/sedi/__tests__/fixtures/webs-k0-root.gen.mjs <HOST> <outDir>
```

It copies each `keri.cesr` byte for byte. It derives `did.json` from the log's last establishment event, with a JWK
conversion independent of the resolver's (`@noble/curves`), so the committed fixtures are a second derivation. Two
changes, and nothing else:

- **A log source other than the K0 kit**, `--kels <dir>` holding `kel-<name>.cesr` files, for the kept-key state of §4.
  It uses the same derivation and the same refusals. It handles P-256 only, which is already the rule (DBI plan §5.1:
  "ECDSA P-256 and SHA-256 only").
- **A manifest of what it wrote**: each AID with the sha-256 of both files. The publish step and the live check (§3.3)
  compare against it.

### 3.2 Publishing is a directory swap

The generator writes a complete new tree, `keyring-demo-state.<stamp>/`, beside the live one. A symlink
`keyring-demo-state` is then repointed at it in one `rename`. The previous tree stays until the next publish, as the
undo. A phone never sees a new `keri.cesr` with an old `did.json` (§1.1). Only public bytes leave the machine that ran
the generator: the logs and the documents, never a key (§4).

### 3.3 A live check, run after every publish

A Jest test in `bifold/packages/core`, skipped unless `DEMO_STATE_HOST` is set. It resolves every AID in the manifest at
`did:webs:$DEMO_STATE_HOST:keyring-demo-state:<AID>`. It uses the app's own resolver (`resolveWebs`) over the network,
and fails on any refusal. It also checks the headers: 200, no redirect, `no-store`. The app's own code is the judge, so
a host that passes is one the phones accept. Run it after each publish. The nightly gate can run it as one cheap row,
so a host that has drifted shows up before a demo, not during one.

## 4. Real issuance and live revocation

**Conditional on the SEDI lane's design, which comes after the Sunday 2026-11-15 demo and isn't settled.** This section
states only what that work needs from the host. The questions it leaves open are in the companion.

- **A new demo state with kept keys (K1).** K0's keys were thrown away when the kit was made, so nothing new can be
  issued or revoked under it. K1 is a root, an org unit and an issuing agent whose keys are kept. Each one must meet
  §1.1:
  - P-256;
  - no witnesses;
  - no delegation;
  - single-signature thresholds.

  K1 is still ours, not a state's, so the phone's list marks it `demo` and Who approves shows the Demo pill.
- **The keys never reach the host, the repository or a tunnel.** Where they live is the owner's decision (§8). The
  machine that holds them runs the issuance tool and the generator, and hands only the published tree to §3.2.
- **Issuing a card:**
  1. The issuing agent anchors the credential in its log.
  2. Its `keri.cesr` grows by one event, and is republished.
  3. Its `did.json` changes only if a key rotates.
- **Revoking a card live:**
  1. The issuer anchors the revocation and republishes.
  2. On the next open of Who approves, the phone fetches the issuer's published log.
  3. The phone shows "The issuer's published record shows it was revoked" (`revokedInIssuerRecord`). It does so even if
     the card's own copy stops before the revocation (keyring-bifold#1045).

  How quickly it shows:
  - With `no-store` (§1.1), at the next open.
  - If the host was unreachable at that open: up to five minutes, while the phone reuses its own earlier success. The
    screen labels that result "Fetched live from \<host\> at \<time\>".
- **Growth.** One event per issuance or revocation, about 0.4 KiB each (`WEBS_LIMITS`' note). The 512 KiB cap is about
  a thousand events per AID, which is ample for demos. A state that outgrows it is refused, not cut.

## 5. What changes in the app

None of this touches the resolver or the Guardian check.

- **A1. The one-tap demo setup fills the host.** "Set up the SEDI demo" writes the permanent host into "Demo state
  host" **when the field is empty**, and leaves a typed value (a tunnel test's) alone. The field keeps its meaning:
  - it says where demo roots are fetched from;
  - clearing it means "check against the copy on this phone";
  - a real root ignores it (`sedi/webs/demoStateHost.ts`).

  **Rejected:** making the demo root's own did:webs the permanent host, and fetching it when the field is empty. That
  changes what an empty field means. The "Demo: checked against a copy on this phone" line would no longer be true of
  an empty field, and a phone with the switches on would start fetching without anyone choosing to.
- **A2. The K1 root on the phone's list**, after §4. It goes beside K0 in `sedi/guardian/stateRoots.ts`, with
  `demo: true` and its did:webs on the permanent host. It is trusted on the same terms as K0: in a Developer build, or
  with "Trust the test state" on. K0 stays for the fixtures, the tests and tunnel runs.
- **Delivery.** Both are JavaScript-only. `scripts/release/tier.mjs` grades the change (`ota` or `ota-strict`), and the
  OTA ships only on the owner's word, as always.

## 6. What it costs

| Item | Cost |
|---|---|
| Server | None new: the existing Caddy host. |
| Disk and traffic | About 2 KiB per AID. K0's root is 1,213 B of log plus 821 B of document. Each open of the screen fetches two files per AID. |
| DNS | One record (§2.1), or none (§2.2). |
| Caddy site block, headers, deploy directory | About ½ day, including a check on a local Caddy before the real host. |
| Generator `--kels`, manifest, swap publish | About ½ day. |
| Live check (§3.3) with its control | About ½ day. |
| A1 (one-tap fills the host), rows and a mutant | About ½ day plus review. |
| K1 and the issuance tool (§4) | The SEDI lane's estimate: about 3 to 3½ days, plus 1 to 1½ days for live revocation. |

The estimates are this lane's. They aren't measured.

## 7. Steps

Each step starts on the owner's word where §8 says so.

1. **S1. The site, locally.**
   - Work: the site block, and the headers in §1.1, on a local Caddy serving the K0 tree for a placeholder host.
   - Done when, for each of the six paths, `curl -sI`:
     - shows 200 with no `Location`;
     - shows `cache-control: no-store`;
     - shows both content types.

     A request for a missing AID also answers 404, not a redirect.
2. **S2. Generator and publish.**
   - Work: `--kels`, the manifest and the swap.
   - Done when:
     - the committed fixtures are unchanged (`git diff --exit-code` on `webs-k0-root/`);
     - `--kels` over the K0 kit's own files writes the same bytes as the default run;
     - a publish followed by an undo (repointing the symlink back) leaves the earlier tree serving.
3. **S3. Live check.**
   - Work: the test in §3.3.
   - Done when:
     - it passes against S1's local site, through a quick tunnel;
     - it fails, as the control, against the same site with one `did.json` from another host.
4. **S4. On the real host** (the owner's word, the DNS record first).
   - Work: deploy the site block and publish K0's six files.
   - Done when the live check passes against the real hostname from outside our network.
5. **S5. A1 in the app.**
   - Done when rows prove each of these, and a mutant that always overwrites is killed:
     - an empty field is filled;
     - a typed host is kept;
     - with the switches off nothing is fetched.
   - On two phones, Who approves reads "Fetched live from \<host\>" with no host typed.
6. **S6. K1 and live revocation** (§4, the SEDI lane, after the Sunday demo).
   - Done when, on two phones:
     - a card issued under K1 checks live;
     - after the issuer revokes it, the next open reads "The issuer's published record shows it was revoked";
     - the live check passes on the republished tree.

The quick-tunnel runbook stays as it is for ad hoc tests. Nothing in it is removed.

## 8. What needs the owner's word

- **The hostname** (§2.1), or the fallback path on the wallet host (§2.2).
- **The DNS record**, and who creates it.
- **Deploying the site block to the real host**, and who may publish to it.
- **Where K1's keys live.** Who holds them, on what machine, and how they are backed up. They are never committed,
  never on the host and never sent over a tunnel.
- **A1**: the one-tap setup filling the host.
- **Shipping A1 and A2** (an OTA, graded by `tier.mjs`).
- **Each live revocation run** in a demo, since it publishes.

**Blocked on:**

- the owner, for everything above;
- the SEDI lane, for the K1 design (§4), after the Sunday demo.

Nothing is blocked on an outside party, except the DNS record if the owner's DNS is managed elsewhere.

## 9. Not covered

- **A real state's own did:webs.** A real root publishes where the state chooses, and its units and agents would need
  their own did:webs for their histories to be fetched. Today a real root's issuers still come from the card
  (`sedi/webs/README.md`, "A REAL root's issuers are NOT fetched").
- **Designated-alias attestations and witness receipts.** These are the resolver's own gaps, and a separate change.
  The screen already says "the designated-alias check isn't supported yet".
- **The VTI maintainer's TypeScript did:webs resolver.** It replaces ours behind `setRootKelResolver` and fetches the
  same two files, so this host serves it unchanged.
