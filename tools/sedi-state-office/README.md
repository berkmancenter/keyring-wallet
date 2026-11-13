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

`PY=~/.cache/keyring-sedi-office/venv/bin/python`, run from this folder. Every command asks for the keystore passcode
(at least 21 characters), or reads `KEYRING_SEDI_K1_PASSCODE`.

```sh
$PY -I office.py init                         # once: incept roy/deb/sue, issue the Unit and Agent cards
$PY -I office.py --host <public host> publish # rewrite the public tree for that host (remembered from then on)
$PY -I office.py serve                        # the officer API + page on http://127.0.0.1:8790 (prints the token)
$PY -I office.py issue --holder <AID> --ward <AID> [--valid-days 30] [--role parent] [--label text]
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
- `publish/`: the tree to serve, as is.

`publish/` sits beside `keys/`, never inside it, and holds no secret:

- `keyring-demo-state/<AID>/{did.json,keri.cesr}`, for K1's three AIDs and K0's three. K0's come from bifold's kit,
  read with `git show` from the bifold clone's `origin/main`, so one host serves both demos.
- `cards/<pickupId>.{json,html,status.json}`: the card bundle the phone fetches, the pickup page, and its status.

Labels never leave the keystore, and no file in `publish/` names a person.

### Host flags

- `--host`: a bare hostname, optionally with a port. Only a real port's `:` is `%3A`-encoded in a DID.
- `--path-prefix`: the site root's path under the host, for a bucket URL later.

Every did.json and card page is rewritten for the host in use.

## The officer API (127.0.0.1 only)

Every request carries `Authorization: Bearer <token>`. A Host or Origin other than `127.0.0.1:<port>` or
`localhost:<port>` is refused, and there is no CORS.

| Call                            | Takes                                                   | Returns                                                                                |
| ------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `POST /api/cards`               | `{holder, ward, label?, validDays?=30, role?="parent"}` | 201, the card view; 400 `badHolder`, `badWard`, `badValidity`, `badRole` or `badLabel` |
| `GET /api/cards`                |                                                         | every card view                                                                        |
| `POST /api/cards/{SAID}/revoke` |                                                         | 200, the card view; idempotent (the same `revokedAt`); 404 for an unknown card         |
| `GET /api/health`               |                                                         | `{root, aids, host, pathPrefix, keystore}`                                             |

A card view holds:

- `id`, `pickupId`, `label`, `holder`, `ward`, `role`, `issuedAt`, `expiresAt`, `status` (`issued` or `revoked`),
  and `revokedAt` once revoked;
- the links: `pickupUrl`, `pickupJsonUrl`, `statusJsonUrl`, `offerUrl`;
- `qrSvg`, empty once revoked;
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
