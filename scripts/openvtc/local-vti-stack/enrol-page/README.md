# enrol-page — link a phone to a local VTA by QR (lab only)

A small web page + HTTP API that lets the admin of a local VTA admit a Keyring
phone as its manager by QR code, with no daemon restart. It is a **lab stand-in
for the enrolment exchange we will propose to upstream** — the kind of thing the
VTA browser extension's Access pane and the Farm console would offer — so the
phone side can be built and tested against a concrete protocol now.

The flow: the admin clicks **Add a phone**; the page shows a QR (and the same
content as a copyable link). The phone scans or pastes it, mints a temporary
`did:peer:2` key and submits it with a proof of possession. Both screens show the
same 8-character code; the admin clicks **Codes match — grant access**, and the
page runs `pnm acl create … --role admin --expires 1h` on the running VTA. The
phone then connects and rotates to a long-lived key of its own.

**There is no login, by design.** Anyone who can reach the port can create
offers and press grant. Run it on a lab machine / lab network only.

## Run

```sh
node scripts/openvtc/local-vti-stack/enrol-page/server.mjs
# open http://localhost:8190/

# Android emulator: make the phone's localhost:8190 reach this machine
adb reverse tcp:8190 tcp:8190
# LAN phone: advertise an address the phone can reach
ENROL_PUBLIC_URL=http://192.168.1.20:8190 node scripts/openvtc/local-vti-stack/enrol-page/server.mjs
```

It binds `0.0.0.0` and logs the URL, the VTA DID and where it came from. It needs
only Node ≥ 20 and the repo's `qrcode` package (resolved from the repo root
`node_modules`). State lives in memory; restarting forgets every offer.

| env | default |
|---|---|
| `ENROL_PORT` | `8190` |
| `ENROL_PUBLIC_URL` | `http://localhost:${ENROL_PORT}` — base of every offer `url`, so it must be what the **phone** can reach |
| `ENROL_VTA_DID` | `ALICE_VTA_DID` from `$STACK_DIR/stack.env` (`STACK_DIR` default `$HOME/vti-stack`) |
| `ENROL_LABEL` | `Keyring lab agent (alice)` |
| `OFFER_TTL` | `300` seconds |
| `PNM_BIN` | `$HOME/Documents/vti-main/target/debug/pnm` |
| `PNM_HOME` | `$HOME/vti-stack/pnm-alice` (an existing admin of the VTA) |
| `VTA_SLUG` | `alice` |

Tests: `node --test scripts/openvtc/local-vti-stack/enrol-page/test/` (no
dependencies; `pnm` is replaced by a stub script).

## Protocol (v1)

### Offer

`POST /api/offers` creates one. JSON, keys in exactly this order:

```json
{ "v": 1, "t": "vta-enrol", "vta": "<VTA DID>", "label": "<agent host label>",
  "url": "<PUBLIC_URL>/api/offers/<n>", "n": "<nonce>", "exp": <unix secs> }
```

- `n`: 16 random bytes, base64url without padding. It is also the offer id.
- `exp`: now + `OFFER_TTL`.
- **Link** = `keyring://vta/enrol?o=` + base64url-no-pad(UTF-8 of
  `JSON.stringify(offer)`). The QR encodes exactly the link string.

### Submit (phone)

`POST {url}/submit` with `{ "did": "did:peer:2…", "proof": "<compact JWS>" }`.

- JWS header `{"alg":"EdDSA","kid":"<did>#<fragment>","typ":"JWT"}`, payload
  `{"iss": did, "aud": url, "nonce": n, "iat": secs, "exp": secs}`, signing input
  ASCII `b64url(header).b64url(payload)`, Ed25519.
- The public key comes from the DID: split the method-specific part on `.`, the
  single element starting with `V` (authentication) minus the `V` is a multibase
  `z` (base58btc) value = `0xed 0x01` + 32 key bytes. Exactly one `V` element.

Checks, in order; failures answer `{ "error": "...", "code": "..." }`:

| condition | status |
|---|---|
| unknown offer | 404 |
| offer past `exp` (becomes `expired`) | 410 |
| offer not `open` (single use) | 409 |
| body/JWS malformed, `alg` ≠ EdDSA, `kid` DID ≠ `iss` ≠ `did`, `aud` ≠ `url`, `nonce` ≠ `n`, proof `exp` < now, not exactly one Ed25519 `V` key | 400 |
| signature does not verify | 401 |

Success: `202 {"state":"submitted","code":"XXXX-XXXX"}`. A failed attempt does not
consume the offer.

### Enrolment code

SHA-256 over UTF-8 `keyring-vta-enrol/v1|${n}|${did}` → first 5 bytes (40 bits)
→ 8 Crockford base32 chars (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, MSB first) →
`XXXX-XXXX`. Implemented in `code.mjs`.

Test vector: `n = "AAAAAAAAAAAAAAAAAAAAAA"`, `did = "did:peer:2.Vz6MkTEST"` →
**`N4SP-X7H6`** (first 5 digest bytes `a9 33 6e 9e 26`).

### Status (phone and page)

`GET {url}/status` → `200 {"state":"open"|"submitted"|"granted"|"refused"|"expired", "code"?, "error"?}`.
Expiry is evaluated on read: an `open` or `submitted` offer past `exp` becomes
`expired`; `granted` and `refused` are final.

### Admin actions (the page's own JS)

| request | effect |
|---|---|
| `POST /api/offers` | `201 {offer, link, qrSvg}` |
| `GET /api/offers/{n}` | `{offer, link, state, did?, code?, error?}` |
| `POST /api/offers/{n}/grant` | only from `submitted` (else 409; 410 if expired; 400 if the DID is not `did:peer:2.[A-Za-z0-9._-]+`). Runs `pnm --vta $VTA_SLUG acl create --did <did> --role admin --expires 1h --label keyring-phone` with `PNM_HOME` — via `execFile`, never a shell. Exit 0 → `granted`, 200; otherwise 502 with the stderr tail and the offer stays `submitted` (the admin may retry). |
| `POST /api/offers/{n}/refuse` | from `open`/`submitted` → `refused`, 200; else 409 |

## Page test ids

`add-phone`, `qr`, `label`, `countdown`, `link` (a `<code>` holding the current
link), `copy-link`, `code`, `grant`, `refuse`, `state` (its `data-state`
attribute carries the machine state), `error`.

## Related

`../enrol-manager.sh` does the same grant from a terminal when you already have
the phone's DID (online by default; `--offline` for the old stop-import-restart).
