# A local VTI stack

Six services, built from upstream, standing in for what a Farm would host:
three VTAs (an applicant, a community host, a vetter), a VTC, an
Affinidi-style mediator and a DID-hosting daemon. It exists because a Farm
cannot run the vetting ceremony yet — see
[`community_vetting_subtask.md`](../../../docs/plans/keyring-on-the-vta-farm/community_vetting_subtask.md)
§2.2–2.3 — and because the phone's own transport has to be proven against
something real before it is pointed at someone else's infrastructure.

## Build the binaries once

```sh
# VTI: vta-service, vtc-service, pnm, cnm — build at origin/main, note the SHA
git -C <vti-clone> worktree add ~/Documents/vti-main origin/main
cd ~/Documents/vti-main
cargo build -p vta-service -p vtc-service -p pnm-cli -p cnm-cli \
  --features vta-service/tsp,vta-service/webvh
# pnm opens the login Keychain: sign it after EVERY rebuild (the stable path and
# target/debug/pnm in place), or the next run re-prompts for each item
scripts/openvtc/sign-lab-tool.sh all   # after ANY lab rebuild (VTI, webvh, tdk): every binary, before a restart

# DID hosting
git clone https://github.com/affinidi/affinidi-webvh-service ~/Documents/affinidi-webvh-service
cargo build -p did-hosting-daemon --manifest-path ~/Documents/affinidi-webvh-service/Cargo.toml

# Mediator (the current one lives in the TDK, not in affinidi-messaging)
git clone https://github.com/affinidi/affinidi-tdk-rs ~/Documents/affinidi-tdk-rs
cargo build -p affinidi-messaging-mediator -p affinidi-messaging-mediator-setup \
  --manifest-path ~/Documents/affinidi-tdk-rs/Cargo.toml

brew install redis && brew services start redis
```

`vetting` is not a `vta-service` feature — it rides `vta-sdk` and is built in.

## On Linux

The scripts branch on `uname` where macOS and Linux differ; nothing else changes.

- **Redis:** `brew install redis` is macOS. On Linux install your distro's Redis
  and, on a host whose Redis already serves other data, run a dedicated one and
  point the stack at it: `redis-server --port 6390 --save "" --dir <stack>/redis`
  then `REDIS_PORT=6390 ./up.sh` (default 6379, unchanged).
- **Keychain signing is skipped.** `../sign-lab-tool.sh` only exists to keep a
  macOS "Always Allow" grant across rebuilds; on Linux it just makes the
  revisioned copy and the stable `~/vti-stack/bin/<tool>` link.
- **pnm's secret store.** Linux pnm uses the DBus Secret Service, which an
  unattended run can find locked. For an unattended lab export
  `VTI_SECURE_STORE=file` for every pnm call (plaintext 0600 under pnm's config
  dir; the lab's keys are re-minted each `up.sh`).
- **pnm profile list** is `${XDG_CONFIG_HOME:-~/.config}/pnm/config.toml` (override
  with `PNM_CONFIG_FILE`); `own-agent-twin/twin-vta.sh` follows it.
- **`stack-health.sh`** reads the tunnel URLs from `$STACK_DIR/stack.env`, so a
  stack on any hostname is checked.
- Build packages (`libdbus-1-dev` for the Secret Service build) and sources
  outside `~/Documents` are yours to arrange; `VTI_SRC`, `TDK_SRC`, `WEBVH_SRC`
  and `STACK_DIR` override every default path. Not Linux-ported: the farm's QR
  check (`../farm/qr.swift`, macOS Vision) and the openvtc TUI Keychain fixture.

## Run it

```sh
./up.sh          # provisions everything, prints ~/vti-stack/stack.env
./up.sh --stop
```

## What bites, and why the script does what it does

- **`RUST_MIN_STACK=33554432` on every VTA and VTC.** `vta-service` 0.28.0
  overflows a tokio worker stack handling `vta/contexts/create/1.0` on a debug
  build, and dies mid-request.
- **Set `[messaging] kind = "existing"` at setup**, never `skip` followed by
  `services didcomm enable`: the latter leaves DIDComm enabled with no
  `#vta-didcomm` service entry, and every later command refuses with
  *"on-disk state is inconsistent (re-run setup)"*.
- **A VTC's advertised transports are fixed at mint.** A VTC that should be
  reachable over DIDComm needs `transports = ["didcomm"]` in its setup recipe;
  adding it afterwards means provisioning the VTC again.
- **A fresh VTC has an empty ACL.** Its own `admin_did` cannot authenticate
  until it is added with `vtc acl add` on a stopped daemon.
- **Every hostname must be public, and should be stable.** Upstream refuses
  `did:webvh` on localhost and private addresses, so each service sits behind a
  tunnel — and **a `did:webvh` is bound to its hostname**, so a quick tunnel's
  per-run name re-mints every DID in the stack and forces `app/.env` re-baked
  and both apps rebuilt. With `~/vti-stack/ngrok.yml` present the script uses
  six reserved ngrok domains instead, and the stack survives a restart.
- **A phone cannot open the mediator's WebSocket by default.** React Native
  sends an `Origin` header on the upgrade where Node's `ws` does not, so the
  mediator reads it as a browser and answers `/ws` with 403 unless
  `cors_allow_origin` is set — and that key belongs to the config's
  `[security]` table, where the generated file documents it. Set anywhere else,
  TOML scopes it to a different table and the mediator never sees it.
- **Re-running the script re-provisions.** The mediator and the DID-hosting
  daemon each refuse to overwrite a provisioned install, a running daemon holds
  a lock on the store being rewritten, and a stale `pnm` profile still points at
  the old mediator DID. The script handles all three; the community's vetting
  setup (statement type, criteria, ACL) is not restored automatically — see
  `tsp-reference/ref-20-local-vetting/`.

## Enrolling a phone as a VTA's manager

`enrol-manager.sh <did> [alice|bob|community] [role]` is the stand-in for the
enrolment QR the plan proposes to a farm: the phone mints its manager identity
and shows it, this admits it on the VTA's ACL (stopping the VTA for the write),
and the phone connects. `e2e/run-vta-enrol.js` drives the whole thing, reading
the DID off the Developer screen.

**Personas need a registered DID-hosting server.** A VTA mints a persona on a
server it has registered (`pnm did-mgmt servers add --id dids --did <daemon
DID>`), and the daemon's ACL must list the VTA; `up.sh` does the ACL half. A
*serverless* mint (`--did-url`) prints a log the VTA does not serve — VTI-20.

## The admin portal

`vtc-service` ships a browser console at **`https://<vtc host>/admin/`** — on
this stack `https://keyring-vti-vtc.ngrok.app/admin/` — covering members, join
requests, invitations, vetting, ACL, policies and the audit log. Sign-in is by
**passkey**, so a first administrator enrols one through a single-use URL:

```sh
# on a STOPPED daemon — the command opens the store directly
kill <vtc pid>
vtc --config ~/vti-stack/vtc/config.toml admin invite \
    --did <admin did:key> --ttl 14400
# prints an install URL and a separate claim code; both are required
nohup vtc --config ~/vti-stack/vtc/config.toml &   # must be running to claim
```

Open the install URL on the hostname, not on `127.0.0.1` — a passkey is bound to
the host it was created on. Stopping the daemon to mint the URL is an upstream
papercut, recorded as VTI-16 in `docs/VTI_UPSTREAM_FINDINGS.md`.

## Driving it

`tsp-reference/ref-20-local-vetting/` holds both halves: `vtc-admin.mjs` for the
community-admin REST surface (the `cnm` CLI cannot reach a VTC on this build)
and `join.mjs` for the applicant's `manifest/0.2` and `submit/0.2` over DIDComm.
Its README records the nine findings this stack produced, including the one that
blocks the ceremony: there is no admissible path to a community's first vetter.
