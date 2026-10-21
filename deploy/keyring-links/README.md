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
- **Lifetime:** a new link lives **24 hours**. Its first fetch (by Keyring, a browser or a message preview) extends it to **7 days from its creation**. A link is **not consumed** when fetched, because message previews fetch it; single use is the sender's invitation record's job. `expiresAt` in the `201` is the unfetched expiry.
- **Headers:** every answer carries `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`.

## Floods

POST is anonymous, so the limits are what bound abuse:
- the per-client and global rates;
- the store cap;
- the 24-hour lifetime of links nobody opens: a flood of unopened links is gone in a day. An attacker can extend their own links by fetching them, so against a deliberate flood the global rate is the real bound: about 35 hours to reach the cap;
- the size caps.

At the cap, `POST /i` answers `503`. Links already shared keep working, even when the disk is full: a link whose 7-day extension can't be written is still served for the rest of its current lifetime.

**Keyring doesn't call `/i` yet.** The app shares the long link today. When it does call `/i`, falling back to the long link on any answer other than `201` (including `503`, `429` and timeouts) is a **requirement** on that work, not a property of this service. With that fallback, a flood degrades sharing (long links, which some apps cut) but never breaks it; without it, a flood breaks sharing.

A per-client cap on *stored* links would need client addresses on disk, so it isn't used.

**Going above 250,000 links.** Don't raise `LINKS_MAX_LINKS` on the boot disk. Each link costs an inode, and a 20 GB boot disk has about 1.3M in total, shared with the OS and the container images. Use a dedicated disk instead:
- give it **no snapshot schedule**, so backups still can't keep invitations past their lifetime;
- format it with enough inodes (for example `mkfs.ext4 -i 4096`);
- mount it at `LINKS_DATA_PATH`;
- then raise the cap.

On ota-prod that means a new `kota-*` disk in the infra repo, attached and mounted by `kota-sync`. That's an infra change for the owner to plan and apply.

## Privacy

**The service has no published port on purpose.** Caddy must be its only way in: Caddy's 8 KB body cap is its first size limit, and the rate limiter trusts the last `X-Forwarded-For` entry because Caddy sets it.

- **Stored:** each link is one file, `<id>.json`, holding `{"expiresAt", "invitation"}`, plus `"fetched": true` once fetched, and nothing else. There are no IPs, no fetch times and no counters. The file's mtime is set to its expiry, so the sweep only stats files and never reads them.
- **Rate limiting:** it keys on the client address that Caddy passes in `X-Forwarded-For`, in memory only. Buckets are dropped once refilled. The limits are 10 POSTs a minute per client (burst 20) and 120 a minute in total, with at most 250,000 stored links. Each link is one small file, so each costs a 4 KB block and an inode on the host's disk. 250,000 is about 1 GB and fits a 20 GB boot disk's inodes with room to spare; 1,000,000 would not.
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
| `LINKS_UNFETCHED_TTL_SECONDS` | `86400` |
| `LINKS_FETCHED_TTL_SECONDS` | `604800` |
| `LINKS_MAX_BODY_BYTES` | `8192` |
| `LINKS_MAX_INVITATION_BYTES` | `6000` |
| `LINKS_MAX_LINKS` | `250000` |
| `LINKS_RATE_PER_MINUTE` | `10` |
| `LINKS_RATE_BURST` | `20` |
| `LINKS_GLOBAL_PER_MINUTE` | `120` |

Fixtures: `test/fixtures/invitation-v1.json` (OOB 1.1) and `invitation-v2.json` (OOB 2.0), with dummy keys.
