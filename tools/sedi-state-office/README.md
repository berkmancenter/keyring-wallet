# SEDI demo State office (K1)

A local issuer for the Keyring SEDI demo. It holds a demo state (root `roy-k1`, org unit `deb-k1`, issuing agent
`sue-k1`) whose keys are KEPT on this Mac. It issues a Guardian card to a guardian's phone-made AID naming a ward's
phone-made AID, revokes live, and writes the files a public server hands to phones: did:webs for the state's three
AIDs, and a pickup page plus card file per card.

Test issuer only, not a government service. Its cards are labelled Demo in the app.

## Setup (once)

```sh
mkdir -p ~/.cache/keyring-sedi-office && cd ~/.cache/keyring-sedi-office
git clone https://github.com/WebOfTrust/keripy.git && git -C keripy checkout 7143832813cac6a394ab1faf9be83bb3372be87c
/opt/homebrew/bin/python3.14 -m venv venv
git -C <wallet repo> show origin/test/k0k3-keri-kit:e2e/k0k3/k0/requirements-k0.txt > requirements-k0.txt
./venv/bin/pip install -r requirements-k0.txt segno && ./venv/bin/pip install --no-deps -e ./keripy
```

This is the K0 kit's keripy pin, with its requirements (libsodium from Homebrew). `segno` draws the QR codes.

## Use

`PY=~/.cache/keyring-sedi-office/venv/bin/python`, run from this folder.

### The passcode

The keystore passcode (at least 21 characters) comes from the macOS Keychain. Alberto adds the item himself, once; the
command prompts for the passcode and never shows it:

```sh
security add-generic-password -s keyring-sedi-k1 -a "$USER" -w
```

The tool never creates that item and never chooses the passcode. It reads it with
`security find-generic-password -s keyring-sedi-k1 -a "$USER" -w`, never echoes or logs it, and uses it by default
whenever the item exists. Without the item it falls back to `KEYRING_SEDI_K1_PASSCODE`, then to a prompt.
`--passcode-from-keychain` requires the item; `--no-keychain` skips it (for throwaway stores).

```sh
$PY -I office.py init                         # once: prints root / unit / agent AIDs
$PY -I office.py --host <public host> publish # rewrite the public tree for that host (remembered from then on)
$PY -I office.py serve                        # the officer API + page on http://127.0.0.1:8790 (prints the token)
$PY -I office.py issue --holder <AID> --ward <AID> [--valid-days 365] [--role "legal guardian"] [--label text]
$PY -I office.py revoke <card SAID>
$PY -I office.py show
```

The public server is 62's `serve-demo-state.mjs`, run on the publish tree on port 8798. It is the only thing a tunnel
may point at. The officer API on 8790 is never tunnelled; `serve` refuses port 8798.

## Where things live

The keystore defaults to `~/.keyring-sedi-k1/` (mode 700); `--keystore` moves it. The tool refuses a keystore inside
any git checkout. It holds:

- `keys/`: the encrypted keripy stores and the registry blinding salts;
- `office.json`: the card index, local labels and the remembered host;
- `officer.token` (mode 600);
- `publish/`: the tree to serve, as is (PROD's, with two hosts);
- `publish-test/`: TEST's tree, only with `--test-host` (below).

`publish/` (and `publish-test/`) sit beside `keys/`, never inside it, and hold no secret:

- `keyring-demo-state/<AID>/{did.json,keri.cesr}`, for K1's three AIDs and K0's three. K0's come from bifold's kit,
  read with `git show` from the bifold clone's `origin/main`, so one host serves both demos.
- `cards/<pickupId>.{json,html,status.json}`: the card bundle the phone fetches, the pickup page, and its status.

Labels never leave the keystore, and no file in `publish/` names a person.

### Host flags

- `--host`: a bare hostname, optionally with a port. Only a real port's `:` is `%3A`-encoded in a DID.
- `--path-prefix`: the site root's path under the host, for a bucket URL later. The office warns (and goes on) when
  PROD has one: today's app checks a designation only at a bare hostname.
- `--test-host`: TEST's bare hostname (the tunnel's), beside PROD's `--host`. Remembered like `--host`; `--test-host ''`
  drops it. Without it the office publishes for one host exactly as before (the same bytes).

Every did.json is rewritten for its tree's host. A card names the host it was issued under for life (below).

### Two hosts: PROD and TEST

With `--test-host`, `--host` is PROD (our hostname, uploaded by `serve --publish-cmd`) and `--test-host` is TEST (the
tunnel, served from this computer). As designed in the infra repo's demo-state README ("PROD and TEST"):

- **One designation for both.** The root's one designated-aliases ACDC lists its three DIDs at PROD, then at TEST.
  Changing either host revokes it and issues one listing the hosts in use: a host that goes is dropped, never kept.
- **One tree per host.** `publish/` is PROD's, `publish-test/` is TEST's. Each tree's `did.json` files name its own
  host (K1's three AIDs and K0's three); the `keri.cesr` files and the designation are the same bytes in both.
- **A card names one host for life**, PROD unless the officer picks TEST. Its bundle, page, QR and links name that
  host, and it is written, byte-identical, into BOTH trees, so it is the same object whichever host serves it. The
  phone keeps the host of the link it fetched (bifold `receiveGuardianCard.ts`, `stateHost`); a card's QR always
  links to its own host, and a PROD card fetched through TEST by hand still checks, since TEST is designated too.
- **Cards from before two hosts** carry no host of their own. The first time the saved host changes, each is
  stamped with the host it was issued under (the one saved until then), so it keeps that host for life instead of
  following the new PROD. This also holds with one host: after `publish --host NEW`, earlier cards keep their old
  host (still published, and marked as no longer designated).
- **Issue and revoke write both trees, then upload.** The upload command runs in `publish/` only; TEST needs none.
- **A card whose host is no longer designated** (a dead tunnel name, a changed PROD host) stays published and current
  in both trees, never deleted and never re-issued by itself. `serve` and `publish` name it; the officer page marks it
  "host not designated; re-issue to move".

## Designated aliases

`publish --host H` makes the root designate H (and the TEST host, with two; above). It issues a designated-aliases ACDC (Keyring's own variant of did:webs
designated aliases; no conformance claim), whose `a.ids` lists the did:webs DIDs of the root, org unit and issuing agent
at H. It sits in its own registry, anchored in roy's KEL. Designating a new host revokes the previous ACDC first.

The live one is published as `keyring-demo-state/<root AID>/designated-aliases.json`:
`{said, proof, tel: {ripText, updateTexts}}`. `proof` is the ACDC with its blinded-state disclosure. The phone reads
roy's KEL from `keri.cesr` beside it.

## The officer API (127.0.0.1 only)

Every request carries `Authorization: Bearer <token>`. A Host or Origin other than `127.0.0.1:<port>` or
`localhost:<port>` is refused, and there is no CORS.

| Call                                | Takes                                                                          | Returns                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/cards`                   | `{holder, ward, label?, validDays?=365, role?="legal guardian", host?="prod"}` | 201, the card view; 400 `badHolder`, `badWard`, `badValidity`, `badRole`, `badLabel` or `badHost` (`host` is `prod`, or `test` with a TEST host) |
| `GET /api/cards`                    |                                                                                | every card view                                                                                                                                  |
| `POST /api/cards/{SAID}/revoke`     |                                                                                | 200, the card view; idempotent (the same `revokedAt`); 404 for an unknown card                                                                   |
| `GET /api/health`                   |                                                                                | `{root, aids, host, pathPrefix, hosts: {prod, test}, warnings, keystore}`; `test` is null with one host                                          |
| `GET /api/files?tree=prod\|test`    |                                                                                | `{host, siteUrl, truncated, files: [{path, size, modified, publicUrl, viewable, reason?}]}`                                                      |
| `GET /api/files/view?tree=T&path=P` |                                                                                | that file's bytes as `text/plain`; 404 `notFound` for anything else                                                                              |

`tree` is `prod` (the default, `publish/`) or `test` (`publish-test/`, with a TEST host); anything else is a 404.
The two files calls are read only and for testing: the officer page's "Published files" view, for showing people
what the public server hands to phones. They serve the publish tree and nothing else. `keys/`, `office.json`,
`office.lock`, `officer.token` and the passcode sit beside `publish/`, and a path is refused unless:

- it is plain segments (letters, digits, `.`, `_`, `-`, no segment starting with `.`), so no `..` and no dotfile;
- it ends in `.json`, `.cesr` or `.html`;
- no part of it is a symlink, and it resolves inside `publish/`;
- it is a regular file with one link (no hard link to anything else), at most 2 MB.

Every refusal is the same 404, so it never says whether something exists outside the tree. The list, though, shows
every file-like entry of `publish/` (a folder isn't a row, what's in it is; names and `lstat` only, nothing followed), since the public server hands them all out: one
the viewer won't open is listed with `viewable: false` and a `reason` (`notPlainPath`, `symlinked`, `notRegularFile`,
`hardLinked`, `notViewableType`, `tooLarge`) instead of going missing.

A card view holds:

- `id`, `pickupId`, `label`, `holder`, `ward`, `role`, `issuedAt`, `expiresAt`, `status` (`issued` or `revoked`),
  and `revokedAt` once revoked;
- the links: `pickupUrl`, `pickupJsonUrl`, `statusJsonUrl`, `offerUrl`;
- `qrSvg`, empty once revoked;
- its host: `host`, `hostKind` (`prod`, `test`, or `orphan` when no longer designated) and `hostDesignated`;
- after a change, `published`. It is true only when `serve --publish-cmd` ran an upload command and that succeeded.

## Codes

- **Holder (the guardian):** a transferable AID, 44 characters, starting with `E` or `I`, so the guardian can later
  issue the Social Authorization.
- **Ward:** `B…` (44 characters, Ed25519), `1AAI…` (48 characters, P-256), or a transferable AID.

## Profile

The same as the K0 kit (`bifold …/fixtures/k0-utah-v2/PROVENANCE.json`):

- keripy 7143832 (2.1.0-dev1), KERI/ACDC 2.0, JSON;
- P-256 keys, SHA2-256 prefixes and next-key digests, Blake3 SAIDs;
- no witnesses, kt=1, I2I edges;
- one registry per credential, each event anchored in its issuer's KEL.

Differences from K0:

- the keys are kept;
- nonces and registry salts are random;
- dates are real;
- the rule text reads "Demo only".

## Tests

`$PY -I test_office.py`. The end-to-end group needs the keripy clone, and the K0 group needs the bifold clone.
The officer page's code picker: `node --test codes.test.js`.
