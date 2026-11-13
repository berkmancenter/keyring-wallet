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
- The infra repository's `demo-state` environment (Mickens-Lab/keyring-push-gateway-infra#23, the infra lane's) owns
  the bucket and the publish script (§2, §3.2).
- The SEDI lane's K1 issuance plan owns the issuer that writes K1's tree and its cards (§4).
- The local-only ngrok tunnelling plan (`ngrok-tunneling-plan.md`, not on `main`) is the developer-tunnel layer, which
  this plan is not (§2.3).

**Companions (review index):**

- [`2026-11-12-al.md`](./demo-state-hosting-plan/2026-11-12-al.md): the evidence behind the host choice (the tunnel's
  rate limits, GitHub Pages' fixed cache, the wallet host today), and the SEDI lane's answers that set §4 and §5.
  Later the same day: the move to the bucket (F8), the card files (F9), and the dry-run that caught the publish
  script's DID check (F10).

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

K1 (§4) adds its own three AIDs under the same path. It also adds the Guardian cards it issues. They sit beside the
state path, not inside it, since `keyring-demo-state/` is DID space:

```
https://<HOST>/cards/<pickupId>.json          the card, fetched by the guardian's phone (A4)
https://<HOST>/cards/<pickupId>.status.json   {"status":"issued"|"revoked","revokedAt"?}
https://<HOST>/cards/<pickupId>.html          the same card as a static page, for a browser
```

On the bucket's own URL, every path above starts with `/<bucket>` (§2).

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
  half-published, the two don't match and the phone refuses (`didDocMismatch`). The publish order keeps a revocation
  safe, and rotations are published outside demos (§3.2).

Our own additions, for the live-revocation demo (§4). They apply to every file, the cards' included:

- **`Cache-Control: no-store`**, so that no layer between the host and the phone serves an old log after a revocation
  is published. A public bucket object without it is served `public, max-age=3600`. The phone fetches on every open of
  Who approves or the state card. It reuses its own last success only when a fetch fails, for under five minutes,
  labelled with the time (`sedi/webs/lastLive.ts`).
- **`Content-Type`**:
  - `application/json` for `did.json`, a card's `.json` and its `.status.json`;
  - `application/cesr` for `keri.cesr`, which the phone asks for in its `Accept` header;
  - `text/html` for a card's page.
- **No access log.** Every request is a phone opening a screen, so a log would be a per-phone record.

### 1.2 The card files

Set by the SEDI lane (the issuer) and the infra lane (the publish script), 2026-11-12 (companion F9):

- **`pickupId`** is 22 base64url characters, from 16 random bytes. It is unrelated to the card's SAID. It isn't a
  bearer secret: a phone keeps a card only if it is issued to that phone's own AID, so another phone that fetches it
  keeps nothing. But the card shows pseudonymous AIDs, so the id is private by URL: the bucket can't be listed, and logs
  show only its first six characters.
- **`<pickupId>.json`** is the card as the phone holds it: `{"type":"keyring.sedi.guardian-card/0.1", "guardianSaid",
"holder", "kels", "tels", "creds", "issuedAt", "expiresAt"}`. That is the guardian-evidence payload, with a type tag
  and its dates. **At most 64 KiB**: the phone's own cap (`GUARDIAN_EVIDENCE_MAX_BYTES`) refuses anything larger, so
  the publish refuses it first.
- **`<pickupId>.status.json`** is `{"status":"issued"}` or `{"status":"revoked","revokedAt":…}`.
- **`<pickupId>.html`** is a static page, at most 256 KiB, with no script. It carries `<meta name="robots"
content="noindex">`. Its QR code is an inline SVG. Once the card is revoked, the page is re-rendered without the QR.
- **Nothing else** is in `cards/`. Nothing is ever deleted by the publish step.

### 1.3 The root's designated aliases

K1's root also publishes `keyring-demo-state/<root AID>/designated-aliases.json`: the hosts it may be fetched from,
as `{"said", "proof", "tel": {"ripText", "updateTexts"}}`.

- `proof` is an ACDC issued by the root, followed by its disclosure. Its attributes list the did:webs DIDs of the root,
  the org unit and the issuing agent at the designated host.
- `tel` is that ACDC's own registry, anchored in the root's log.
- Designating a new host revokes the old ACDC and issues a new one. Only the live one is published.

This is how a host named by what is issued can be trusted (§5 A2). The SEDI lane's verifier checks it. The host only
serves it, at most 64 KiB, with the same headers.

## 2. Where it lives

**For now, the demo is served locally.** The owner: "website should be done locally first and then moved into using
the infra later". So a local server on the operator's machine serves the tree through a temporary tunnel. It serves
only the paths in §1, with the headers in §1.1, and it never lists a directory (companion F11). The bucket below
follows later, off the demo's critical path.


A Cloud Storage bucket of its own, defined in the infra repository's `demo-state` environment (the infra lane's draft
Mickens-Lab/keyring-push-gateway-infra#23). Nothing else is served from it.

- **Public read is one object by name.** `storage.objects.get` only, so nobody can list the bucket. A card is private
  by its URL (§1.2).
- **No access log.** The bucket has no usage log, and the project has no Data Access audit log.
- **Earlier versions of each object are kept**, as the undo after a bad publish.
- **No `website` setting.** So there is no index page, and no redirect for a "directory".

One variable sets how the bucket is served, and the owner picks (§8):

| Form | Files at | DIDs | Needs |
|---|---|---|---|
| The bucket's own URL | `https://storage.googleapis.com/<bucket>/…` | `did:webs:storage.googleapis.com:<bucket>:keyring-demo-state:<AID>` | Nothing more. About $0. |
| A hostname we own | `https://<host>/…` | `did:webs:<host>:keyring-demo-state:<AID>` | One A record, a load balancer and a Google-managed certificate. About $18 a month. |

The infra lane recommends our own hostname; the coordinator recommends the bucket's URL. What each means for the demos:

- **The bucket's own URL serves K1 only.** The Developer "Demo state host" field takes a bare hostname, so it can't
  point K0 at a path below a bucket. K1's host is fixed in its list entry anyway (A2), with the full path. The screen
  then reads "Fetched live from storage.googleapis.com", which names Google's address, not ours.
- **Our own hostname serves both.** K1 is fixed to it (A2), and K0 can be pointed at it with the field. Its load
  balancer also sends `X-Robots-Tag: noindex` on every answer. The project's
  organization policy may refuse the load balancer's global resources. In that case, the bucket's URL is the fallback
  (the infra README, "Before any apply").

### 2.1 Ruled out

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
- **A site on the Caddy that serves the wallet host** (this plan's first draft). It is superseded by the bucket:
  our hosting lives in the infra repository, and the Caddy would have needed a deploy change and a publish path onto
  the server (companion F8).

## 3. Making the files, and keeping them in step with the host

### 3.1 Who writes the tree

The publish step takes one local tree that mirrors the host exactly: `keyring-demo-state/` and `cards/` (§1).

- **K0's six files** come from `sedi/__tests__/fixtures/webs-k0-root.gen.mjs`. It copies each `keri.cesr` byte for byte.
  It derives `did.json` from the log's last establishment event, with a JWK conversion independent of the resolver's
  (`@noble/curves`), so the committed fixtures are a second derivation. It writes the hostname form only:
  ```sh
  node src/modules/sedi/__tests__/fixtures/webs-k0-root.gen.mjs <HOST> <outDir>
  ```
- **K1's files and its cards** come from the SEDI lane's issuer. It writes `<keystore>/publish/` after each issue and
  each revoke, for a given `--host` and `--path-prefix`. The keys sit in `<keystore>/keys/`, a sibling, which the publish
  step never reads (§4).

Both write `did.json` in the same form: `id` is the did:web twin, with the did:webs DID first in `alsoKnownAs`, then
did:keri.

### 3.2 Publishing

The infra repository's `scripts/demo-state-publish.sh` uploads the tree with the publisher's own login. Before anything
leaves the machine, it checks the whole tree against §1.1 and §1.2 and refuses the publish on any failure:

- only `keyring-demo-state/` and `cards/` in it, and never the keystore or a `keys/` directory;
- each AID directory holds `did.json` and `keri.cesr`, and optionally `designated-aliases.json`, within the size caps;
- nothing is a symlink, and nothing looks like key material (a PEM key, or a private JWK);
- each `did.json` names this host and path, so a tree made for a tunnel is refused, not published;
- each card id and card file follows §1.2.

It then uploads:

- only files whose bytes differ from the live object;
- in an order that keeps a phone mid-publish safe: `keri.cesr`, then `designated-aliases.json`, then the card's
  `.json`, then `.status.json`, then `.html`, then `did.json`;
- each with `Cache-Control: no-store` and its content type;
- never deleting. Removing files after a demo is a separate step, on the owner's word.

A bucket has no atomic swap.

- **A revocation is safe.** It appends one anchoring event to the issuing agent's `keri.cesr` and leaves its `did.json`
  unchanged, since `did.json` comes from the last establishment event. The pair never disagrees. A phone that fetches
  between two uploads sees the anchor first, and that alone shows the revocation.
- **A key rotation is not.** It changes both files. A phone opening the screen between the two uploads gets "Couldn't
  reach the state" (`didDocMismatch`) for that moment, and its five-minute reuse (`lastLive.ts`) covers most of it.
  Rotations are published outside demos.

The script logs only the first six characters of a card id.

### 3.3 A live check, run after every publish

`sedi/__tests__/websLiveHost.test.ts` in `bifold/packages/core` is skipped unless `DEMO_STATE_HOST` is set:

```sh
DEMO_STATE_HOST=<host> [DEMO_STATE_PATH=<bucket>/keyring-demo-state] \
  [DEMO_STATE_AIDS=<AID,…>] [DEMO_STATE_CARDS=<pickupId,…>] [DEMO_STATE_ALIASES=<root AID>] yarn jest websLiveHost
```

- **Every AID resolves through the app's own resolver** (`resolveWebs`) over the network, and any refusal fails with
  the resolver's own reason. The app's code is the judge, so a host that passes is one the phones accept. The AIDs are
  K0's three by default.
- **Every file carries the headers:** 200, no redirect, `no-store` and its content type.
- **Every card named passes §1.2's shape:**
  - its `.json` is within the phone's cap and tagged with its type;
  - its status is `issued` or `revoked`;
  - its page is marked `noindex` and has no script.
- **The root's designated aliases**, when named, carry the same headers and the file's shape (§1.3).

The publish script prints the exact command after each publish. The nightly gate can run it as one cheap row, so a host
that has drifted shows up before a demo, not during one.

## 4. Real issuance and live revocation

**The SEDI lane builds this, in its K1 issuance plan.** Its shape is settled (companion, "SEDI lane answers", and F9).
This section states what it needs from the host and from the app.

- **A second demo state with kept keys (K1), beside K0.** K0's keys were thrown away when the kit was made, so nothing
  new can be issued or revoked under it. K1 is made the same way and has the same shape:
  - The kit's own tooling, copied: keripy at the same pin (`7143832`, 2.1.0-dev1), `e2e/k0k3/k0/run_k0.sh` and a
    `gen_k1.py` copied from `gen_k0.py`.
  - The same chain: the state root, then (Unit) the org unit, then (Agent) the issuing agent, then (Guardian) the
    guardian, who (Social) names the ward. The chain is built from ACDC edges, not from delegated AIDs.
  - The same profile, exactly as the K0 kit's `PROVENANCE.json` declares it, including its declared deviations:
    - P-256 keys (`1AAJ`);
    - SHA2-256 prefixes and next-key digests;
    - Blake3 event, ACDC and TEL SAIDs;
    - no witnesses (`toad` 0);
    - one key, `kt` 1.

    The verifier is tested against exactly that shape, so K1 does not "fix" any of it. It meets §1.1 as it stands.

  - Its issuer writes the publish tree itself, for the chosen host and path (§3.1).

  K1 is still ours, not a state's, so the phone's list marks it `demo` and Who approves shows the Demo pill. Its name is
  the owner's choice (§8). K0 is never replaced: it stays the fixed fixture the verifier is tested against, and the
  offline copy.

- **The keys stay on the operator's machine.** That machine runs the issuance tool and the generator, and hands only
  the public tree to §3.2, from a directory beside the keys, never the keys' own. Issuing and revoking never run on
  the host, and never go over a tunnel. Which machine it is, and how its keys are backed up, is the owner's decision
  (§8).
- **Getting the card to the guardian's phone is a new step.** The existing carriage (guardian-evidence/0.1,
  keyring-bifold#1027) runs from the approver to the person, not from the issuer to the guardian, and K0's card is
  bundled in the build (`holdGuardianEvidence`). For the demos, a Developer step "Get the Guardian card from \<host\>"
  fetches the published card (`cards/<pickupId>.json`, §1.2) from K1's host. It accepts only that base URL, the host
  and path fixed in K1's entry followed by `/cards/`. It keeps the card through `holdGuardianEvidence`, so the existing
  check applies unchanged.

  **Rejected:**
  - Bundling a K1 card in an OTA, as K0's is. It isn't issuance.
  - A real IPEX grant to the phone. It needs a KERI agent on the phone (keri-holder plan, stage 3), which comes after
    these demos.
- **The ward is still a Developer setting.** The card's issuee is a ward AID keripy made, which isn't on the phone. The
  person's setup sets K1's ward as it sets K0's today, not bound to the person (keri-holder plan KH-P3).
- **Revoking a card live, from the issuer's log.** In the K0 kit, a card's revocation is a TEL `brv` in that card's
  own registry (one registry per card, a declared deviation), anchored by an event in the issuing agent's log. A live
  revocation is therefore one TEL event plus one anchoring event:
  1. Among the logs, only the issuing agent's `keri.cesr` is republished. The card's three files are republished
     with it: its `.json` with the revocation in its TEL, its status, and its page without the QR (§1.2).
  2. On the next open of Who approves, the phone fetches that log.
  3. It shows "The issuer's published record shows it was revoked" (`revokedInIssuerRecord`), from the anchor alone,
     even when the card's own copy stops before the revocation (keyring-bifold#1045).

  **This plan promises that line, and only that line.** The republished card carries the `brv`. But "The card shows it
  was revoked" would need the phone to fetch the card again, which is a separate choice and not part of this plan.

  How quickly the revocation shows:
  - With `no-store` (§1.1), at the next open.
  - If the host was unreachable at that open: up to five minutes, while the phone reuses its own earlier success. The
    screen labels that result "Fetched live from \<host\> at \<time\>".
- **Growth.** One event per issuance or revocation, about 0.4 KiB each (`WEBS_LIMITS`' note). The 512 KiB cap is about
  a thousand events per AID, which is ample for demos. A state that outgrows it is refused, not cut.

## 5. What changes in the app

None of this touches the resolver or the Guardian check.

- **A1. The Developer "Demo state host" applies to K0 only.** Today it replaces the host of every root the list marks
  `demo` (`sedi/webs/demoStateHost.ts`). It moves to an explicit mark on the entry, set on K0 alone. K0 keeps the field
  exactly as today: a typed host (a tunnel test, or the permanent host typed by hand) is fetched, and an empty field
  means "check against the copy on this phone".
- **A2. The K1 root on the phone's list.** It goes beside K0 in `sedi/guardian/stateRoots.ts`, with:
  - its own AID and name;
  - `demo: true`;
  - its did:webs on the permanent host, with the full path, **fixed in the entry**. On the bucket's own URL that is
    `did:webs:storage.googleapis.com:<bucket>:keyring-demo-state:<AID>`.

  It is always fetched from that did:webs, and the free-text field never redirects it. It is trusted on the same terms
  as K0: in a Developer build, or with "Trust the test state" on.

  The build names the host in one constant, `K1_WEBS_HOST` (the SEDI lane's code), which has three values:
  - **`null`, the default.** K1 fetches nothing, and a K1 card is refused on receipt: "This build doesn't name the
    state's host". A build that names no host is safe.
  - **A hostname.** The fixed host. The field is ignored for K1.
  - **`'developerField'`.** A deliberate one-line opt-in, only on the owner's explicit word. The field then reaches K1,
    and the line reads "Fetched from \<host\>, typed on this phone", never as the state's record.

  **The opt-in is declined.** The owner, relayed by the coordinator: "no we should not type it on developer settings,
  it should issued if needed somehow … I thought this was as simple as scanning". So `K1_WEBS_HOST` stays `null`, and
  no build carries `'developerField'`. K1's host comes with what is issued instead: the did:webs DID inside the card,
  or in its QR code. To make that safe, the phone checks the designated-alias attestation. That is the AID's own
  KEL-anchored statement that the did:webs host is its own. Without that check, a card could name any host, and a host
  serving a log cut short could hide a revocation (F7). This direction is proposed, not designed yet.

  Rows and aimed mutants pin that a typed host never reaches K1 under `null`. A temporary tunnel's hostname changes
  every run, so on a tunnel K1 needs a stable tunnel hostname (an account step, the owner's word) or the opt-in.
- **A3. The setups choose a kit.** The guardian's and the person's one-tap setups take a choice of K0 or K1. K0 stays
  the default until K1 has checked live on both phones.
- **A4. "Get the Guardian card from \<host\>"**, the Developer step in §4.
- **Delivery.** All of these are JavaScript-only. `scripts/release/tier.mjs` grades the change (`ota` or `ota-strict`),
  and the OTA ships only on the owner's word, as always.

**Why K1's host is fixed (security).** The field is free text: anyone at the phone can type any public hostname into
it. Applying it to K1 would let a typed host stand in for the state's own, and the screen would still name that host
as the state's record. The trust anchor wouldn't move (the AID on the list, whose log must replay), but the host's
answer is exactly what live revocation rests on. A host that serves a log cut short before a revocation would hide
that revocation. So the state's host comes only from the phone's own list, and the field stays a test tool for the
kit nothing is issued under.

**Rejected:**
- **The one-tap setup fills "Demo state host" when the field is empty.** It collides with "an empty field means the
  copy": a tester who clears the field on purpose gets it filled again on the next tap. Making it work would need a
  third, saved "cleared on purpose" state. A2's fixed host makes it unnecessary.
- **Fetching a demo root's own did:webs whenever the field is empty.** This changes what an empty field means for K0.
  "Demo: checked against a copy on this phone" would no longer be true, and a phone with the switches on would start
  fetching without anyone choosing to.

## 6. What it costs

| Item | Cost |
|---|---|
| Hosting | About $0 on the bucket's own URL. About $18 a month on our own hostname, for the load balancer's forwarding rule (the infra README, "Cost"). |
| Disk and traffic | About 2 KiB per AID. K0's root is 1,213 B of log plus 821 B of document. Each open of the screen fetches two files per AID. A card is at most 64 KiB. |
| DNS | One A record on our own hostname, none on the bucket's URL. |
| Bucket, publish script and its cards rules | The infra lane's (#23). |
| Live check (§3.3), with its controls | Written (below, S3). |
| A1 (the field applies to K0 only), rows and a mutant | About ½ day plus review. |
| K1, the issuer, A2–A4 (§4, §5) | The SEDI lane's estimate: about 3 to 3½ days, plus 1 to 1½ days for live revocation. |

The estimates are this lane's. They aren't measured.

## 7. Steps

Each step starts on the owner's word where §8 says so.

1. **S1. The bucket** (the owner applies #23).
   - Done when the infra README's "After apply" checks pass: a missing object answers 404, not a redirect; a listing is
     refused; nothing is logged per request.
2. **S2. The publish script, with the cards** (the infra lane, #23).
   - Done when its own test covers each refusal in §3.2, and a dry run over a tree made by each writer in §3.1 passes:
     K0's generator, and K1's issuer.
3. **S3. Live check** (`websLiveHost.test.ts`).
   - Done. On 2026-11-12, on a local HTTPS server with the six K0 files and a placeholder card:
     - with the headers set, every row passed;
     - on a plain static server, all nine header rows failed and the three resolver rows passed;
     - with one `did.json` made for another host, that AID failed with `didDocMismatch`;
     - with a card over 64 KiB, a status of `pending` and a page with a script, each failed on its own row;
     - with an id that isn't a pickup id, the card rows failed.
   - A throwaway K1 tree with four cards passed, 21 of 21. A designated-aliases file passed as issued, failed on the two
     fields broken in a copy, and failed on 404 where absent.
   - The real K1 tree (the owner's init) passed 10 of 10 on a copy with the host label set to the local host.
   - Through K1's quick tunnel, the header and aliases rows passed and `cards/` answered 404. The resolver rows failed
     with `didDocMismatch`, as they must while the tree is still made for a placeholder host.
4. **S4. On the real host** (the owner's word; on our own hostname, the DNS record first).
   - Work: publish K1's tree.
   - Done when the live check passes against the real host from outside our network, for K1's AIDs and one card.
5. **S5. A1 in the app.**
   - Done when rows prove each of these, and a mutant that applies the field to every demo root is killed:
     - with a host typed, K0 is fetched from it;
     - with a host typed, a root without the mark is fetched from its own did:webs, never from the typed host;
     - with the field empty, K0 is checked against the copy;
     - with the switches off, nothing is fetched.
6. **S6. K1 and live revocation** (§4, A2–A4: the SEDI lane).
   - Done when, on two phones, with the kit set to K1 and no host typed:
     - "Get the Guardian card" holds K1's card;
     - Who approves reads "Fetched live from \<host\>";
     - after the issuer revokes the card, the next open reads "The issuer's published record shows it was revoked";
     - the live check passes on the republished tree.

The quick-tunnel runbook stays as it is for ad hoc tests. Nothing in it is removed.

## 8. What needs the owner's word

- **How the bucket is served** (§2): its own URL, or a hostname we own, and which hostname.
- **The DNS record** for that hostname, and who creates it.
- **Applying #23**, and who may publish (its `publishers`). The owner's own Editor role covers the whole apply.
- **Where K1's keys live.** Who holds them, on what machine, and how they are backed up. They are never committed,
  never on the host and never sent over a tunnel.
- **K1's name** on the phone's list.
- **A1–A4** (§5), and shipping them (an OTA, graded by `tier.mjs`).
- **Switching the setups' default to K1**, once it has checked live on both phones.
- **Each live revocation run** in a demo, since it publishes.
- **Removing anything published**, after a demo or otherwise. The publish step never deletes.

**Blocked on:**

- the owner, for everything above;
- the SEDI lane, for K1's issuer and A2–A4 (§4, §5);
- the infra lane, for the cards in the publish script (#23).

Nothing is blocked on an outside party, except the DNS record if the owner's DNS is managed elsewhere.

## 9. Not covered

- **A real state's own did:webs.** A real root publishes where the state chooses, and its units and agents would need
  their own did:webs for their histories to be fetched. Today a real root's issuers still come from the card
  (`sedi/webs/README.md`, "A REAL root's issuers are NOT fetched").
- **Designated-alias attestations and witness receipts.** These are the resolver's own gaps, and a separate change.
  The screen already says "the designated-alias check isn't supported yet".
- **The VTI maintainer's TypeScript did:webs resolver.** It replaces ours behind `setRootKelResolver` and fetches the
  same two files, so this host serves it unchanged.
