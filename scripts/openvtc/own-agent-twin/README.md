# The own-agent offline twin

A stand-in for the VTA Farm on the local lab, for the "own my agent" flow
([`own_agent_subtask.md`](../../../docs/plans/keyring-on-the-vta-farm/own_agent_subtask.md)
§1, §4, §8). The Farm's wizard provisions a new agent whose admin is whatever
DID the person pastes into **Admin DID**. Here that is one dedicated lab VTA,
`carol`, and one script, `admit-owner.sh`, which admits a DID exactly as
upstream's guide pairs with the paste:

```sh
vta import-did --did <X> --role admin
```

That writes an unrestricted, permanent admin (role admin, no contexts, no
expiry, `createdBy: cli:import-did`) — VTI `ed672fff`
`vta-service/src/import_did.rs:57-71`,
`docs/05-design-notes/pnm-setup-deferred-vta-did.md:23`. What the Farm really
grants is measurement M2; if it turns out different, `admit-owner.sh` changes
to match and nothing else does.

## What it is

| | |
|---|---|
| VTA | `carol`, vta-service 0.42.0 (the lab's `~/Documents/vti-main` build) |
| Port | `127.0.0.1:8113` |
| Public host | `https://keyring-vti-carol.ngrok.app` (its `did:webvh` is bound to it) |
| Config, data | `~/vti-stack/carol/config.toml`, `~/vti-stack/carol/data` |
| Log | `~/vti-stack/logs/carol.log`, a new file per start (the previous kept as `carol.log.prev`), capped at 50 MB (`TWIN_LOG_MAX`) |
| PID | `~/vti-stack/carol/vta.pid` (the PID listening on 8113) |
| Runner env | `~/vti-stack/carol/twin.env` (`TWIN_VTA_DID`, `TWIN_SLUG`, …) |
| Mediator | the lab's, as bob's; DID document `#tsp`, `#vta-didcomm`, `#vta-rest` like bob and the Farm runners |
| Harness admin | pnm profile `carol` (login keychain `pnm-cli` / `vta:carol`), ACL label `twin-harness`; recorded in `acl-baseline.json` |

It touches nothing shared: alice, bob and community are never called,
restarted or written; the names and their ports are refused by `lib.sh`. The
six lab tunnels are not restarted: the twin's tunnel is **added** to the running
ngrok agent through its local API, and `~/vti-stack/ngrok.yml` is not edited.
The shared DID host is not registered with the twin (that needs the dids daemon
stopped), so the twin cannot mint personas; the own-agent flow needs none.

## Commands

```sh
cd scripts/openvtc/own-agent-twin

./twin-vta.sh up          # provision once, (re)start, add the tunnel; idempotent
./twin-vta.sh status      # running? pid, port, DID
./twin-vta.sh stop        # stop carol by its PID (checked against its config path)
./twin-vta.sh down        # stop, and close carol's ngrok tunnel

./admit-owner.sh <did> [label]   # the Farm stand-in; stops and restarts carol
./show-acl.sh                    # the ACL, full DIDs, baseline rows marked
./show-acl.sh --owner <did>      # exit 0 iff <did> is an unrestricted permanent admin
./show-acl.sh --absent <did>     # exit 0 iff <did> has no entry
./show-acl.sh --new | --json     # only this run's rows | JSON
./reset.sh [--dry-run]           # delete every row not in acl-baseline.json
```

`show-acl.sh` and `reset.sh` work on the running twin (pnm, through
`../pnm-locked`); nothing stops. `admit-owner.sh` stops the twin because
`import-did` opens the store directly and fjall holds an exclusive lock per
data dir while the daemon runs — the same order the Farm uses (the Admin DID is
written, then the agent comes online). `show-acl.sh --offline` reads the store
with `vta acl list` the same way; not for use mid-run.

After an ngrok restart (a lab `up.sh` or reboot), run `./twin-vta.sh up` again:
it re-adds the tunnel under the same domain, so the DID is unchanged. Starting
from scratch: `./twin-vta.sh stop`, then `rm -rf ~/vti-stack/carol`, remove the
pnm profile (`pnm vta remove carol --yes`), and `up`.

## The e2e run

`e2e/run-own-agent.js` drives it (steps and future testIDs in its header):

```sh
./scripts/openvtc/own-agent-twin/twin-vta.sh up
./scripts/openvtc/own-agent-twin/reset.sh
cd e2e
OWNER_PLATFORM=android OWNER_UDID=emulator-5554 \
BACKUP_PLATFORM=ios BACKUP_UDID=<simulator udid> \
  node run-own-agent.js
```

`SKIP_BACKUP=1` runs the owner steps on one device. `E2E_BACKUP_GRANT=harness`
lets the harness grant the backup in place of the owner phone, so the backup's
link and swap can run before the app has "Add a backup"; it proves nothing
about the app's grant. Exit 0 pass, 1 fail, 3 reached a step the app does not
implement yet.

## Proven without devices (2026-09-25)

`up` from nothing; admit a throwaway `did:key` → `show-acl.sh --owner` says
OWNER (`role=admin contexts=unrestricted expires=never createdBy=cli:import-did`);
a second admit of the same DID leaves the row alone; `reset.sh` deletes it and
nothing else; `show-acl.sh --absent` then passes. One restart in five took
over 60 s to rejoin the mediator (the agent first resolves its own DID through
the tunnel, with backoff), so `admit-owner.sh` waits up to 120 s and keeps the
previous start's log as `carol.log.prev`. The runner is checked with
`node --check` and its imports resolve (`node run-own-agent.js --help`).
