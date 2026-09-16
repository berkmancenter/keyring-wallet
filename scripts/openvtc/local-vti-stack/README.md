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
- **Every hostname must be public.** Upstream refuses `did:webvh` on localhost
  and private addresses, so each service sits behind a tunnel. Quick tunnels
  mint a new hostname per run and **a `did:webvh` is bound to its hostname**, so
  a restart re-mints every DID and `app/.env` has to be re-baked. Reserved
  domains are what makes a stack survive a restart; ngrok's Hobbyist plan allows
  three online endpoints, which is enough if only DID hosting, the mediator and
  one REST endpoint face the phone (subtask §4).

## Driving it

`tsp-reference/ref-20-local-vetting/` holds both halves: `vtc-admin.mjs` for the
community-admin REST surface (the `cnm` CLI cannot reach a VTC on this build)
and `join.mjs` for the applicant's `manifest/0.2` and `submit/0.2` over DIDComm.
Its README records the nine findings this stack produced, including the one that
blocks the ceremony: there is no admissible path to a community's first vetter.
