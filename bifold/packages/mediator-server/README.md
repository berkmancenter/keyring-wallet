# `@bifold/mediator-server`

A DIDComm mediator you can run on your own machine, so Keyring boots without
access to anyone else's infrastructure.

## Why this exists

Every wallet in this repo needs a mediator before it does anything useful, and
until this package there was no way for a new developer to get one. `app/.env.sample`
carries a `MEDIATOR_URL` that is a single invitation captured from someone's
ngrok tunnel — long dead. The demo runbook assumes Berkman Center's production
mediator, which an outside developer cannot reach. A stale invitation does not
fail loudly: it fails later, as "There is no mediator to pickup messages from".

This is the mediator counterpart to `@bifold/witness-server`, and
`scripts/local-mediator.js` at the repo root is the counterpart to
`e2e/lib/witness.js` — same shape, same tunnel, same one-call spin-up.

## Use it

From the repo root:

```sh
yarn mediator                                   # tunnel; works for any device
yarn mediator --endpoint http://10.0.2.2:3010   # two Android emulators, no tunnel
yarn mediator --endpoint http://localhost:3010  # iOS simulator, no tunnel
yarn mediator --fresh                           # wipe the wallet first
yarn mediator --no-env                          # print MEDIATOR_URL, don't write it
```

It writes `MEDIATOR_URL` into `app/.env` (creating the file from `.env.sample`
if you have not yet), leaving every other line alone. Then `yarn android` /
`yarn ios` as usual. Leave it running for as long as you are using the app.

### Which `--endpoint`, and when you need the tunnel

Debug builds permit cleartext HTTP to a fixed set of hosts, and nothing else:

| Target | Endpoint | Tunnel? |
|---|---|---|
| Android emulator(s) | `http://10.0.2.2:<port>` | no |
| iOS simulator(s) | `http://localhost:<port>` | no |
| Android emulator **and** iOS simulator together | — | **yes** |
| Physical phones | — | **yes** |

The first two are permitted by `app/android/app/src/debug/res/xml/network_security_config.xml`
and the `localhost` ATS exception in `app/ios/AriesBifold/Info.plist`. There is
no single cleartext host that an emulator and a simulator both resolve to the
same machine, which is why a mixed pair needs the tunnel — and release builds
permit no cleartext at all.

The tunnel is a `cloudflared` quick tunnel: no Cloudflare account, but
`cloudflared` must be installed.

## Restarting changes the address

A quick tunnel gets a new hostname each time, and the invitation bakes the
endpoint in. So a restart mints a new invitation, and wallets that connected
through the old one are pointing at an address that no longer answers. Re-run
`yarn mediator`, and reset the wallet's onboarding (or reinstall) so it picks
up the new `MEDIATOR_URL`. Passing a fixed `--endpoint` avoids this entirely.

Queued messages live in memory, so a restart drops anything undelivered. That
is fine for development and is the reason this is not a production mediator.

## What it is and is not

It is a real Credo mediator: it accepts connections, grants mediation
automatically, queues forwarded messages, and serves them over Pickup v2 —
which is what Keyring's agent asks for (`app/src/utils/bc-agent-modules.ts`
sets `DidCommMediatorPickupStrategy.PickUpV2`).

It is not a credential issuer or verifier: the credentials, proofs and
basic-message modules are switched off, because a mediator routes and nothing
else. That keeps the boot fast and the dependencies small — no ledger, no
anoncreds.

## Verifying a change

```sh
yarn test      # config parsing
yarn verify    # the acceptance check: a wallet agent gets mediation granted
```

`yarn verify` is a script rather than a jest test on purpose: `@credo-ts`
ships ESM builds that this package's ts-jest/CommonJS setup cannot parse, and
the repo's `CLAUDE.md` says not to bend a package's jest config to match. Run
it after changing anything in `MediatorService.ts`.

## Configuration

All optional except `MEDIATOR_PUBLIC_URL`, which `yarn mediator` sets for you.

| Variable | Default | Meaning |
|---|---|---|
| `MEDIATOR_PUBLIC_URL` | — (required) | The address a *phone* uses to reach the mediator. Baked into the invitation. |
| `MEDIATOR_PORT` | `3010` | Port bound locally. |
| `MEDIATOR_LABEL` | `Keyring Local Mediator` | Name the wallet shows for its mediator. |
| `MEDIATOR_WALLET_ID` | `keyring-local-mediator` | Askar store id; names the sqlite file. |
| `MEDIATOR_WALLET_KEY` | `<wallet id>-key` | Askar store key. |
| `MEDIATOR_WALLET_PATH` | `./.wallet` | Directory holding the sqlite file. |
| `MEDIATOR_INVITATION_PATH` | unset | If set, the invitation URL is written here on boot. |
| `MEDIATOR_VERBOSE` | `false` | Credo debug logging. |
