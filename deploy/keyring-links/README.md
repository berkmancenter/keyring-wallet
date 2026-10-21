# keyring-links: short invitation links

An invitation link Keyring shares is the whole out-of-band invitation in `?oob=`, about 950 characters. Messaging apps cut links off at about 200. This service turns it into `https://<wallet host>/i/<id>` (22-character id), on the same host as the install page at `/invite`.

It runs behind Caddy, next to the OTA server (`deploy/keyring-ota`), which also serves the wallet host's static site (`app/universal-link-site`).

## Contract

| Request | Answer |
|---|---|
| `POST /i`, `Content-Type: application/json`, body `{"invitation": <OOB invitation>}` | `201 {"url": "https://<host>/i/<id>", "expiresAt": "<ISO>"}` |
| ↳ not `application/json` | `415 {"error":"unsupported_media_type"}` |
| ↳ not JSON, or not an out-of-band invitation | `400 {"error":"invalid_json"}` / `{"error":"not_an_invitation"}` |
| ↳ body over 8 KB, or the invitation itself over 6,000 bytes | `413 {"error":"too_large"}` |
| ↳ over the rate limit | `429 {"error":"rate_limited"}` |
| ↳ store full | `503 {"error":"store_full"}` |
| `GET`/`HEAD /i/<id>`, `Accept` includes `application/json` | `200`, the invitation JSON (what Credo's short-URL resolver asks for) |
| `GET`/`HEAD /i/<id>`, any other `Accept` (a browser) | `302` to `/invite/?oob=<base64url invitation>`, the install page and its "Already have the app?" fallback |
| unknown, malformed or expired id | `404`; `{"error":"not_found"}` for JSON |
| `GET /healthz` | `200 ok` |

- **Size:** the invitation is capped at 6,000 bytes so that the browser's long link, about 4/3 of that, stays under the ~8 KB that browsers and intermediaries reliably carry. A real invitation is about 0.7–1.2 KB.
- **Accepted invitations:** `@type` `https://didcomm.org/out-of-band/1.0|1.1/invitation` (and the legacy `did:sov:…;spec/out-of-band/1.x/invitation` form), or `type` `https://didcomm.org/out-of-band/2.0/invitation`.
- **Ids:** 128 random bits, base64url.
- **Lifetime:** a link lives 7 days and is **not consumed** when fetched, because message previews fetch it. Single use is the sender's invitation record's job.
- **Headers:** every answer carries `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`.

## Privacy

**The service has no published port on purpose.** Caddy must be its only way in: Caddy's 8 KB body cap is its first size limit, and the rate limiter trusts the last `X-Forwarded-For` entry because Caddy sets it.

- **Stored:** each link is one file, `<id>.json`, holding `{"expiresAt", "invitation"}` and nothing else. There are no IPs, no creation or fetch times, and no counters.
- **Rate limiting:** it keys on the client address that Caddy passes in `X-Forwarded-For`, in memory only. Buckets are dropped once refilled. The limits are 10 POSTs a minute per client (burst 20) and 600 a minute in total.
- **No logging:** there is no access log, here or in Caddy (the Caddyfile has no `log` directive). The server logs only startup and the fact that an internal error happened, never a body or an id.
- **Expiry:** expired links are removed hourly, and refused on read.
- **Where the files live:** on the host, the link files belong on a disk that isn't snapshotted (`LINKS_DATA_PATH`). Then backups can't keep invitations past their 7 days.
- **Who can read a link:** anyone who has it can fetch the invitation, the same as with today's long link, which *is* the invitation.

## Run it locally

```sh
cd deploy/keyring-links
PORT=3090 PUBLIC_URL=http://localhost:3090 node src/server.mjs
curl -s -X POST localhost:3090/i -H 'content-type: application/json' \
  -d "{\"invitation\": $(cat test/fixtures/invitation-v1.json)}"
curl -s -H 'accept: application/json' localhost:3090/i/<id>
npm test
```

| Variable | Default |
|---|---|
| `PORT` | `3090` |
| `PUBLIC_URL` | `https://wallet.asml.berkmancenter.org` |
| `LINKS_DATA_DIR` | `./data` |
| `LINKS_TTL_SECONDS` | `604800` |
| `LINKS_MAX_BODY_BYTES` | `8192` |
| `LINKS_MAX_INVITATION_BYTES` | `6000` |
| `LINKS_MAX_LINKS` | `100000` |
| `LINKS_RATE_PER_MINUTE` | `10` |
| `LINKS_RATE_BURST` | `20` |
| `LINKS_GLOBAL_PER_MINUTE` | `600` |

Fixtures: `test/fixtures/invitation-v1.json` (OOB 1.1) and `invitation-v2.json` (OOB 2.0), with dummy keys.
