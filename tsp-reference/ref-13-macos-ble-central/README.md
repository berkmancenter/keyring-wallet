# ref-13-macos-ble-central

**Can a macOS host be the locality sensor's BLE central, the way the Linux
witness is?**

The witness's shipped `BleLocalityProvider` (`witness-server`) drives BlueZ
over D-Bus via `node-ble`, which is Linux-only. Two consequences, both
awkward:

- a Linux box is a hard prerequisite for any locality run, and
- the **iOS peripheral** (locality-plan §10.3 item 9, still unimplemented)
  cannot be developed or verified on a Mac-only desk.

This rung answers the narrow radio question before anyone writes Swift.

```sh
npm install
node run.mjs --scan                # list every advertising peer
node run.mjs --eid <32-hex-eid>    # run the full transcript exchange
```

## What it does

It reimplements nothing. It replays `runTranscriptExchange`'s sequence byte
for byte, through CoreBluetooth instead of BlueZ:

1. scan for the service UUID derived from the EID (`4b524c31` + eid)
2. connect
3. write a freshly minted 32-byte nonce (hex, utf8) to the **core**
   characteristic `4b524c32-…`, write-with-response
4. read the core characteristic back, chunked at offsets
5. read the **signature** characteristic `4b524c33-…`, chunked
6. `JSON.parse` both, merge, report the round-trip time

The three constants are duplicated from the provider deliberately. If
`witness-server` changes them, this rung should fail rather than silently
follow — a cross-package import would hide exactly that.

## Result (2026-09-11, macOS 26.3)

**Act 1 — does CoreBluetooth work from Node here? Yes.** `--scan` reached
`poweredOn` and discovered 12 advertising peers in a 22-second window, two of
them named (`Samsung AU8200 65 TV`, `85" Crystal UHD`), RSSI −45 to −97. No
entitlement or permission prompt was needed for scanning.

**Act 2 — the full exchange: blocked, and the reason is worth knowing.**

`fake-peripheral.swift` was written to close the gap — a CoreBluetooth
peripheral that advertises a chosen EID and answers the same GATT exchange, so
`run.mjs` could be proven correct before any iOS code exists. It advertises
correctly:

```
[fake] CoreBluetooth state: 5 (5 = poweredOn)
[fake] advertising 4B524C31-0011-2233-4455-66778899AABB
```

**But a Mac cannot see its own BLE advertisements.** An unfiltered scan running
beside it saw 30 other peers and zero matches for our own service prefix — the
central and peripheral roles share one controller, and macOS filters self-
advertisements. Loopback on a single Mac is not possible.

This costs nothing for the real topology, which is two devices: the phone
advertises, the Mac scans. It only rules out single-machine self-testing, and
knowing that in advance is worth the rung on its own — it is an easy hour to
lose.

So act 2 needs a **separate** advertising device. The iOS peripheral, installed
on a real iPhone, is exactly that — which makes it both the thing being built
and the thing that finally exercises this probe end to end.

Two bugs this rung caught in its own code, both by running it:

- **The EID is 24 hex characters, not 32.** `deriveEid` is HKDF with
  `EID_BYTES = 12`; `prefix(8) + eid(24)` is the 32 hex a 128-bit UUID needs.
  Both files validated 32 and produced `4b524c31-0011-2233-4455-66778899aabbccddeeff`,
  which CoreBluetooth rejects outright.
- **Swift block-buffers stdout when redirected**, so a working peripheral looked
  like a silent hung one. `setvbuf(stdout, nil, _IONBF, 0)`.

## What this settles

The iOS peripheral can be built and verified against a **Mac**, with no Linux
host in the loop. That was the open question behind the build order, and it
means the peripheral (which unlocks iOS participation and works against the
existing Linux witness) can go first, ahead of any macOS witness provider.

## What it is not

Not a witness. No VWC is issued, nothing is signed, no task channel is
involved — it proves the radio leg only. A future `MacBleLocalityProvider`
would implement `TaskLocalityProvider` (`start`/`stop`/`observeSession`) and
reuse this file's exchange; that is a separate, larger piece of work and is
not attempted here.
