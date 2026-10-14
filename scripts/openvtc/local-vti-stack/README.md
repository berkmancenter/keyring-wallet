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
```

**`e2e/run-agent-connect.js` needs a VTI from before #1687 (2026-09-23).** Its
probe (Developer screen, "Probe VTA mediator") sends `join-requests/manifest/0.2`
and `submit/0.2` typed as the task URI. Since VTI #1687 (`c595bcb9`, VTI-42) a
VTC takes a Trust Task over DIDComm only in the binding envelope and refuses
that carriage ("Trust Task arrived typed as its task URI, not in the DIDComm
binding envelope — refused"), so on a current VTC the run stops at the
`verdict` marker. The app's real community path already sends the envelope.
To run this gate, build a second VTI tree at `a96fe02f` (2026-09-21; vta
0.37.0, vtc 0.11.58) and point `up.sh` at it — the rest of the lab is unchanged:

```sh
git -C ~/Documents/vti-main worktree add --detach ~/Documents/vti-a96fe02f a96fe02f
cargo build --manifest-path ~/Documents/vti-a96fe02f/Cargo.toml \
  -p vta-service -p vtc-service -p pnm-cli -p cnm-cli --features vta-service/tsp,vta-service/webvh
VTI_SRC=~/Documents/vti-a96fe02f PNM_BIN=~/Documents/vti-a96fe02f/target/debug/pnm ./up.sh
# then rebuild the app against the new stack.env, as after any up.sh
```

On macOS, Redis comes from Homebrew: `brew install redis && brew services start redis`.

`vetting` is not a `vta-service` feature — it rides `vta-sdk` and is built in.

## On Linux

The scripts branch on `uname` where macOS and Linux differ; nothing else changes.

- **Redis:** `brew install redis` is macOS. On Linux install your distro's Redis
  and, on a host whose Redis already serves other data, run a dedicated one and
  point the stack at it: `redis-server --port 6390 --save "" --dir <stack>/redis`
  then `REDIS_PORT=6390 ./up.sh` (default 6379, unchanged). To share an instance instead,
  `REDIS_DB=5 ./up.sh` keeps the mediator's keys out of db0 (the mediator's keys are unprefixed:
  `DID:*`, `MSG:*`, `SEND_Q:*`, so db0 of a Redis that already ran a mediator would collide).
- **Keychain signing is skipped.** `../sign-lab-tool.sh` only exists to keep a
  macOS "Always Allow" grant across rebuilds; on Linux it just makes the
  revisioned copy and the stable `~/vti-stack/bin/<tool>` link. That link is a
  prerequisite of `up.sh` (it runs `pnm` from `~/vti-stack/bin/pnm`): run
  `scripts/openvtc/sign-lab-tool.sh all` (or just `... pnm`) once after building and
  before `./up.sh`. If `~/vti-stack/bin/pnm` is missing on Linux, `up.sh` calls
  `sign-lab-tool.sh pnm` itself.
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

## ngrok with your own account (Linux lab)

Reserved domains keep every DID stable across restarts. **`up.sh` refuses to
run without `$STACK_DIR/ngrok.yml`** (exit 2, before it starts or stops
anything): the old fallback used the default ngrok config and the
`keyring-vti-*` live hosts, which are someone else's stack. Create the lab
config below first. `LAB_ALLOW_LIVE_DOMAINS=1` keeps the old fallback for the
Mac stack's owner; `./test-up.sh` checks the guard offline.

**The Mac stack's owner needs only that one override.** With
`LAB_ALLOW_LIVE_DOMAINS=1`, `up.sh` (a) reads tunnels written in ngrok's inline
form (`alice: { proto: http, addr: 8110, domain: ... }`) as well as the block form,
(b) starts every tunnel the lab `ngrok.yml` names, not only the six (the file also
keeps tunnels added at runtime), still from the named tunnels only and never
`ngrok start --all`, and (c) allows Redis db0 on port 6379 without
`LAB_ALLOW_REDIS_DB0=1`. Mode 600 on `ngrok.yml` is still required; preflight
prints the exact `chmod 600 <path>` to run. Without the override (the lab path) none
of this applies: six tunnels, db0 on 6379 refused.

**Warnings.** The `keyring-vti-*.ngrok.app` domains are the live shared stack
and belong to another account; never point a lab at them. `up.sh` and
`ngrok-lab-config.sh` refuse those names unless `LAB_ALLOW_LIVE_DOMAINS=1`,
which exists only for the Mac stack's owner. A host's default
`~/.config/ngrok/ngrok.yml` may hold someone else's tunnels; the lab never
reads it, never passes it to ngrok, and never uses `--all`. It starts exactly
`alice community bob vtc dids mediator`, from `$STACK_DIR/ngrok.yml` only
(with `LAB_ALLOW_LIVE_DOMAINS=1`, every tunnel that file names).

**Account and plan.** The stack needs six simultaneously online HTTP endpoints
and six reserved domains. ngrok limits online endpoints and reserved domains
per plan; confirm in the dashboard that the account's current plan allows six of
each before starting. Do not assume it from a previous plan or from this text.
Verified 2026-10-01: a 3-endpoint account fails (ERR_NGROK_18021, and ERR_NGROK_324
"more than N endpoints over a single agent session"), and a plan capped at 5 per
session fails the same way; after upgrading, all six tunnels start in one session.
`up.sh` now watches ngrok for 30 s after launch and aborts with the token-scrubbed
log tail if it exits or logs `ERR_NGROK_*`, then checks that each public hostname
answers before provisioning anything.

1. In the ngrok dashboard (new account), reserve six domains, e.g.
   `myname-alice.ngrok.app`, `-community`, `-bob`, `-vtc`, `-dids`, `-mediator`.
2. Generate the config, offline:
   `./ngrok-lab-config.sh --prefix myname --suffix ngrok.app --out ~/vti-stack/ngrok.yml`
   or six explicit domains in the order alice community bob vtc dids mediator.
   Mode 0600, no authtoken; `--force` overwrites (and drops any token, so re-add it).
   Validate any time with `./ngrok-lab-config.sh --check` (prints the six hostnames).
3. Put your own token in that file, yourself (the scripts never see it):
   `ngrok config add-authtoken <token> --config ~/vti-stack/ngrok.yml`
4. `./up.sh`. Hostnames are read from that file and written into `stack.env`
   (which `stack-health.sh` reads).

A consolidated three-endpoint layout (`--three`) is a stub: it needs
`VTA_ALLOW_PRIVATE_ENDPOINTS` behaviour that has not been verified.
Self-test: `./ngrok-lab-config.sh --self-test`.

## Run it

```sh
./up.sh          # provisions everything, prints ~/vti-stack/stack.env
                 # (the DID host's generated admin key is NOT printed: it goes to
                 #  ~/vti-stack/dids/admin-credentials.txt, mode 0600)
./up.sh --stop
```

### Checking first

`./up.sh --check` runs only `preflight.sh`: read-only, it starts and stops
nothing. It checks the binaries (printing their versions), python >= 3.8, the
lab `ngrok.yml` (mode 0600, the six named endpoints; hostnames shown, nothing
else), Redis and `REDIS_DB`, the stack's ports, MemAvailable (warning under 20
GiB, `LAB_MIN_MEM_GIB` to change) and, on Linux, ImageMagick for the e2e. A
real `up.sh` runs the same checks before it stops or starts anything. A port
held by a process not started from `$STACK_DIR` fails the check, since `up.sh`
stops whatever listens on the stack's ports.

**Redis db0 is refused.** `REDIS_DB` unset or `0` on the default port 6379 fails
the preflight (db0 of a shared Redis holds other sessions' data). Use
`REDIS_DB=5`, or a dedicated instance via `REDIS_PORT` (db0 there is allowed),
or `LAB_ALLOW_REDIS_DB0=1`; `LAB_ALLOW_LIVE_DOMAINS=1` (the Mac stack's owner)
implies that allowance, since that stack has always used db0. `./test-up.sh`
covers the guards offline.

preflight shows each binary's `--version` where it takes one (pnm and
mediator-setup reject it, so their size and mtime are shown). Without `timeout`
(stock macOS; `brew install coreutils` gives `gtimeout`) it skips `--version`
and says so.

### Running the e2e against it

`up.sh` writes `$STACK_DIR/e2e.env` and prints it: `PNM_HOME=$STACK_DIR/pnm-bob`,
`VTI_SECURE_STORE=file`, `KEYRING_COMMUNITY_DID=<VTC DID>`. Load it before the
runners: `set -a; . ~/vti-stack/e2e.env; set +a`. It is a separate file because
the stack scripts `source` `stack.env`, and a `PNM_HOME` there would override the
profile they pick. (`VTI_SECURE_STORE=file` is the Linux setting; harmless on macOS.)

Order for the release-gate runners on one stack and one emulator:

1. `E2E_KEEP_APP=1 node e2e/run-vta-link.js`, then `node e2e/run-vta-approvals.js`.
   Approvals needs the app linked and left installed, and a phone with no stale
   approval card (relink if one is left).
2. Re-run `run-vta-link.js` before `run-vti-invite.js`: the invite run wants a
   freshly linked phone.
3. `INVITE_VIA=door E2E_CRITERIA=flip node e2e/run-vti-invite.js`. The lab's
   criterion asks for one statement, so the door run defers
   (`vetting:statements:1`) unless the runner may flip the criteria.
4. The other gate runners (agent-segments, push-off probe, lock probe) only need
   a linked phone.

**After a `flip` run, check the criterion.** The runner deletes `vetted-member`,
and in its `finally` calls `invite-persona.sh --restore-criteria`, which
re-publishes `$STACK_DIR/criterion.json`. The runner swallows a failure of that
step, and on 2026-10-01/02 the published criterion differed after a flip run
(cause not established). What is restored is whatever `criterion.json` holds at
that moment, not what was published before. To put it back by hand (same file,
idempotent): `./invite-persona.sh --restore-criteria`, or `./community-setup.sh`,
and look for `vetting criterion restored` / `criterion.json` in the output.

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
